# PowerShell Pitfalls in NDM's ACL Code

The recurring PowerShell-specific gotchas in one place. Read this when:
- The user is writing or modifying any PowerShell that touches `Get-FileSecurityFast` / `Set-FileSecurityFast`.
- The user is debugging behavior that doesn't match what the source code looks like it should do.
- You're about to suggest a PowerShell change and want to avoid re-introducing a fixed bug.

Each pitfall here was discovered the hard way. The cost of NOT respecting them is silent data loss.

## Pitfall 1 — Silent property typos return `$null`

PowerShell default mode treats unknown property access as `$null`. So:

```powershell
$sd = New-Object System.Security.AccessControl.RawSecurityDescriptor($bytes, 0)
$ctrl = $sd.Control                   # ← $null. The real property is .ControlFlags.
$daclPresent = ($ctrl -band [...]::DiscretionaryAclPresent) -ne 0
# = ($null -band 4) -ne 0
# = 0 -ne 0
# = $false
# … no error. Just wrong.
```

**Defense:** Add `Set-StrictMode -Version 2.0` at the top of every PowerShell function. Then any typo throws `PropertyNotFoundException` at runtime.

**Verification:** Use `$obj | Get-Member -MemberType Properties` to enumerate real properties before writing code against an object.

**Real example:** Bug 4 — every per-bit control flag check silently returned false because `$sd.Control` was used instead of `$sd.ControlFlags`. The bug was production-active until empirical introspection caught it.

## Pitfall 2 — Single-element-array unwrap on property access

PowerShell unwraps single-element collections when accessed via property dot-notation.

```powershell
# Producer:
$aces = @()
$aces += [PSCustomObject]@{Sid = '...'}      # $aces is Object[] with 1 element
$obj = [PSCustomObject]@{ DaclAces = $aces }  # DaclAces property holds the array

# Consumer:
$aces = $obj.DaclAces                          # ← could be the PSCustomObject, not the array!
$aces.Count                                    # → $null (PSCustomObject has no Count)
for ($i = 0; $i -lt $aces.Count; $i++) {      # → loop never runs
    ...
}
```

**Defense:** Use `[array]` type constraint when consuming:

```powershell
[array]$aces = $obj.DaclAces           # forces array preservation
```

Or use `foreach (... in @(...))` idiom which always forces array context at the boundary:

```powershell
foreach ($ace in @($obj.DaclAces)) {   # @() at foreach boundary forces array
    ...
}
```

The `@(pipeline)` form is also safe — `@()` around a real pipeline (like `Where-Object` output) always produces an array.

**Real example:** Bug 1 — destinations with single-ACE sources lost all ACEs because the `for` loop never executed. Two-ACE sources worked fine. The asymmetry is the signature.

## Pitfall 3 — `0x80000000` promotes to `[long]`

PowerShell parses integer literals as the smallest type that fits. `0x80000000` = 2,147,483,648 > `[int]::MaxValue` = 2,147,483,647, so it's parsed as `[long]`.

```powershell
$PROTECTED_DACL = 0x80000000                  # type: [long]
$flags = 0x7                                   # type: [int]
$combined = $flags -bor $PROTECTED_DACL        # type: [long] (promoted)
$signed = [int]$combined                       # → throws or truncates depending on PS host
```

**Defense:** Force the cast at declaration time:

```powershell
$PROTECTED_DACL = [int]0x80000000      # type: [int], value: -2147483648 (signed)
```

Then subsequent `-bor` stays in `[int]`. The bit pattern at the P/Invoke boundary is identical whether the variable is signed or unsigned (both are 32-bit `0x80000000`), so the Win32 API reads it correctly as `DWORD`.

**Real example:** Bug 3 — `PROTECTED_DACL_SECURITY_INFORMATION` was lost on every stamp where source had `DaclProtected: true`. Destination's SE_DACL_PROTECTED bit never got set. Gate flagged drift forever, restamp loop.

## Pitfall 4 — `ConvertTo-Json` default depth is too shallow

```powershell
ConvertTo-Json $obj                            # default -Depth 2
```

Properties deeper than depth 2 get serialized as their `ToString()` representation, not as JSON. For our security descriptor JSON, the ACE entries are at depth 2 and their properties are primitives at depth 3 — usually fine, but margins are thin.

**Defense:** Always pass `-Depth 5` (or more) for security-descriptor serialization:

```powershell
ConvertTo-Json $payload -Compress -Depth 5
```

## Pitfall 5 — `ConvertTo-Json` on `Generic.List[string]` is unreliable

```powershell
$logs = [System.Collections.Generic.List[string]]::new()
$logs.Add("hello")
$obj = [PSCustomObject]@{ logs = $logs }
ConvertTo-Json $obj -Compress
# May produce:  {"logs":["hello"]}      (correct, what we want)
# May produce:  {"logs":{"Capacity":4,"Count":1}}   (wrong! list's own properties)
```

The bug is depth-dependent and PS-version-dependent. Don't rely on this.

**Defense:** Build the logs array manually as a JSON string:

```powershell
$log_json = '[' + ((@($logs) | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ',') + ']'
# Then splice into the rest:
$payload = $obj | ConvertTo-Json -Compress -Depth 5
Write-Output ($payload.TrimEnd('}') + ',"logs":' + $log_json + '}')
```

This is what `Get-FileSecurityFast` and `Set-FileSecurityFast` do.

## Pitfall 6 — `ConvertTo-Json` on a 1-element array depends on `-AsArray`

PowerShell 5.1: a 1-element array WITHOUT `-AsArray` serializes as a single object literal `{...}` instead of `[{...}]`. Multi-element arrays always get brackets.

This is the symmetric of Pitfall 2 — the producer side of the unwrap issue. If your read script does:

```powershell
$daclAces = @()
$daclAces += [PSCustomObject]@{...}      # 1 ACE
$result = [PSCustomObject]@{ DaclAces = $daclAces }
$result | ConvertTo-Json -Compress
# Output: {"DaclAces":[{...}]}  (PS 5.1 specifically preserves brackets when the
#         hashtable literal property holds a typed Object[] array — confirmed
#         empirically for Get-FileSecurityFast output)
```

The behavior is generally OK because `@()` followed by `+=` produces a properly-typed `Object[]` that `ConvertTo-Json` recognizes as an array. But it's fragile.

**Defense:** If you ever see destination JSON like `"DaclAces":{"Sid":...}` (single object instead of array), pass `-AsArray` to `ConvertTo-Json`:

```powershell
$daclAces | ConvertTo-Json -Compress -Depth 5 -AsArray
```

## Pitfall 7 — Functions returning collections may have output unwrapped

```powershell
function Get-Dacl {
    $dacl = New-Object System.Security.AccessControl.RawAcl(...)
    return $dacl
}

$x = Get-Dacl
# $x might be the RawAcl, or might be the first ACE inside it,
# because RawAcl is enumerable and PowerShell's output stream
# can unwrap on function return.
```

**Defense:** Force single-element return with the comma operator:

```powershell
function Get-Dacl {
    $dacl = New-Object System.Security.AccessControl.RawAcl(...)
    return , $dacl    # comma forces array-of-one return, preserves outer object
}
```

Or assign to `$script:dacl` for scope visibility and don't rely on return.

## Pitfall 8 — `+=` on `@()` is O(n²) for large arrays

```powershell
$arr = @()
for ($i = 0; $i -lt 10000; $i++) {
    $arr += $i              # ← creates a new array each time
}
# Total: 10000 * 10000 / 2 = 50M element copies. Pathologically slow.
```

For DACLs with thousands of ACEs (rare but possible), use a `List`:

```powershell
$list = [System.Collections.Generic.List[object]]::new()
for (...) { $list.Add($item) }
$arr = $list.ToArray()
```

Don't worry about this for typical DACLs (1-50 ACEs). It matters at the >1000 ACE scale.

## Pitfall 9 — `try/catch` in P/Invoke

P/Invoke calls can throw .NET exceptions for marshaling failures (e.g., null arg, type mismatch). Always wrap and check the return code separately:

```powershell
try {
    $rc = [FastAcl]::SetSecurityInfo($handle, ...)
} catch {
    # marshaling exception — handle and freeing handles/buffers
    throw
} finally {
    [FastAcl]::CloseHandle($handle) | Out-Null
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrOwner)
    # ... free all allocated buffers ...
}
if ($rc -ne 0) { throw "SetSecurityInfo failed rc=$rc" }
```

The `finally` block must run regardless of how the call exits (success, error rc, exception). Memory leaks from skipped `FreeHGlobal` add up across millions of stamps.

## Pitfall 10 — `[int]$x -bor $y` doesn't help if `$y` is `[long]`

```powershell
$flags = [int]7                                # explicit [int]
$proto = 0x80000000                            # [long] (Pitfall 3)
$combined = [int]$flags -bor $proto            # [long] anyway, because $proto promotes
```

The cast `[int]$flags` doesn't constrain the result of `-bor`. PowerShell type-promotes both operands to the larger type.

**Defense:** Cast the LARGER value at declaration time, not at the operation site:

```powershell
$proto = [int]0x80000000                       # [int] at parse time
$combined = $flags -bor $proto                 # both [int] → result [int]
```

## Pitfall 11 — `if () { @() } else { ... }` can collapse the array

Expression-form `if` returns the value of the matched branch. PowerShell's expression evaluation can sometimes unwrap single-element arrays during assignment:

```powershell
$aces = if ($null -eq $obj.DaclAces) { @() } else { @($obj.DaclAces) }
# When $obj.DaclAces has one element, $aces ends up as the bare element,
# not a 1-element array. This is the Bug 1 mechanism.
```

**Defense:** Apply `[array]` to the variable being assigned, not inside the branches:

```powershell
[array]$aces = if ($null -eq $obj.DaclAces) { @() } else { @($obj.DaclAces) }
```

The `[array]` type constraint forces re-wrapping on assignment.

## Pitfall 12 — Strict-mode behavior diverges between PS 5.1 and PS 7

Windows PowerShell 5.1 (default on Windows Server) and PowerShell Core 7+ differ on:

- `[int]` cast overflow handling (5.1 throws, 7 wraps in some contexts).
- Strict-mode behavior on un-set variables.
- `ConvertTo-Json` defaults.
- Enum-arithmetic operator promotion.

The worker runs Windows PowerShell 5.1. Don't rely on PS 7 behaviors.

**Defense:** Test against the same PS version the worker runs. The SSH'd `powershell` command on the worker (`172.30.205.232`) gives you 5.1.

## Pitfall 13 — `[bool]$ace.IsInherited` vs `($ace.AceFlags -band 0x10) -ne 0`

These should be equivalent but aren't always. `.IsInherited` is a .NET property exposed by `CommonAce`, computed from the `AceFlags` bit at construction time. If the AceFlags is modified later, `.IsInherited` may not update.

For the source-of-truth on whether an ACE is inherited, prefer the bit:

```powershell
$isInherited = ($ace.AceFlags -band [System.Security.AccessControl.AceFlags]::Inherited) -ne 0
```

In practice the worker uses both interchangeably and they agree. Worth knowing if you ever see divergence.

## Pitfall 14 — `[PSCustomObject]@{}` property order is preserved but not guaranteed

PowerShell preserves insertion order for `[PSCustomObject]@{}` literals in PS 5.1+. Useful when JSON output order matters for log readability. But don't rely on hash-table-without-PSCustomObject (`@{}` alone is `HashTable` with arbitrary order).

```powershell
# Preserved order:
[PSCustomObject]@{ A = 1; B = 2; C = 3 } | ConvertTo-Json -Compress
# Output: {"A":1,"B":2,"C":3}

# Non-deterministic order:
@{ A = 1; B = 2; C = 3 } | ConvertTo-Json -Compress
# Output: could be any order
```

The NDM JSON payloads always use `[PSCustomObject]@{}` for this reason.

---

## Summary checklist before submitting PowerShell changes

- [ ] Used `$sd.ControlFlags`, not `$sd.Control`.
- [ ] `isCallback` arg to `CommonAce` is `$false` (never `$ace.IsInherited`).
- [ ] `PROTECTED_DACL` / `UNPROTECTED_DACL` constants declared with `[int]` cast.
- [ ] `[array]$aces = ...` for any DACL array consumed from a property.
- [ ] `ConvertTo-Json` always with `-Depth 5` for SD-shaped data.
- [ ] `ConvertTo-Json` with manual splice for any nested `List[string]`.
- [ ] All `AllocHGlobal` calls have a paired `FreeHGlobal` in `finally`.
- [ ] `CloseHandle` for any `CreateFileW` handle, in `finally`.
- [ ] `SetSecurityInfo` / `SetNamedSecurityInfo` rc checked AND non-zero rc throws.
- [ ] Tested against the same PowerShell version the worker runs (5.1).
- [ ] If new function: `Set-StrictMode -Version 2.0` at the top.
