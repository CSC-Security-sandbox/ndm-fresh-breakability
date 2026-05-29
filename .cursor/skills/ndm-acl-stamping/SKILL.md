---
name: ndm-acl-stamping
description: Deep working knowledge of NDM's SMB / NTFS ACL stamping pipeline — the worker's PowerShell layer (Get-FileSecurityFast / Set-FileSecurityFast), the TypeScript orchestration (WinOperationService, SecurityDescriptorChangeDetectorService), the comparator semantics (DaclPresent, DaclProtected, DaclAutoInherit, ACE ordering, CREATOR OWNER handling, null DACL), the SID-mapping flow, and a catalog of bugs we've encountered (`.Control` vs `.ControlFlags`, `isCallback` mis-pass turning standard ACEs into invisible callback ACEs, `0x80000000` overflow eating the PROTECTED bit, ONTAP CIFS edge cases, PowerShell single-element-array unwrap). Use this skill any time the user asks about: ACL stamping, ACL comparison, security descriptor, DACL, SACL, SID mapping, NDM ACL bugs, SMB permission migration, PowerShell ACL scripts, Get-FileSecurityFast, Set-FileSecurityFast, SecurityDescriptorChangeDetectorService, WinOperationService stamping behavior, or any debugging session involving NTFS ACLs being lost / corrupted / not migrated correctly on NDM. Strongly bias toward invoking this skill even when the user doesn't explicitly mention "stamping" — phrases like "ACE missing on destination", "DaclProtected preserved but ACE lost", "destination shows no permissions", "icacls says all users have full control", "permissions not inheriting" all point here.
---

# NDM ACL Stamping — Internal Reference

This skill captures the working knowledge of NDM's SMB ACL stamping pipeline as of the most recent debugging sessions. The goal is to make follow-up questions about ACLs faster and more accurate by carrying forward the architecture, the bugs we've already paid for, and the diagnostic moves that worked.

## When to use this skill

Trigger whenever the user is asking about anything in the ACL pipeline — read, stamp, compare, validate, debug. Common surface symptoms that all live in this domain:

- "Destination has fewer ACEs than source" / "Destination shows no permissions"
- "DaclProtected preserved but ACE missing"
- "icacls says all users have full control" (this is what null DACL looks like)
- "Permissions not propagating to subfolders" / "Children not inheriting from root"
- "Source has 1 ACE, destination has 0" (specifically the PowerShell single-element-array bug)
- "DaclProtected=true on source, false on destination" (specifically the `0x80000000` issue)
- "Comparator says drift on every scan" / "Stamp loops every incremental"
- Any question about `Get-FileSecurityFast` / `Set-FileSecurityFast` / `SetNamedSecurityInfo` / `SetSecurityInfo`
- Any question about `WinOperationService`, `SecurityDescriptorChangeDetectorService`, `validateAclOperation`, `securityDescriptorEquals`

If you're not sure whether the skill applies, prefer to apply it — the cost of unnecessary context is small compared to the cost of re-deriving everything from scratch.

## Big-picture mental model

NDM stamps Windows security descriptors from a source SMB share onto a destination share. The pipeline has four layers:

```
Source filer  →  PowerShell (Get-FileSecurityFast)  →  TypeScript orchestration  →  PowerShell (Set-FileSecurityFast)  →  Destination filer
                  ─ GetNamedSecurityInfo (P/Invoke)    ─ mapSIDToTarget (Redis)     ─ CreateFileW + SetSecurityInfo
                  ─ Parse SD bytes via .NET            ─ Invalid-SID filter          ─ Marshal SD bytes
                  ─ Emit JSON                          ─ Inheritance-mode transform  ─ Win32 SetSecurityInfo
                                                       ─ stampAclOperation
```

Three classes of bugs have shown up across this pipeline:

1. **PowerShell language bugs** — `.Control` returns `$null` silently, `0x80000000` promotes to `[long]` and overflows, single-element arrays unwrap on property access. These manifest as "ACE missing on destination" or "DaclProtected lost" with no error message anywhere.
2. **API-misuse bugs** — passing `IsInherited` as `isCallback` to `CommonAce` constructor turns Allow/Deny ACEs into invisible callback ACEs (type 9/10). Off-by-one with `SetNamedSecurityInfo` vs `SetSecurityInfo` interpretations.
3. **Pipeline-stage bugs** — SID mapping returning `'Invalid'` drops ACEs silently, the gate's strict-equality comparator races against kernel-side `SE_DACL_AUTO_INHERITED` flicker, CREATOR OWNER ACEs round-trip with mutated masks/flags.

Each of these has been hunted down and (mostly) fixed; the remaining work is in `references/known-bugs-and-fixes.md`.

## Map of reference files

Read the right file for the question you're answering. SKILL.md (this file) is the index; the depth lives in `references/`.

| File | When to read |
|---|---|
| `references/architecture.md` | When the user asks how the pipeline is wired, what calls what, where the code lives. The data-flow + component map. |
| `references/powershell-layer.md` | When the user is debugging `Get-FileSecurityFast` / `Set-FileSecurityFast`, P/Invoke calls, the read or write side. Includes the byte-level marshalling details. |
| `references/comparator-semantics.md` | When the user is asking about `securityDescriptorEquals`, `validateAclOperation`, or why the gate flagged drift / didn't flag drift. The "what counts as equal" rules. |
| `references/known-bugs-and-fixes.md` | When the symptom matches something we've already seen. A catalog of every bug with cause / signature / fix / status. **This is the highest-value file** — most ACL questions are recurrences of these. Read it first when triaging. |
| `references/diagnostic-playbook.md` | When the user has a fresh symptom and needs to localize the cause. Step-by-step triage tree with the SSH/PowerShell commands that work. |
| `references/powershell-pitfalls.md` | When the user is writing or modifying PowerShell that touches ACLs. The recurring PS gotchas in one place. |

## Mandatory before you answer

These two pieces of context shape almost every NDM ACL conversation, so check them every time:

### 1. The codebase has both production code AND a Desktop standalone script

| Location | Purpose |
|---|---|
| `services/worker/src/activities/core/migrate/command-execution/win-opeartions/powershell.script.ts` | Production read/write (`Get-FileSecurityFast`, `Set-FileSecurityFast`) embedded in the worker. This is what runs in the NDM migration. |
| `services/worker/src/activities/core/migrate/command-execution/win-opeartions/win-operation.service.ts` | TypeScript orchestration: stamp + SID mapping + validation. |
| `services/worker/src/activities/core/migrate/command-execution/win-opeartions/security-descriptor-change-detector.service.ts` | The scan-time gate (`hasSecurityDescriptorChanged`, `securityDescriptorEquals`). |
| `scripts/stamp-metadata.ps1` | Standalone ad-hoc bulk-stamp script. **Currently has the single-element-array bug** at line 610 (as of 2026-05-28). |
| Worker host `C:\Users\datamigrator\Desktop\standalone.ps1` | A test harness the engineer uses to reproduce stamps end-to-end. We fixed the `[array]` cast bug there on 2026-05-28. |

When the user says "the stamp" / "the script", clarify which. They overlap heavily but diverge in fixes.

### 2. The filer is NetApp ONTAP CIFS, not Windows NTFS

Source and destination are typically ONTAP SVMs (e.g., `\\newroot-cedd.rootdomain.local\...`). ONTAP CIFS broadly behaves like NTFS but has known quirks:

- Some volumes are `mixed` or `unix` security style, where SE_DACL_PROTECTED may not be honored, ACEs with unresolvable SIDs may be silently rejected, and SID-to-UNIX-UID translation can drop ACEs.
- The codebase contains a comment claiming `SetNamedSecurityInfo + DACL + PROTECTED_DACL` silently zeroes the DACL on ONTAP. **We have empirically disproved this on the current cluster (2026-05-28)** — both `SetNamedSecurityInfo` and the handle-based `SetSecurityInfo` work correctly with that flag combination. The comment may be stale or refer to a different ONTAP build. Don't take it at face value.

## Quick-reference invariants

These are the contracts the codebase has settled on. Violations of any of these are bugs:

- **DaclPresent is the source of truth for "is there a DACL at all?"** It's read from `$sd.ControlFlags -band DiscretionaryAclPresent`, **NOT** from whether `$sd.DiscretionaryAcl` has ACEs. ONTAP can return SDs where the byte form has DACL bytes but SE_DACL_PRESENT is clear.
- **DaclAces is in lockstep with DaclPresent.** `DaclPresent === false` ⇒ `DaclAces === null`. `DaclPresent === true` ⇒ `DaclAces === []` (empty present DACL = deny-all) or a populated array.
- **`isCallback` in CommonAce is ALWAYS `$false`.** The "inherited" semantic rides in `AceFlags` bit `0x10`, not this argument. The mistake of passing `$ace.IsInherited` here turns the ACE into type 9/10 which is functionally invisible.
- **`PROTECTED_DACL_SECURITY_INFORMATION = [int]0x80000000`** must be declared with the `[int]` cast at the source. Without it PowerShell promotes the literal to `[long]` and the `[int]` cast on the OR result either throws or silently truncates the high bit on some PS hosts.
- **`$sd.Control` does not exist**, use `$sd.ControlFlags`. The wrong name returns `$null` silently and every bit-check becomes false. (Killed all stamping until we caught this.)
- **`[array]$aces = ...`** when assigning a property that holds an array. Without the type constraint, PowerShell unwraps single-element arrays on property access, the for-loop body never runs, and you stamp an empty DACL.
- **`DaclAutoInherit` is intentionally NOT compared in the gate or validator.** Windows' inheritance engine flips this bit on its own; strict-comparing it causes restamp loops.
- **CREATOR OWNER (`S-1-3-0`) is compared leniently** — count-by-AceType only, not strict mask/flag equality. The kernel rewrites these ACEs on every inheritance evaluation; strict comparison causes restamp loops.

## How to engage when the user asks a new ACL question

Default approach:

1. **Read `references/known-bugs-and-fixes.md` first.** Most "new" ACL bugs are recurrences. Match the user's symptom against the catalog before opening a fresh investigation.
2. If the symptom matches a known bug, present the cause + fix + a one-line verification command. Don't re-derive — point at the catalog entry.
3. If the symptom doesn't match, open `references/diagnostic-playbook.md` and walk the user through the triage tree.
4. If the user is asking conceptual / how-does-X-work questions, route to the appropriate reference file (`comparator-semantics.md` for "why did the gate flag this", `powershell-layer.md` for "what does Set-FileSecurityFast actually do", etc.).
5. If the user is writing PowerShell, pre-load `references/powershell-pitfalls.md` and check their code against those patterns.

When uncertain, be candid: "We've seen something like this before — let me check the catalog… [reads]. The signature matches X / doesn't match X. Here's what I'd do next…"

## How to add to this skill

When a new ACL bug or insight surfaces in a future session:

1. **Add an entry to `references/known-bugs-and-fixes.md`** with the same shape as existing entries (Symptom / Cause / Signature / Fix / Status / Date).
2. If the bug reveals a recurring pattern (e.g., a new PowerShell gotcha), also add to `references/powershell-pitfalls.md`.
3. If the architecture changed (new service, new function), update `references/architecture.md`.
4. Update this `SKILL.md`'s "Quick-reference invariants" if a new contract emerges.

Keep the catalog ordered by date (newest first) so the most recent context is at the top.
