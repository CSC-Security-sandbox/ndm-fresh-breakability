# Known ACL Bugs in NDM — Catalog

Highest-value reference. Most "new" ACL bugs reported by the user are recurrences of one of these. Match the symptom against the catalog before opening a fresh investigation. Entries are roughly chronological (newest first) with the most-recent debugging session at the top.

Each entry has the same shape:

- **Symptom** — what the user sees
- **Cause** — what's actually happening
- **Signature** — telltale evidence that confirms this is the bug
- **Fix** — one-line patch or a small refactor
- **Status** — whether the fix has landed in `services/worker/`, in `scripts/`, in the on-host standalone, etc.
- **Date** — when we last confirmed this

---

## Bug 1 — PowerShell single-element-array unwrap in `Set-FileSecurityFast`

**Symptom**
- Source folder has *exactly one* explicit ACE.
- After stamp: destination shows `DaclPresent: true, DaclProtected: true (or false), DaclAces: []`.
- `icacls` on destination prints: `No permissions are set. All users have full control.`
- `SetSecurityInfo` / `SetNamedSecurityInfo` returns `rc=0`. No error in logs.
- Two-ACE sources work fine, single-ACE sources fail. **Asymmetric by ACE count.**

**Cause**
`Set-FileSecurityFast` parses the inbound JSON via `ConvertFrom-Json` to a `PSCustomObject`. When `DaclAces` is a single-element array in JSON, PowerShell's property accessor (`$securityInfo.DaclAces`) auto-unwraps it to the bare `PSCustomObject`. The line:

```powershell
$aces = if ($null -eq $securityInfo.DaclAces) { @() } else { @($securityInfo.DaclAces) }
```

…fails to re-wrap because the `if/else` expression assignment context also unwraps. `$aces` lands as a `PSCustomObject` (not an array). `$aces.Count` is `$null` (PSCustomObject has no Count property). The loop `for ($i = 0; $i -lt $aces.Count; $i++)` never executes. The DACL is built empty. The destination is stamped with `RawAcl(2, 0)` + `PROTECTED_DACL` → "deny-everyone" sealed folder.

**Signature**
- Add an instrumented log line just inside `Set-FileSecurityFast`'s loop entry: `Write-Output "aces.Count=$($aces.Count) aces.GetType=$($aces.GetType().FullName)"`. If you see `aces.Count=` (empty) and `aces.GetType=System.Management.Automation.PSCustomObject`, this is the bug.
- Source has exactly one ACE; destination has zero. Two ACEs would work.

**Fix**
Add `[array]` type constraint to force array preservation:

```powershell
[array]$aces = if ($null -eq $securityInfo.DaclAces) { @() } else { @($securityInfo.DaclAces) }
```

**Status**
- ✅ `services/worker/.../powershell.script.ts:221` — fixed (committed).
- ✅ Worker host `C:\Users\datamigrator\Desktop\standalone.ps1` — fixed in session 2026-05-28.
- ❌ `scripts/stamp-metadata.ps1:610` — **still has the bug** as of 2026-05-28.

**Date** 2026-05-28

---

## Bug 2 — `isCallback` mis-pass turning Allow/Deny ACEs into invisible callback ACEs

**Symptom**
- Source has inherited ACEs (typical: children of a parent with OI|CI ACE).
- After stamp, destination children show none of the expected ACEs in `icacls`.
- Get-FileSecurityFast on destination reads ACEs with **`AceType: 9` or `AceType: 10`** instead of `0` / `1`.
- The gate's `getComparableAces` filters out non-{0,1} types, so the gate doesn't surface these "ghost" ACEs as drift.
- Pre-NDM-3366 era: both root and children silently lost their inherited ACEs. Post-NDM-3366 era: only children fail (the DLM-root inheritance-mode transform converts inherited→explicit before reaching the buggy CommonAce constructor, so the root is incidentally fixed).

**Cause**
The 5th parameter of `System.Security.AccessControl.CommonAce(...)` is named **`isCallback`**, NOT "isInherited". When `$true` is passed, the ACE is constructed as `ACCESS_ALLOWED_CALLBACK_ACE_TYPE` (9) or `ACCESS_DENIED_CALLBACK_ACE_TYPE` (10). These are valid ACE types in the SD byte layout but have no conditional expression — kernel access checks treat them as non-functional, `icacls` may render them as raw hex, and the gate's projection drops them entirely.

The original NDM code passed `$ace.IsInherited` here:

```powershell
$commonAce = New-Object System.Security.AccessControl.CommonAce(
    [System.Security.AccessControl.AceFlags]$ace.AceFlags,
    $qualifier,
    [int]$ace.AccessMask,
    $sid,
    $ace.IsInherited,    # ← BUG — this is `isCallback`, not `isInherited`
    $null
)
```

For any ACE with `IsInherited: true` (the common case for children), `isCallback=$true` → invisible ACE on destination.

The "inherited" semantic is encoded in `AceFlags` bit `0x10` (`INHERITED_ACE`) and round-trips through the `[AceFlags]$ace.AceFlags` cast already.

**Signature**
- Source ACE has `IsInherited: true` OR `AceFlags & 0x10`.
- Destination read shows ACEs with `AceType: 9` or `10`, or no ACEs at the comparable layer.
- `icacls` output is empty / non-standard for affected files.

**Fix**
Hardcode `$false`:

```powershell
$commonAce = New-Object System.Security.AccessControl.CommonAce(
    [System.Security.AccessControl.AceFlags]$ace.AceFlags,
    $qualifier,
    [int]$ace.AccessMask,
    $sid,
    $false,    # isCallback — NEVER true for standard DACL ACEs
    $null
)
```

**Status**
- ✅ `services/worker/.../powershell.script.ts:288` — fixed.
- ❓ `scripts/stamp-metadata.ps1` — verify (the file strips the inherited bit from AceFlags entirely, which is a different stylistic choice that incidentally avoids the visible-vs-invisible split but produces explicit ACEs everywhere).

**Date** 2026-05-26

---

## Bug 3 — `0x80000000` constant promotion losing `PROTECTED_DACL_SECURITY_INFORMATION` bit

**Symptom**
- Source folder has `DaclProtected: true` (inheritance disabled).
- After stamp, destination shows `DaclProtected: false` even though the rest of the SD landed correctly.
- `SetSecurityInfo` / `SetNamedSecurityInfo` returns `rc=0`, no error.
- Gate flags `daclProtected` drift on every subsequent scan → restamp loops forever.

**Cause**
PowerShell parses the hex literal `0x80000000` (= 2,147,483,648) as `[long]` because it doesn't fit in positive `[int]` range. The expression:

```powershell
$securityInfoFlags = [int]($securityInfoFlags -bor $PROTECTED_DACL_SECURITY_INFORMATION)
```

…produces a `[long]` from the `-bor`, and the `[int]` cast then either throws `OverflowException` (Windows PowerShell 5.1 strict mode) or truncates the high bit (PS Core 7+) depending on the host. In either case, `PROTECTED_DACL_SECURITY_INFORMATION` doesn't make it into the API call, so `SetSecurityInfo` doesn't set the SE_DACL_PROTECTED bit on the destination.

**Signature**
- Source SDDL contains `P` in the DACL flags section (`D:PAI...` or `D:P...`).
- Destination SDDL is missing the `P` (`D:AI...` or `D:...`).
- The bug fires whenever the source has the protection bit, not for unprotected sources.

**Fix**
Declare the constant with explicit `[int]` cast at the source:

```powershell
$PROTECTED_DACL_SECURITY_INFORMATION = [int]0x80000000   # = -2147483648 (signed)
```

Then the subsequent `-bor` stays in `[int]` throughout and the explicit cast at the call site can be dropped. Defense in depth: even better to keep `$securityInfoFlags = [int]$securityInfoFlags` immediately before the P/Invoke as a belt-and-suspenders guard.

**Status**
- ✅ `services/worker/.../powershell.script.ts` — fixed via the `[int]$securityInfoFlags` cast at the call site (line ~390). The declaration is still `0x80000000` (line ~347) which is fine because the cast catches it.
- ❓ `scripts/stamp-metadata.ps1` — verify.

**Date** 2026-05-26

---

## Bug 4 — `$sd.Control` returns `$null` (silent property typo)

**Symptom**
- Every destination ends up with `DaclPresent: false, DaclProtected: false, DaclAutoInherit: false` regardless of source state.
- `icacls` on destination reports `No permissions are set. All users have full control.` (null DACL).
- The destination's stored SD bytes contain a real DACL with real ACEs that read correctly via `RawSecurityDescriptor.GetSddlForm()`, but the script reports null DACL.
- Children of the destination root don't inherit anything.

**Cause**
`Get-FileSecurityFast` used `$ctrl = $sd.Control`. **`RawSecurityDescriptor` does not have a `.Control` property** — the .NET API exposes it as `.ControlFlags`. PowerShell silently returns `$null` for unknown property accesses (no strict mode), so:

```powershell
$ctrl = $sd.Control                        # $null
$daclPresent = ($ctrl -band [...DiscretionaryAclPresent]) -ne 0   # $null -band 4 = 0, -ne 0 = $false
```

Every per-bit check returns false. With the new three-state `DaclAces` representation, this also forces `DaclAces: null` even when the bytes contain real ACEs. The Set-side then sees `DaclPresent: false` and writes a null DACL to destination.

**Signature**
- `Read-SD` of any file (where source has a real DACL) returns `{DaclPresent: false, DaclProtected: false, DaclAutoInherit: false, DaclAces: null}`.
- But the same file's `sd.ControlFlags.ToString()` returns `"DiscretionaryAclPresent, ..."`.
- `sd.GetSddlForm()` shows a real `D:PAI(...)` form.
- `[int]$ctrl` (or `0x{0:X4}` -f $ctrl) prints `0x0000`.

**Fix**
One line:

```powershell
$ctrl = $sd.ControlFlags
```

Also: add `Set-StrictMode -Version 2.0` at the top of the PowerShell to catch this class of bug at runtime instead of silently returning `$null`.

**Status**
- ✅ `services/worker/.../powershell.script.ts:122` — fixed (commit `0f90f2d90` "changing from Control to ControlFlags").
- ✅ `scripts/stamp-metadata.ps1` — verify (likely already uses correct name).

**Date** 2026-05-26

---

## Bug 5 — `DaclProtected` heuristic forcing the bit on objects that aren't protected

**Symptom** (historical — pre-removal)
- Stamping faithfully copied source SD, but destination ended up with `DaclProtected: true` on objects whose source had `DaclProtected: false`.
- Once present, the heuristic was self-perpetuating on incremental scans.
- Side effect: blocked inheritance on destination children whose source had no inherited ACEs.

**Cause**
Old heuristic in `Get-FileSecurityFast`:

```powershell
if (-not $hasInheritedAces -and $daclPresent -and $sd.DiscretionaryAcl -and $sd.DiscretionaryAcl.Count -gt 0) {
    $daclProtected = $true
}
```

The intent was "if the DACL has only explicit ACEs, it's probably protected." But that's not what SE_DACL_PROTECTED means. The bit is a per-object semantic toggle ("do not inherit from parent"), not a heuristic inference. The heuristic mis-fires for:

- Files at the share root (no parent to inherit from).
- Parent with empty DACL (nothing inheritable).
- Parent with OI-only or CI-only ACEs targeting wrong object class.
- Files whose inherited permissions were converted to explicit via Windows Explorer "Disable inheritance → Convert to explicit".
- ONTAP CIFS edge cases where SE_DACL_PRESENT / inherited bits aren't faithfully round-tripped.

**Signature**
- Destination's SDDL has `P` flag where source didn't.
- Heuristic comment in the source code (now commented out).

**Fix**
Trust the real `SE_DACL_PROTECTED` control bit. The heuristic was removed.

**Status**
- ✅ `services/worker/.../powershell.script.ts` — heuristic is now commented out (lines 106-127). The commented block is fine to keep as historical context but could be deleted in a cleanup pass.

**Date** Removed in current branch (heuristic was active before)

---

## Bug 6 — SID-mapping `'Invalid'` filter silently drops ACEs

**Symptom**
- Source folder has DaclProtected=true + a valid explicit ACE.
- After stamp, destination has DaclProtected=true preserved but ACEs are missing (empty DACL).
- Different signature from Bug 1: this fires even with multi-ACE sources, as long as those ACEs' SIDs aren't resolvable by the destination identity map.
- Visible only when `jobContext.jobConfig.options.isIdentityMappingAvailable === true`.

**Cause**
`stampAclOperation` runs `mapSIDToTarget` on the incoming SD when identity mapping is configured. For each ACE's SID, it queries Redis for a destination-domain equivalent. If Redis returns the literal string `'Invalid'`, `mapSIDToTarget` sets `ace.Sid = 'Invalid'`. The next stage in `stampAclOperation` filters out any ACE with `Sid === 'Invalid'`:

```typescript
if (acl.DaclAces) {
  acl.DaclAces = acl.DaclAces.filter((ace) => {
    if (ace.Sid === 'Invalid') {
      errors.push(`Invalid ACL SID for ${ace.originalSid} found in SID mapping`);
      return false;
    }
    return true;
  });
}
```

DaclProtected lives on the SD root and is never touched by SID mapping, so it survives. ACEs are dropped one-by-one. Destination ends up with `{DaclPresent: true, DaclProtected: true, DaclAces: []}` — sealed and empty, effectively deny-all.

**Signature**
- `command.ops[OPS_CMD.STAMP_META].params.error` contains the string `"Invalid ACL SID for"`.
- Redis lookup against `<jobRunId>:identity:SID:<source-sid>` returns the literal value `"Invalid"`.
- Worker logs show one `"Invalid ACL SID for"` line per dropped ACE.

**Fix**
Two options, neither yet implemented in production:

1. **Surface the loss more visibly** — promote the per-ACE error from `errors.push(...)` to a structured INFO log line that includes the source path, the dropped SID, and the resolved name (if any). The current "push to errors array" path is too easy to miss.
2. **Decide policy explicitly** — add a job-config toggle like `dropInvalidSids: 'drop' | 'preserve' | 'fail'`. Default to `drop` (current behavior) for backward compat, but allow customers who want byte-faithful stamping to choose `preserve` (write the raw SID even if it doesn't resolve) or `fail` (halt the stamp and surface a per-file error).

**Status**
- ❌ Not fixed. Current code drops silently.

**Date** Identified 2026-05-28; root-cause confirmed via standalone reproduction against same SIDs on same filer (worked outside NDM pipeline, failed inside).

---

## Bug 7 — Comparator vs Validator divergence (silent permission elevation in audit trail)

**Symptom**
- Post-stamp audit record in `command.ops[OPS_CMD.STAMP_META].params.sidMap` says "valid" (no errors).
- Next incremental scan's gate flags `aceFieldDiff` / `aceExtraOnDestination` and triggers a restamp.
- The restamp produces the same output, validate says "valid" again, gate flags again — loop.
- Destination ends up with MORE permissions than source (subset match), but audit doesn't surface it.

**Cause**
The post-stamp validator (`validateAclOperation`) and the scan-time gate (`securityDescriptorEquals`) use different equality definitions:

| Check | Gate | Validator |
|---|---|---|
| ACE count | strict equality required | not checked |
| Extra ACEs on dest | flagged (`aceExtraOnDestination`) | silently OK |
| AccessMask | strict equality | subset match (`(tgt & src) === src`) — dest can have MORE |
| AceFlags | strict equality | strict equality (recently aligned) |
| ACE order | positional comparison | set-based |
| DaclProtected | compared | compared |
| DaclPresent | compared | compared |

The validator was the original audit mechanism (R-series tests pin these as known divergences). The gate is the newer, stricter mechanism. They disagree on three things: subset vs equal mask, set-vs-positional order, and missing vs extra ACEs.

**Signature**
- Test R2 (`KNOWN DIVERGENCE: dest has extra ACE`), R3 (`mask superset`), R4 (`reorder`), R5 (`AceFlags diff`) in `security-descriptor-change-detector.service.spec.ts` pin the divergences as failing-loud tests.
- Production symptom: gate flags drift on a file the validator just said was "valid".

**Fix**
Make `validateAclOperation` delegate to `securityDescriptorEquals` and translate the structured `reason` into the `inValid` string. Single source of truth.

**Status**
- ❌ Not fixed. Subset match on AccessMask still in `win-operation.service.ts:503`.
- Pinned as known divergence in tests.

**Date** Identified across multiple sessions; documented in conversation 2026-05-25.

---

## Bug 8 — Phantom DACL: source has ACEs in byte form but SE_DACL_PRESENT=0

**Symptom**
- Source SD has `DaclPresent: false` (in JSON) but earlier debugging shows the byte form contains real ACE bytes.
- This was the data shape `{"DaclPresent": false, "DaclAces": [{...}]}` we saw at one point in user-reported JSON.
- Stamp writes a null DACL to destination, dropping the ACE.

**Cause**
Two layered causes:
1. **The `$sd.Control` bug (Bug 4)** was the upstream cause for almost all phantom-DACL reports. With Control returning `$null`, DaclPresent always reads as `false` regardless of actual control bits, and the older `Get-FileSecurityFast` was inconsistent about whether to surface DaclAces when DaclPresent was false. This produced contradictory JSON.
2. **ONTAP CIFS in `mixed`/`unix` security style** can genuinely return SDs where `SE_DACL_PRESENT` is clear but the byte layout contains a populated DACL structure. Native Windows interprets this as null DACL; .NET's parser surfaces the ACEs anyway. The `Get-FileSecurityFast` three-state representation (`DaclPresent=false → DaclAces=null` strict) now correctly ignores those phantom bytes.

**Signature**
- Source JSON shape: `{"DaclPresent": false, "DaclAces": [{...}], ...}` — contradictory.
- After Bug 4 fix and the three-state rewrite: this shape should no longer be produced by the read path.

**Fix**
Three-state contract in `Get-FileSecurityFast`:

```powershell
if ($daclPresent -and $sd.DiscretionaryAcl) {
    $daclAces = @()
    foreach ($ace in $sd.DiscretionaryAcl) { $daclAces += [PSCustomObject]@{...} }
} elseif ($daclPresent) {
    $daclAces = @()
} else {
    $daclAces = $null
}
```

Matched by `Set-FileSecurityFast`'s `$stampNullDacl = ($securityInfo.DaclPresent -eq $false)` branch which honors the boolean directly.

**Status**
- ✅ Fixed in `services/worker/.../powershell.script.ts` via Bug 4 fix + three-state rewrite (lines 142-157).
- ❓ Standalone scripts on the worker desktop may have older logic.

**Date** Diagnosed 2026-05-26, fixed in same window.

---

## Bug 9 — Comparator restamp loop on `DaclAutoInherit` flicker

**Symptom**
- Gate flags `daclAutoInherit` mismatch on every incremental scan, even when no other field changed.
- Restamp produces identical output but the bit flicks on subsequent reads.

**Cause**
Windows' kernel inheritance engine sets and clears `SE_DACL_AUTO_INHERITED` on its own as a side effect of inheritance propagation. The value the worker writes is not guaranteed to be the value read back even on a byte-faithful stamp.

**Fix**
Drop the `DaclAutoInherit` check from both `securityDescriptorEquals` and `validateAclOperation`. The bit is still read and written (kernel-driven semantics preserved); only the comparator declines to gate on it.

**Status**
- ✅ Fixed. Comparator skips the field (`security-descriptor-change-detector.service.ts:204-212`). Validator skips it symmetrically (`win-operation.service.ts:449-453`).

**Date** Diagnosed 2026-05-24, fixed same session.

---

## Bug 10 — CREATOR OWNER (`S-1-3-0`) restamp loop on every scan

**Symptom**
- Gate flags `aceFieldDiff` for CREATOR OWNER ACEs on every incremental scan.
- Restamp writes identical bytes but the next read shows different mask/flags.

**Cause**
CREATOR OWNER is a placeholder principal. When the kernel evaluates inheritance, it rewrites these ACEs in place — substituting the actual owner's SID, expanding GENERIC_ALL to FILE_ALL_ACCESS, and toggling inheritance flag bits. The mutations are idempotent on the destination but the on-disk byte form is not stable across reads. Strict positional comparison loops forever.

**Fix**
Partition CREATOR OWNER ACEs out of both sides, compare them count-by-`AceType` (lenient), and compare the non-CREATOR-OWNER remainder strictly and positionally. Same policy applied in the validator.

**Status**
- ✅ Fixed. `security-descriptor-change-detector.service.ts:54-77, 226-286`. Validator special-cases CREATOR OWNER similarly (`win-operation.service.ts:487-495`).

**Date** Diagnosed and fixed multiple sessions ago.

---

## Bug 11 — `mapSIDToTarget` mutating its input (latent)

**Symptom**
- None currently observable.
- Latent risk: if anyone caches a `SecurityDescriptor` (e.g., LRU on path), feeding it into `mapSIDToTarget` corrupts the cache for subsequent callers.

**Cause**
The old `mapSIDToTarget` modified `acl.Owner`, `acl.Group`, and each `acl.DaclAces[i].Sid` in place. With two callers (`stampAclOperation` and `prepareExpectedDestinationSecurityDescriptor`) the mutation surface doubled.

**Fix**
`mapSIDToTarget` now returns a new object via spread; never mutates input (`win-operation.service.ts:365-394`).

**Status**
- ✅ Fixed.

**Date** Fixed before 2026-05-28 review.

---

## How to add new bugs to this catalog

When you find a new ACL bug in a future session:

1. Add an entry at the **top** of this file (above Bug 1) with the next bug number.
2. Use the same shape: Symptom / Cause / Signature / Fix / Status / Date.
3. Update the bug-number references in `SKILL.md` if there's a relevant one to call out.
4. If the bug is a recurring pattern (e.g., another PowerShell gotcha), also add a one-paragraph entry to `references/powershell-pitfalls.md`.

The point of this catalog is that future investigators can match a symptom in 60 seconds instead of re-deriving the whole pipeline from scratch.
