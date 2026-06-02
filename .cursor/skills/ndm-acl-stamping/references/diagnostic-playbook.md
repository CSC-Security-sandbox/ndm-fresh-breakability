# Diagnostic Playbook — Debugging NDM ACL Issues

When a user reports an ACL bug that doesn't match `known-bugs-and-fixes.md`, walk this playbook to localize the cause.

## Step 0 — Triage the symptom

Before touching the worker, classify the symptom against these axes:

| Question | Why it matters |
|---|---|
| Is the destination missing ACEs entirely, or has wrong ACEs? | "Missing" → Bug 1, Bug 2, or Bug 6. "Wrong" → comparator semantics or filer translation. |
| Is `DaclProtected` correct on the destination? | If yes, comparator is happy with the bit but unhappy with the DACL contents → upstream pipeline issue. If no, → Bug 3. |
| How many ACEs are on the source? | If exactly one → first suspect Bug 1 (PowerShell unwrap). If many → Bug 6 (SID mapping) or Bug 2 (`isCallback`). |
| Are the ACEs inherited on source? | If yes and they're missing on dest → Bug 2 historical / DLM-root inheritance-mode transform / kernel auto-inherit interaction. |
| Is the worker NDM running, or is this from a standalone script? | Different code paths. Worker uses production `powershell.script.ts`; standalone uses `stamp-metadata.ps1` or Desktop test scripts which may have un-backported bugs. |
| Is identity mapping configured? | If yes, Bug 6 (SID mapping drops Invalid ACEs) is high on the list. Check `jobContext.jobConfig.options.isIdentityMappingAvailable`. |
| Is this the DLM root, or a sub-directory? | DLM root has the `applySmbInheritanceMode` transform applied; non-root doesn't. Determines whether inherited ACEs get flattened. |
| What's the filer? | ONTAP CIFS has known quirks in `mixed`/`unix` security style. Pure Windows NTFS is more predictable. |

## Step 1 — Read source and destination SDs directly

Bypass NDM entirely and use the worker's PowerShell P/Invoke layer (or any client that calls `GetNamedSecurityInfo`). Anchor truth in the bytes, not in any tool's interpretation.

Use the `Get-FileSecurityFast` script (extract from `powershell.script.ts` or use the standalone `dump_acl.ps1` pattern).

```powershell
# From a Windows host with SMB access to both source and dest:
Get-FileSecurityFast -path '\\source\share\path' | ConvertTo-Json -Depth 5 -Compress
Get-FileSecurityFast -path '\\dest\share\path'  | ConvertTo-Json -Depth 5 -Compress
```

Compare:
- `Owner`, `Group` — same SIDs?
- `DaclPresent`, `DaclProtected`, `DaclAutoInherit` — same booleans?
- `DaclAces` — same array shape, same Sid / AccessMask / AceType / AceFlags per element?
- `Sddl` (if dumped) — string-equal?

**If source and destination JSONs are byte-equal**, the stamp succeeded. The user's perception of the bug is wrong or the symptom is in a different file.

**If they differ**, note the field. Walk down the rest of the playbook with that field as the anchor.

## Step 2 — Compare against the bug catalog

Match the diff signature to `known-bugs-and-fixes.md`. Each bug there has a Signature section. If it matches:

- Apply the fix.
- Re-run the stamp.
- Confirm via Step 1 again.

If nothing matches, continue.

## Step 3 — Locate the loss

If source has ACEs that destination is missing, narrow down WHERE in the pipeline they vanish:

### 3a. Did stamp run at all?

Check the worker logs for the path:
```bash
grep '<file-path>' worker.log | grep -E '\[(Get|Set)-FileSecurityFast'
```

Look for:
- `[Get-FileSecurityFast:SRC]` lines → confirms read succeeded.
- `[Set-FileSecurityFast]` lines → confirms write ran, and tells you `DaclAceCount` going INTO the API call.

If `[Set-FileSecurityFast]` shows `DaclAceCount=N` (N > 0) but destination has 0 ACEs:
- Filer-side rejection (rare on `ntfs` security style, possible on `mixed`/`unix`).
- Or read-back is wrong — try `icacls` and `Get-Acl` cross-check.

If `[Set-FileSecurityFast]` shows `DaclAceCount=0` but source had ACEs:
- **Bug 1 (PowerShell unwrap)** — check the source has exactly one ACE.
- **Bug 6 (SID mapping)** — grep for `Invalid ACL SID for` in the same job's logs.

### 3b. Did SID mapping drop ACEs?

```bash
grep 'Invalid ACL SID for' worker.log | head
```

Each line is one dropped ACE. The `originalSid` field tells you which source SID couldn't be mapped.

To confirm:
```bash
# On the worker's Redis:
redis-cli -h <worker-redis> GET "<jobRunId>:identity:SID:<failing-sid>"
# Expected output: "Invalid" if mapping returned the sentinel.
# Expected output: <destination SID> if mapping succeeded.
# Expected output: (nil) if no entry — ACE would be preserved with original SID.
```

If the SID maps to `Invalid` and customer expects byte-faithful stamping, the fix is Bug 6 (job-config toggle).

### 3c. Did inheritance-mode transform drop ACEs?

Only fires on the DLM root. Check `command.ops[OPS_CMD.STAMP_META].params.applyInheritanceMode === true` for the affected command.

If yes AND `smbPermissionInheritanceMode: INHERIT_PERMS_AS_IS` (default):
- Inherited ACEs are dropped.
- Source ACE has `IsInherited: true` or `AceFlags & 0x10`? Then this transform is the cause.

If yes AND `smbPermissionInheritanceMode: INHERIT_PERMS_AS_EXPLICIT`:
- Inherited ACEs are converted to explicit, not dropped.
- Different bug if ACEs are missing.

### 3d. Did the filer reject the ACE silently?

Hardest case to diagnose. Symptoms:
- `[Set-FileSecurityFast]` shows `DaclAceCount > 0` and `rc=0`.
- Read-back via `Get-FileSecurityFast` shows fewer ACEs.

Possible causes:
- ONTAP CIFS in `mixed`/`unix` security style with strict name-mapping requirements.
- SID doesn't resolve in the destination's UNIX-user-map table.
- ACE size exceeds the filer's per-object SD limit.

Confirm via ONTAP CLI:
```
vserver cifs share show -vserver <svm> -fields acl
vserver cifs share access-control show -vserver <svm> -share <share>
vserver name-mapping show -vserver <svm>
vserver volume show -fields security-style
```

## Step 4 — Run the standalone reproduction

If NDM-side reads/writes are correct but the bug persists, isolate by running the worker's PowerShell primitives directly without going through NDM's TypeScript pipeline.

Use the worker host (`172.30.205.232` in our current test env, with `datamigrator` / `Dm@admin123` creds). The pattern:

```bash
# 1. Build the test script locally:
cat > /tmp/test.ps1 <<'PSEOF'
... PowerShell that calls Get-FileSecurityFast + Set-FileSecurityFast directly ...
PSEOF

# 2. Upload to worker via stdin:
cat /tmp/test.ps1 | sshpass -p 'Dm@admin123' ssh -o StrictHostKeyChecking=no \
  -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  datamigrator@172.30.205.232 \
  'powershell -NoProfile -Command "$input | Out-File -Encoding ASCII -FilePath C:\\Users\\datamigrator\\test.ps1"'

# 3. Run inside cmd-with-net-use so SMB redirector sessions are in process tree.
#    PowerShell launched via OpenSSH CANNOT see SMB mappings established outside its cmd parent.
sshpass -p 'Dm@admin123' ssh -o StrictHostKeyChecking=no \
  -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  datamigrator@172.30.205.232 \
  'net use \\<src-server>\<share> /user:ndmuser test@123 & \
   net use \\<dst-server>\<share> /user:ndmuser test@123 & \
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\datamigrator\test.ps1'
```

If the standalone reproduction succeeds (byte-faithful stamp) but NDM fails on the same paths, the bug is in NDM's TypeScript pipeline (SID mapping / Invalid-filter / inheritance-mode transform).

If the standalone reproduction also fails, the bug is in the PowerShell primitives or the filer.

## Step 5 — Bisect the PowerShell

When the bug is in PowerShell and not matched to a known one, instrument the `Set-FileSecurityFast` function:

```powershell
# Add log lines at every key state transition:
Write-Output "[INST] aces.Count=$($aces.Count) aces.GetType=$($aces.GetType().FullName)"
Write-Output "[INST] dacl.Count after build = $($dacl.Count) BinaryLength=$($dacl.BinaryLength)"
Write-Output "[INST] securityInfoFlags before cast = $securityInfoFlags ($($securityInfoFlags.GetType().Name))"
Write-Output "[INST] securityInfoFlags after [int] cast = $securityInfoFlags (0x$($securityInfoFlags.ToString('X8')))"
# Read-back IMMEDIATELY after SetSecurityInfo, inside the same function:
$readBack = Get-FileSecurityFast -path $path
Write-Output "[INST] read-back SDDL: $($readBack.Sddl)"
Write-Output "[INST] read-back AceCount: $($readBack.DaclAces.Count)"
```

Match against expected values. The first divergence between expected and observed identifies the bug.

## Step 6 — Cross-check with `icacls`, `Get-Acl`, and SDDL

For belt-and-suspenders verification, use three independent readers on the same path:

```powershell
# 1. icacls
icacls '\\dest\share\path'

# 2. Get-Acl (.NET wrapper)
(Get-Acl '\\dest\share\path').Sddl

# 3. Our P/Invoke (Get-FileSecurityFast)
Get-FileSecurityFast -path '\\dest\share\path' | ConvertTo-Json -Depth 5
```

If all three agree, the on-disk state is what they say. If they disagree (e.g., `Get-FileSecurityFast` sees ACEs that `icacls` doesn't render), suspect callback ACEs (Bug 2) — `icacls` filters non-standard ACE types.

The SDDL string is the most compact representation. Decode key markers:

| SDDL marker | Meaning |
|---|---|
| `O:<sid>` | Owner |
| `G:<sid>` | Group |
| `D:` | Beginning of DACL section |
| `D:P` | DACL is protected (SE_DACL_PROTECTED set) |
| `D:AI` | DACL is auto-inherited (SE_DACL_AUTO_INHERITED set) |
| `D:PAI` | Both protected and auto-inherited |
| `(A;...)` | Allow ACE |
| `(D;...)` | Deny ACE |
| `(A;OICI;...)` | OI + CI inheritance flags |
| `(A;OICIID;...)` | OI + CI + ID (inherited) flags |
| `;FA;` | FILE_ALL_ACCESS |
| `;0x1200a9;` | Raw mask (when no SDDL alias matches) |

A bare `D:` with nothing after = NULL DACL (allow all).
A `D:P` with no ACEs after = protected empty DACL (deny all).

## Step 7 — When to escalate to ONTAP

Get ONTAP cluster admin access and check:

```
# Are SIDs resolvable?
vserver cifs users-and-groups local-user show -vserver <svm>
vserver name-mapping show -vserver <svm>

# Is the volume's security style affecting behavior?
vserver volume show -volume <vol> -fields security-style
vserver volume show -volume <vol> -fields unix-permissions

# Are there filer-side audit events for our SetSecurityInfo calls?
event log show -severity * -event * -message-name *
```

In rare cases ONTAP rejects ACEs based on a configurable policy. The fix is filer-side configuration, not NDM.

## Worked example — diagnostic walk from CL0_EDA_BACKEND incident

Context: user reported `DaclProtected=true preserved on destination, but ACE missing`. Source had 1 explicit ACE.

1. **Step 1** — dumped both SDs. Confirmed source has 1 ACE, destination has 0.
2. **Step 2** — symptom matched Bug 6 (SID mapping) signature, but no `Invalid ACL SID for` in logs. Also matched Bug 1 (single-ACE unwrap) signature.
3. **Step 3a** — `[Set-FileSecurityFast]` log showed `DaclAceCount=0` going INTO the API call. So ACEs were lost BEFORE the API.
4. **Step 3b** — Redis check: no `Invalid` mapping for the SID. Ruled out Bug 6.
5. **Step 4** — Standalone reproduction with NDM's Write-SD-Named also failed. So bug is in PS, not in NDM TypeScript.
6. **Step 5** — Instrumented PS. Found `aces.GetType = PSCustomObject` (not array), `aces.Count = null`, loop never ran.
7. **Verdict** — Bug 1 (PowerShell unwrap on single-element-array property access).
8. **Fix** — added `[array]` cast to the assignment.
9. **Verification** — re-ran, destination got the ACE.

Total time: ~30 minutes of instrumentation. The key move was Step 5 — once you see `aces.GetType=PSCustomObject` you know exactly what's wrong.
