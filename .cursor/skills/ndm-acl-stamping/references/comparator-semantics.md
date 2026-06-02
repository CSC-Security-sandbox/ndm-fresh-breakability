# Comparator Semantics — `securityDescriptorEquals` and `validateAclOperation`

Equality rules for the scan-time gate and the post-stamp validator. Read this when the user asks "why did the gate flag this?" / "why didn't validate catch this?" / "what counts as equal?"

## Two layers, two rule sets

| Layer | File | Used at | Strictness |
|---|---|---|---|
| **Gate** (`securityDescriptorEquals`) | `security-descriptor-change-detector.service.ts:158` | Scan time, by `hasSecurityDescriptorChanged`. Decides whether to issue a STAMP_META command. | **Strict** — positional ACE comparison, AccessMask equality, AceFlags equality. |
| **Validator** (`validateAclOperation`) | `win-operation.service.ts:405` | Post-stamp, after `setAclOperation` returns. Records mismatches in `command.ops[OPS_CMD.STAMP_META].params.sidMap`. | **Looser** — subset match on AccessMask, set-based ACE comparison. |

They disagree in three documented ways (the "R-series" tests in `security-descriptor-change-detector.service.spec.ts`):

1. Subset vs equal AccessMask (validator allows dest with MORE rights; gate flags it).
2. Set-vs-positional ACE order (validator doesn't care about order; gate does).
3. Extra ACEs on destination (validator doesn't check; gate flags `aceExtraOnDestination`).

This is Bug 7. The fix is to unify them (make validator delegate to comparator). Until then, audit-trail "valid" + gate-flagged drift on the next scan is a known false-positive-of-validator / true-positive-of-gate.

## Gate equality flow (`securityDescriptorEquals`)

The order matters because short-circuiting on the first mismatch gives the operator the single most informative field. Order is:

```
1. Owner equality
2. Group equality
3. DaclPresent equality
4. DaclProtected equality                     (only checked if DaclPresent matches)
5. Both-null short-circuit
   ├─ If both DaclPresent=false:
   │     ├─ Check Attributes
   │     └─ Return equal (no ACE comparison — there's no DACL)
6. (else) Attributes equality
7. ACE projection: filter AceType ∉ {0, 1} from both sides
8. Partition: CREATOR OWNER ACEs separated from rest
9. CREATOR OWNER: count-by-AceType (lenient — masks/flags drift tolerated)
10. Non-CREATOR-OWNER: strict positional comparison
    ├─ Length mismatch → aceMissingOnDestination or aceExtraOnDestination
    ├─ Per-position field equality (Sid, AccessMask, AceType, AceFlags)
    └─ First mismatch → aceFieldDiff
```

### Order is significant

Windows DACLs are evaluated by the kernel in canonical order (first-match decides access). Source and destination should be byte-faithful in order. The comparator's positional walk is the correct semantic — it surfaces order drift as drift.

The canonical convention is: Explicit Deny → Explicit Allow → Inherited Deny → Inherited Allow. ACEs out of canonical order are still valid bytes but evaluate ambiguously. NDM does not enforce canonicalization (we trust the source filer to provide canonical ACLs).

### Fields the gate explicitly skips

| Field | Reason |
|---|---|
| `DaclAutoInherit` | Kernel-driven, flickers on its own. See Bug 9. |
| ACE types ∉ {0, 1} | `getComparableAces` filters them out. Includes callback ACEs (types 9, 10 — Bug 2), object ACEs (type 5 — AD-integrated DFS), audit ACEs (type 2 — SACL). |
| `ResourceManagerControl` byte in the SD | Not stamped, not compared. |
| SACL | Not read, not stamped, not compared. |

### CREATOR OWNER lenient handling

`S-1-3-0` (CREATOR OWNER) is a placeholder principal. The kernel rewrites these ACEs in place during inheritance evaluation — substituting the owner's real SID, expanding `GENERIC_ALL` to `FILE_ALL_ACCESS`, and toggling flag bits. The on-disk byte form is not stable across reads.

Treatment: partition `S-1-3-0` ACEs from each side, compare by **(AceType count) only**. The non-CREATOR-OWNER remainder uses strict positional compare.

Code path: `partitionAcesByCreatorOwner` + the `countCreatorOwnerAcesByAceType` helper around line 200-286 of `security-descriptor-change-detector.service.ts`.

### Null-DACL short-circuit

```typescript
if (!expected.DaclPresent && !actual.DaclPresent) {
  // Attributes still need checking (they live outside the DACL)
  // ... compare Attributes ...
  return { equal: true };
}
```

Why: when both sides have `SE_DACL_PRESENT=0`, Win32 access checks skip the DACL entirely. There's no meaningful per-ACE comparison. The phantom ACE bytes the kernel keeps around (see Bug 8) are intentionally ignored.

### Attributes comparison

Uses `parseStampableAttributes` from `file-attributes.ts`. This function reduces the attributes string to a bitmask of attributes the stamp pipeline can actually write:

- Stampable: `ReadOnly, Hidden, System, Archive, Normal, Temporary, Offline, NotContentIndexed`.
- NOT stampable: `Directory, Device, SparseFile, ReparsePoint, Compressed, Encrypted, IntegrityStream, NoScrubData`.

Non-stampable bits would require separate Win32 syscalls (`FSCTL_SET_COMPRESSION`, `EncryptFile`, etc.) that the stamper doesn't invoke. Comparing them would alarm on every stamp without giving the operator anything actionable.

## Validator equality flow (`validateAclOperation`)

Symmetric to the gate but looser:

```
1. Owner equality (strict)
2. Group equality (strict)
3. DaclPresent equality (strict)
4. DaclProtected equality (strict)
5. Both-null short-circuit (same as gate, plus log dump)
6. Attributes equality (using parseStampableAttributes)
7. For each source ACE (after type-{0,1} filter):
    - CREATOR OWNER: any destination ACE with same Sid+AceType is a match (ignore mask/flags)
    - Otherwise: any destination ACE with same Sid+AceType where
                 (tgt.AccessMask & src.AccessMask) === src.AccessMask
                 AND tgt.AceFlags === src.AceFlags
                 → match
8. Record any unmatched source ACEs in `inValid`
9. Do NOT check for extra ACEs on destination
```

### The subset-match on AccessMask is the divergence

```typescript
(tgtAce.AccessMask & srcAce.AccessMask) === srcAce.AccessMask
```

This means: "destination has all the bits source has, possibly plus extras." Silent permission elevation. Bug 7.

### The set-based search is the second divergence

The validator uses `.some(...)` to find a matching destination ACE. Order doesn't matter. Two destinations with the same multiset of ACEs in different orders both pass validate.

But the kernel evaluates DACLs in order. Out-of-order ACEs can grant different effective access than in-order. Gate catches this; validator doesn't.

## How to extend equality semantics

Common requests and the right places to extend:

### "I want field X to be compared"

1. Add `'x'` to the `SecurityDescriptorMismatchField` union in `acl-operation.type.ts`.
2. Add the check to `securityDescriptorEquals` in the appropriate order position.
3. Add a symmetric check to `validateAclOperation`.
4. Add a test matrix section (or rows in existing section) to `docs/acl-comparator-test-matrix.md`.
5. Add test cases to `security-descriptor-change-detector.service.spec.ts`.

### "I want field Y to be ignored"

1. Remove from `securityDescriptorEquals` and `validateAclOperation`.
2. Add a comment explaining why (link to relevant bug or behavior, e.g., "kernel flickers this bit on its own — see Bug 9").
3. Update existing tests that pinned the old behavior.

### "I want CREATOR-OWNER-style lenient handling for a different SID"

The CREATOR OWNER logic is currently special-cased to `S-1-3-0`. To extend (e.g., add `S-1-3-1` CREATOR GROUP):
1. Generalize `partitionAcesByCreatorOwner` to take a set of "lenient SIDs".
2. Update the lenient-compare to use the set.
3. Consider whether the kernel-rewrite behavior actually applies to the new SID — only special-case SIDs the kernel rewrites.

## What the comparator log looks like

```
ACL mismatch on destination - target=<path> source=<path>
  field=daclProtected
  expectedValue=true
  actualValue=false
  expectedSd={"Owner":"S-1-5-21-...","Group":"...","DaclPresent":true,"DaclProtected":true,"DaclAutoInherit":true,"DaclAces":[...]}
  actualSd={"Owner":"S-1-5-21-...","Group":"...","DaclPresent":true,"DaclProtected":false,"DaclAutoInherit":true,"DaclAces":[...]}
```

Grep for `"ACL mismatch on destination"` to find drift events. The headline field is the short-circuit result (first mismatch); the full SDs let you diff the rest without re-fetching.

## Stable mismatch field keys

For grep / log aggregation:

| Field key | Meaning |
|---|---|
| `owner` | Owner SID differs |
| `group` | Group SID differs |
| `daclPresent` | One side has SE_DACL_PRESENT, the other doesn't |
| `daclProtected` | One side has SE_DACL_PROTECTED, the other doesn't |
| `attributes` | Stampable-attribute bitmask differs |
| `aceMissingOnDestination` | Expected has more ACEs than actual (or expected has an ACE actual doesn't) |
| `aceExtraOnDestination` | Actual has more ACEs than expected |
| `aceFieldDiff` | Same ACE count, but a per-position ACE field differs (Sid / AccessMask / AceType / AceFlags) |

These are the entire universe of mismatch reasons emitted by the comparator. Anything else is a code bug.
