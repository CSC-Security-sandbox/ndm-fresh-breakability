# PowerShell Layer — `Get-FileSecurityFast` and `Set-FileSecurityFast`

Deep dive into the PowerShell embedded in `services/worker/.../powershell.script.ts`. Read this when the user is debugging the read or write side, or modifying the PS itself.

## File anchor

All paths in this file are relative to `services/worker/src/activities/core/migrate/command-execution/win-opeartions/powershell.script.ts`.

The PS is delivered as a TypeScript string constant (`psBaseAclDefinition` plus individual function exports). It runs in a PowerShell runspace launched by the worker via `WinShellService.executeCommand`.

## P/Invoke surface

```powershell
public class FastAcl {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetNamedSecurityInfo(
        string pObjectName, uint ObjectType, uint SecurityInfo,
        out IntPtr ppsidOwner, out IntPtr ppsidGroup,
        out IntPtr ppDacl, out IntPtr ppSacl, out IntPtr ppSecurityDescriptor);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern int SetSecurityInfo(
        IntPtr handle, int ObjectType, int SecurityInfo,
        IntPtr psidOwner, IntPtr psidGroup, IntPtr pDacl, IntPtr pSacl);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateFileW(
        string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition,
        uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}

public class MarshalHelpers {
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern int GetSecurityDescriptorLength(IntPtr pSecurityDescriptor);
}
```

**Notable choice:** the writer uses **handle-based `SetSecurityInfo`** (after `CreateFileW`), not the path-based `SetNamedSecurityInfo`. The codebase comment claims this avoids an ONTAP defect; we have empirically tested both APIs against the same cluster as of 2026-05-28 and both work identically. Treat the comment as historical context, not current truth.

## `Get-FileSecurityFast` — the read side

Flow:

1. Call `GetNamedSecurityInfo($path, SE_FILE_OBJECT=1, OWNER|GROUP|DACL=7, ...)`.
2. Read the SD bytes from `pSD` via `GetSecurityDescriptorLength` + `Marshal.Copy`.
3. Construct a `System.Security.AccessControl.RawSecurityDescriptor` from the bytes.
4. **Read control flags via `$sd.ControlFlags`** (NOT `$sd.Control` — that returns `$null` silently, see Bug 4).
5. Three-state DaclAces decision (see SKILL.md "Quick-reference invariants").
6. Emit JSON with manual logs-array splice (because `ConvertTo-Json` on a `System.Collections.Generic.List[string]` nested in PSCustomObject is unreliable in PS 5.1).

```powershell
$ctrl = $sd.ControlFlags          # ← CRITICAL: NOT $sd.Control
$daclPresent     = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -ne 0
$daclProtected   = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0
$daclAutoInherit = ($ctrl -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited) -ne 0

if ($daclPresent -and $sd.DiscretionaryAcl) {
    $daclAces = @()
    foreach ($ace in $sd.DiscretionaryAcl) {
        $daclAces += [PSCustomObject]@{
            Sid         = $ace.SecurityIdentifier.Value
            AccessMask  = $ace.AccessMask
            AceType     = [int]$ace.AceType
            AceFlags    = [int]$ace.AceFlags
            IsInherited = $ace.IsInherited
        }
    }
} elseif ($daclPresent) {
    $daclAces = @()    # SE_DACL_PRESENT=1 but no DACL bytes → empty present
} else {
    $daclAces = $null  # SE_DACL_PRESENT=0 → NULL DACL
}
```

### Why the manual JSON splice for logs

```powershell
$log_json = '[' + ((@($getAclLogs) | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ',') + ']'
$payload = [PSCustomObject]@{ ...data fields... } | ConvertTo-Json -Compress -Depth 5
Write-Output ($payload.TrimEnd('}') + ',"logs":' + $log_json + '}')
```

In Windows PowerShell 5.1, `ConvertTo-Json` on a `System.Collections.Generic.List[string]` property inside a PSCustomObject sometimes serializes as the list's own properties (Capacity/Count) instead of its items, depending on `-Depth` and the host. The manual splice guarantees logs ride as a real JSON array.

### Three-state contract on read

| Source SD state | `DaclPresent` | `DaclAces` |
|---|---|---|
| SE_DACL_PRESENT clear (NULL DACL) | `false` | `null` |
| SE_DACL_PRESENT set, no ACEs | `true` | `[]` |
| SE_DACL_PRESENT set, N ACEs | `true` | `[ace1, ..., aceN]` |

Phantom ACE bytes the kernel keeps around when SE_DACL_PRESENT is clear are intentionally **ignored** (see Bug 8). The read path trusts the control bit, not the byte layout.

## `Set-FileSecurityFast` — the write side

Flow:

1. Parse `$aclJson` via `ConvertFrom-Json` → `$securityInfo` (PSCustomObject).
2. Build `RawSecurityDescriptor`, set Owner/Group.
3. Decide `$stampNullDacl = ($securityInfo.DaclPresent -eq $false)`.
4. If not null DACL: build a `RawAcl(2, $aces.Count)`, insert each ACE via `CommonAce`.
5. Set control flags on the SD object (matches the source's protection/auto-inherit state).
6. Marshal Owner, Group, DACL bytes to native heap via `AllocHGlobal` + `Marshal.Copy`.
7. Compute `$securityInfoFlags` (OWNER | GROUP | DACL | maybe PROTECTED_DACL/UNPROTECTED_DACL).
8. Cast `$securityInfoFlags` to `[int]` — critical to survive the `0x80000000` overflow (Bug 3).
9. `CreateFileW` opens a handle with `WRITE_DAC | WRITE_OWNER | READ_CONTROL` and `FILE_FLAG_BACKUP_SEMANTICS` (required for directories).
10. `SetSecurityInfo($handle, ...)` writes the SD.
11. `CloseHandle` + `FreeHGlobal` in `finally`.
12. `Set-Attributes` separately if `$securityInfo.Attributes` is set.
13. Emit JSON `{success, unresolved_sids, logs}`.

### The four invariants that must hold

```powershell
# 1. PROTECTED_DACL constant must NOT silently promote to long.
$PROTECTED_DACL_SECURITY_INFORMATION = [int]0x80000000
# (or guard with `$securityInfoFlags = [int]$securityInfoFlags` immediately before P/Invoke)

# 2. isCallback (5th CommonAce arg) is ALWAYS false.
$commonAce = New-Object System.Security.AccessControl.CommonAce(
    [System.Security.AccessControl.AceFlags]$ace.AceFlags,
    $qualifier,
    [int]$ace.AccessMask,
    $sid,
    $false,                                          # ← never $ace.IsInherited!
    $null
)

# 3. DaclAces must be [array]-cast on consumption.
[array]$aces = if ($null -eq $securityInfo.DaclAces) { @() } else { @($securityInfo.DaclAces) }

# 4. Null DACL path passes pDacl = IntPtr.Zero AND omits PROTECTED/UNPROTECTED flags.
if ($stampNullDacl) {
    $ptrDacl = [IntPtr]::Zero
    # securityInfoFlags includes DACL but not PROTECTED_DACL/UNPROTECTED_DACL
}
```

### CommonAce constructor signature — what each arg means

```
CommonAce(
    [AceFlags] aceFlags,         # bitfield: OI 0x01, CI 0x02, NP 0x04, IO 0x08, INH 0x10
    [AceQualifier] qualifier,    # AccessAllowed or AccessDenied
    int accessMask,              # the rights bitmask
    SecurityIdentifier sid,      # the trustee
    bool isCallback,             # ← MUST be $false for standard DACL ACEs (see Bug 2)
    byte[] opaque                # null for standard ACEs
)
```

The mistake of passing `IsInherited` here is so consequential it deserves its own paragraph: when `isCallback=$true`, the constructor calls `TypeFromQualifier(isCallback=true, qualifier)` which returns `ACCESS_ALLOWED_CALLBACK_ACE_TYPE` (9) for allow or `ACCESS_DENIED_CALLBACK_ACE_TYPE` (10) for deny. These types are reserved for conditional ACEs (the kernel evaluates an expression in the opaque blob to decide grant/deny). With `opaque=$null`, there's no expression — the ACE is structurally valid but functionally invisible. `icacls` may or may not render it; the gate's projection filters it out; access checks skip it.

The inheritance information is already in `AceFlags & 0x10`, which round-trips through the AceFlags cast. There's nothing for `isCallback` to do for standard ACEs.

### Why handle-based instead of path-based

```powershell
$handle = [FastAcl]::CreateFileW(
    $path,
    [uint32]($WRITE_DAC -bor $WRITE_OWNER -bor $READ_CONTROL),
    [uint32]$FILE_SHARE_READ_WRITE_DELETE,
    [IntPtr]::Zero,
    [uint32]$OPEN_EXISTING,
    [uint32]$FILE_FLAG_BACKUP_SEMANTICS,
    [IntPtr]::Zero
)
# ... then SetSecurityInfo($handle, ...) instead of SetNamedSecurityInfo($path, ...)
```

Per the codebase comment: "SetNamedSecurityInfo + DACL_SECURITY_INFORMATION + PROTECTED_DACL_SECURITY_INFORMATION silently zeroes the DACL bytes on disk on some ONTAP builds, returning rc=0."

**We have not reproduced this on the current `newroot-cedd.rootdomain.local` cluster as of 2026-05-28.** Both APIs work. The handle-based path is operationally neutral on this filer. The comment may be:
- Stale (defect patched in current ONTAP build).
- Misattributed (the original symptom was probably one of the upstream bugs — `.Control`, `isCallback`, `0x80000000`).
- Real on a different ONTAP build not in our test matrix.

Reverting to `SetNamedSecurityInfo` would be safe today but doesn't buy anything. Keeping the handle-based path is fine.

`FILE_FLAG_BACKUP_SEMANTICS` is **mandatory** when stamping directories (otherwise `CreateFileW` returns `ERROR_ACCESS_DENIED` for them). It does no harm on files. Always include it.

`FILE_SHARE_READ|WRITE|DELETE` keeps the share mode permissive so we never block concurrent SMB clients while we hold the handle. Important because stamps can take seconds on large DACLs.

### Memory cleanup pattern

```powershell
$ptrOwner = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(...)
# ... AllocHGlobal for Group, DACL ...
try {
    $rc = [FastAcl]::SetSecurityInfo($handle, ...)
} finally {
    [FastAcl]::CloseHandle($handle) | Out-Null
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrOwner)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrGroup)
    if ($ptrDacl -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrDacl)
    }
}
```

The DACL pointer can be `IntPtr.Zero` (null DACL stamp), so the free is gated. Owner/Group are always allocated (the read side guarantees they're non-null since GetNamedSecurityInfo always provides them for files).

The `Get-FileSecurityFast` side intentionally does NOT free the SD pointer it gets back from `GetNamedSecurityInfo` — the comment notes this should use `LocalFree` (not `FreeHGlobal`), and skipping it to avoid a crash is the lesser evil. This is a small per-call memory leak. Not critical for migration workloads but worth noting.

## Logs payload format

```json
{
  "Owner": "S-1-5-21-...",
  "Group": "S-1-5-21-...",
  "DaclAces": [...] | null,
  "DaclPresent": true,
  "DaclProtected": true,
  "DaclAutoInherit": true,
  "Attributes": "Directory",
  "logs": ["start path=...", "GetNamedSecurityInfo ok elapsed=12ms", "parsed Owner=... ..."]
}
```

The `logs` array carries free-form diagnostic strings. The TS-side `forwardGetAclScriptLogs` / equivalent forwards each entry to the worker's logger with tagged prefixes (`[Get-FileSecurityFast:SRC]`, `[Set-FileSecurityFast]`).

## How to add a new field to the SD

If you need to read/write a new field (e.g., SACL support):

1. **Read side** — add the field to the `[PSCustomObject]@{...}` payload in `Get-FileSecurityFast`. Update the manual JSON splice if you're adding it after the `}` truncation point.
2. **Write side** — add the field to `$securityInfo` consumption in `Set-FileSecurityFast`. Decide if it's a DACL/SACL/owner/group field and update `$securityInfoFlags` accordingly.
3. **TS type** — update `SecurityDescriptor` in `acl-operation.type.ts`.
4. **Comparator** — decide if the field should be compared. Add to `securityDescriptorEquals` and the mismatch field union.
5. **Validator** — add symmetric check in `validateAclOperation`.
6. **Tests** — add coverage to `security-descriptor-change-detector.service.spec.ts` (matrix sections) and `docs/acl-comparator-test-matrix.md`.

For SACL specifically: requires `SeSecurityPrivilege` to be acquired in the PS runspace (`GetNamedSecurityInfo` with `SACL_SECURITY_INFORMATION` fails otherwise). Currently not in the pipeline — see SKILL.md.

## How to test PS changes locally

The worker host has `C:\Users\datamigrator\Desktop\standalone.ps1` for direct end-to-end testing. Pattern:

```bash
# From your laptop, upload via stdin → file:
cat /tmp/my_script.ps1 | sshpass -p '<datamigrator-password>' ssh -o ... datamigrator@<worker-ip> \
  'powershell -NoProfile -Command "$input | Out-File -Encoding ASCII -FilePath C:\\Users\\datamigrator\\Desktop\\standalone.ps1"'

# Then run inside cmd-with-net-use so SMB redirector sessions are in process tree:
sshpass -p '...' ssh ... datamigrator@<worker-ip> \
  'net use \\<src-server>\<share> /user:<user> <pass> & net use \\<dst-server>\<share> /user:<user> <pass> & \
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\datamigrator\Desktop\standalone.ps1'
```

The `cmd /c "net use ... & powershell ..."` chain is essential — PowerShell launched via OpenSSH can't see SMB redirector mappings established outside its own cmd parent process. See `diagnostic-playbook.md` for the full SSH dance.
