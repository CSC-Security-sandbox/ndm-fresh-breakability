# ACL Comparator Test Matrix

Targets `securityDescriptorEquals(expected, actual)` plus the `prepareExpectedDestinationSecurityDescriptor` pipeline in `services/worker/src/activities/core/migrate/command-execution/win-opeartions/win-operation.service.ts`.

All ACEs assume `AceType` 0=Allow, 1=Deny unless noted.

**Notation:** `ACE{Sid, Mask, Type, Flags}` — Flags is the raw byte:
- `OI = 0x01` (Object Inherit)
- `CI = 0x02` (Container Inherit)
- `NP = 0x04` (No Propagate)
- `IO = 0x08` (Inherit Only)
- `INH = 0x10` (Inherited)

---

## A. Owner / Group

| #  | Input (expected → actual)                                  | Expected result                                          |
| -- | ---------------------------------------------------------- | -------------------------------------------------------- |
| A1 | Owner `S-1-5-21-A-500` → `S-1-5-21-A-500`                  | `equal: true`                                            |
| A2 | Owner `S-1-5-21-A-500` → `S-1-5-21-B-500`                  | `equal: false, field: owner`                             |
| A3 | Owner `BUILTIN\Administrators` (`S-1-5-32-544`) on both    | `equal: true`                                            |
| A4 | Owner casing differs: `s-1-5-21-...` vs `S-1-5-21-...`     | **decide & document** — today fails (string compare). Add normalization test. |
| A5 | Owner empty string on both                                 | `equal: true`                                            |
| A6 | Owner empty on expected, populated on actual               | `equal: false, field: owner`                             |
| A7 | Group mismatch, owner equal                                | `equal: false, field: group`                             |
| A8 | Both owner and group differ                                | `equal: false, field: owner` (short-circuit — assert it's owner, not group) |

## B. DaclProtected flag

| #  | Input                                  | Expected                                  |
| -- | -------------------------------------- | ----------------------------------------- |
| B1 | both `true`                            | continue (no fail on this field)          |
| B2 | both `false`                           | continue                                  |
| B3 | expected `true`, actual `false`        | `equal: false, field: daclProtected`      |
| B4 | expected `false`, actual `true`        | `equal: false, field: daclProtected`      |
| B5 | expected `undefined`, actual `false`   | `equal: true` (`!!` coercion)             |
| B6 | expected `null`, actual `false`        | `equal: true`                             |

## C. DaclAutoInherit flag

| #  | Input                                  | Expected                                                                                  |
| -- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| C1 | both `true`                            | continue                                                                                  |
| C2 | mismatch                               | `equal: false, field: daclAutoInherit`                                                    |
| C3 | expected `undefined`, actual `true`    | `equal: false, field: daclAutoInherit` (catches Windows-side flip — "watch-list" case)    |

## D. Attributes (`parseStampableAttributes`)

| #   | Input                                            | Expected                                            |
| --- | ------------------------------------------------ | --------------------------------------------------- |
| D1  | `"Archive"` vs `"Archive"`                       | continue                                            |
| D2  | `"Archive,Hidden"` vs `"Hidden,Archive"`         | continue (mask, order-independent)                  |
| D3  | `"Archive"` vs `"Archive,ReadOnly"`              | `equal: false, field: attributes`                   |
| D4  | `"Archive,Compressed"` vs `"Archive"`            | continue (Compressed excluded from stampable mask)  |
| D5  | `"Archive,ReparsePoint"` vs `"Archive"`          | continue                                            |
| D6  | `"Archive,Encrypted,Sparse"` vs `"Archive"`      | continue                                            |
| D7  | `""` vs `""`                                     | continue                                            |
| D8  | `undefined` vs `""`                              | continue                                            |
| D9  | `"Hidden"` vs `""`                               | `equal: false, field: attributes`                   |
| D10 | Unknown token: `"Archive,Bogus"` vs `"Archive"`  | continue (unknown ignored)                          |
| D11 | Whitespace: `"  Archive , Hidden  "` vs `"Archive,Hidden"` | continue (trim works)                     |

## E. ACE count

| #  | Input                                                       | Expected                                                                |
| -- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| E1 | Both DACL empty (`[]`)                                      | `equal: true`                                                           |
| E2 | Both `undefined` DACL                                       | `equal: true`                                                           |
| E3 | Expected `[A]`, actual `[]`                                 | `equal: false, field: aceMissingOnDestination, expectedValue: A`        |
| E4 | Expected `[]`, actual `[A]`                                 | `equal: false, field: aceExtraOnDestination, actualValue: A`            |
| E5 | Expected `[A,B]`, actual `[A]`                              | `equal: false, field: aceMissingOnDestination, expectedValue: B`        |
| E6 | Expected `[A]`, actual `[A,B]`                              | `equal: false, field: aceExtraOnDestination, actualValue: B`            |
| E7 | Expected `[A,B]`, actual `[A,C]` (same count, different)    | `equal: false, field: aceFieldDiff` at index 1                          |
| E8 | Expected has 100 ACEs, actual has 99 (first 99 identical)   | `equal: false, field: aceMissingOnDestination`                          |

## F. ACE field equality (positional)

`A = {S-1-5-21-A-1001, 0x1F01FF, 0, 0x13}` (`OI|CI|INH`)

| #  | Input                                                          | Expected                                                            |
| -- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| F1 | `[A]` vs `[A]`                                                 | `equal: true`                                                       |
| F2 | Sid differs                                                    | `equal: false, field: aceFieldDiff` (Sid)                           |
| F3 | AccessMask differs (`0x1F01FF` vs `0x1F01FE`)                  | `equal: false, field: aceFieldDiff`                                 |
| F4 | AceType differs (Allow vs Deny, same Sid/Mask)                 | `equal: false, field: aceFieldDiff`                                 |
| F5 | AceFlags differs (`0x13` vs `0x03` — INH bit cleared)          | `equal: false, field: aceFieldDiff` ← **critical: explicit-vs-inherited drift** |
| F6 | AceFlags differs only by `OI` (`0x12` vs `0x13`)               | `equal: false, field: aceFieldDiff` ← propagation drift             |
| F7 | Same SID twice with different masks `[A1, A2]` vs `[A1, A2]`   | `equal: true`                                                       |
| F8 | Same SID twice swapped `[A1, A2]` vs `[A2, A1]`                | `equal: false, field: aceFieldDiff` at index 0 (positional)         |

## G. Canonical-order drift (the central scenario)

| #  | Input                                                                                              | Expected                                                          |
| -- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| G1 | `[ExplicitDeny, ExplicitAllow, InheritedDeny, InheritedAllow]` on both                             | `equal: true`                                                     |
| G2 | Expected canonical, actual has `ExplicitAllow` before `ExplicitDeny`                               | `equal: false, field: aceFieldDiff` at index 0                    |
| G3 | Expected `[ExplicitDeny, InheritedDeny]`, actual `[InheritedDeny, ExplicitDeny]`                   | `equal: false, field: aceFieldDiff`                               |
| G4 | Same multiset, different positions (non-canonical actual)                                          | fails — **assert this is treated as drift, not as match**         |

## H. Subtle ACE-flag bits

| #  | Input                                                  | Expected                                                                          |
| -- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| H1 | `INHERITED_ACE` (`0x10`) bit set on expected, cleared on actual | `aceFieldDiff`                                                            |
| H2 | `INHERIT_ONLY_ACE` (`0x08`) differs                    | `aceFieldDiff`                                                                    |
| H3 | `NO_PROPAGATE_INHERIT_ACE` (`0x04`) differs            | `aceFieldDiff`                                                                    |
| H4 | `SUCCESSFUL_ACCESS_ACE_FLAG` (`0x40`, audit)           | should never appear since AceType filter; test that one slipping through is filtered out by `getComparableAces` |
| H5 | `OBJECT_INHERIT_ACE` (`0x01`) differs                  | `aceFieldDiff`                                                                    |
| H6 | `CONTAINER_INHERIT_ACE` (`0x02`) differs               | `aceFieldDiff`                                                                    |

## I. ACE type filtering

| #  | Input                                                                                       | Expected                                                  |
| -- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| I1 | Source has `[Allow, Audit(type=2), Deny]`, dest has `[Allow, Deny]`                         | `equal: true` (audit filtered both sides)                 |
| I2 | Source has `[Allow, ObjectAllow(type=5), Deny]`, dest has `[Allow, Deny]`                   | `equal: true`                                             |
| I3 | Source has `[Allow]`, dest has `[Allow, Audit]`                                             | `equal: true` (audit filtered from actual)                |
| I4 | All ACEs are non-{0,1} on both                                                              | comparable arrays empty → `equal: true`                   |
| I5 | **Source has type-5 ACE that stamp would have rejected**, dest doesn't                      | `equal: true` — **flag as known gap**: gate misses unstampable ACEs |

## J. Well-known SIDs

| #  | Input                                                                                       | Expected                                                  |
| -- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| J1 | `S-1-1-0` (Everyone) on both                                                                | `equal: true`                                             |
| J2 | `S-1-3-0` (Creator Owner) on both, same mask                                                | `equal: true`                                             |
| J3 | `S-1-3-0` mask differs                                                                      | `equal: false, field: aceFieldDiff` ← note: gate is strict, but `validateAclOperation` ignores mask here; assert both behaviors |
| J4 | `S-1-5-18` (LocalSystem) on both                                                            | `equal: true`                                             |
| J5 | `S-1-5-32-544` (BUILTIN\Administrators) on both                                             | `equal: true`                                             |

## K. SID mapping path (`prepareExpectedDestinationSecurityDescriptor`)

Job has `isIdentityMappingAvailable: true`, Redis map: `srcA → dstA`, `srcB → 'Invalid'`.

| #  | Source SD                                          | Destination SD                                | Expected                                                          |
| -- | -------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| K1 | Owner=`srcA`, ACE[srcA]                            | Owner=`dstA`, ACE[dstA]                       | `equal: true`                                                     |
| K2 | Owner=`srcA`                                       | Owner=`srcA` (unmapped)                       | `equal: false, field: owner`                                      |
| K3 | Owner=`srcB` (maps to Invalid)                     | Owner=`srcB` (reverted)                       | `equal: true` (Invalid-normalization works)                       |
| K4 | ACE[srcB]                                          | (srcB ACE dropped)                            | `equal: true`                                                     |
| K5 | ACE[srcA, srcB]                                    | ACE[dstA]                                     | `equal: true` (srcB dropped, srcA mapped)                         |
| K6 | Owner=`srcA`                                       | Owner=`srcA` (mapping not yet applied to dest)| `equal: false, field: owner` (forces stamp)                       |
| K7 | `isIdentityMappingAvailable: false`, cross-domain SIDs differ | —                                  | `equal: false, field: owner` (warn-and-stamp fallthrough)         |
| K8 | Cached `SecurityDescriptor` passed in twice — confirm `mapSIDToTarget` doesn't corrupt second call (mutation test) | — | `equal: true` on both runs                       |

## L. Inheritance-mode transform (DLM root only)

`applyInheritanceMode=true`, source has `[Explicit(SidX, 0x00), Inherited(SidY, 0x10)]`.

| #  | Mode                            | Dest                                                          | Expected                                                          |
| -- | ------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| L1 | `INHERIT_PERMS_AS_EXPLICIT`     | `[Explicit(SidX,0x00), Explicit(SidY,0x00)]`                  | `equal: true` (inherited flipped to explicit)                     |
| L2 | `INHERIT_PERMS_AS_EXPLICIT`     | `[Explicit(SidX,0x00), Inherited(SidY,0x10)]`                 | `equal: false, field: aceFieldDiff` (dest still has INH bit)      |
| L3 | `INHERIT_PERMS_AS_IS`           | `[Explicit(SidX,0x00)]` only                                  | `equal: true` (inherited dropped)                                 |
| L4 | `INHERIT_PERMS_AS_IS`           | `[Explicit(SidX,0x00), Inherited(SidY,0x10)]`                 | `equal: false, field: aceExtraOnDestination`                      |
| L5 | `applyInheritanceMode=false` (non-root) | dest has inherited as-is                              | `equal: true`                                                     |
| L6 | Mode unset (defaults to `INHERIT_PERMS_AS_EXPLICIT`) | per L1 expectation                       | `equal: true`                                                     |
| L7 | Unknown mode string             | per `INHERIT_PERMS_AS_IS` (drop inherited)                    | `equal: true` if dest matches drop                                |

## M. Files vs Folders

| #  | Scenario                                                                                          | Expected                                                                                 |
| -- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| M1 | File: ACE with `CI` only (`0x02`) — invalid on a file but legal in DACL bytes                     | byte equality holds → `equal: true` if both match                                        |
| M2 | Folder: same DACL, expected has `OI|CI`, actual has `OI|CI`                                       | `equal: true`                                                                            |
| M3 | Folder: expected has `OI|CI|IO` (template-only), actual has `OI|CI` (concrete)                    | `equal: false, field: aceFieldDiff` (`IO` differs)                                       |
| M4 | Folder root of share (no parent to inherit from)                                                  | `equal: true` (relies on PowerShell-side fix to *not* heuristic-flip DaclProtected)      |

## N. Special / pathological

| #  | Scenario                                                                                          | Expected                                                                                 |
| -- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| N1 | Null DACL: `DaclPresent=false` on both                                                            | `equal: true`                                                                            |
| N2 | Null DACL on expected, empty DACL on actual                                                       | **decide**: today probably equal (both `DaclAces` empty), but semantically null ≠ empty. Add a `DaclPresent` field to the comparator? |
| N3 | Very large DACL (1000 ACEs) all matching                                                          | `equal: true`, perf assertion < N ms                                                     |
| N4 | DACL with 100 ACEs, one differs at index 50                                                       | `equal: false, field: aceFieldDiff` at index 50                                          |
| N5 | Unresolved SID (`S-1-5-21-...-1234` with no name) on both, byte-equal                             | `equal: true`                                                                            |
| N6 | "Unknown account" string SID on expected, resolved name on actual (shouldn't happen, but)         | `equal: false, field: aceFieldDiff`                                                      |
| N7 | Duplicate ACE: `[A, A]` on both                                                                   | `equal: true`                                                                            |
| N8 | `[A, A]` expected vs `[A]` actual                                                                 | `equal: false, field: aceMissingOnDestination` (count mismatch)                          |

## O. ACE-count short-circuit vs index loop interaction

| #  | Scenario                                                | Expected                                  |
| -- | ------------------------------------------------------- | ----------------------------------------- |
| O1 | Expected length 3, actual length 3, all equal           | `equal: true`                             |
| O2 | Same length, mismatch at index 0                        | reason at index 0, not later              |
| O3 | Same length, mismatch at last index                     | reports that index's ACE                  |

## P. Negative / robustness

| #  | Scenario                                                                                          | Expected                                                                                 |
| -- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P1 | `expected = null`                                                                                 | throws or rejects — confirm caller never invokes this way                                |
| P2 | `expected.DaclAces = null`                                                                        | treated as empty (today: `getComparableAces` returns `[]`)                               |
| P3 | ACE with `AccessMask = 0`                                                                         | comparable; equality applies                                                             |
| P4 | ACE with `AccessMask = -1` / `0xFFFFFFFF` (FullControl + generic)                                 | byte equality applies                                                                    |
| P5 | Negative numbers from PowerShell signed-int marshaling (`-2147483648` for `GENERIC_ALL`)          | assert both sides use same encoding                                                      |
| P6 | Unicode in SID is impossible, but Unicode in attributes string (shouldn't happen)                 | parsed safely                                                                            |

## Q. End-to-end behavioral (the things that matter to users)

| #   | Scenario                                                                                       | Expected                                                |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Q1  | Stamp file, immediately re-scan: `hasSecurityDescriptorChanged` returns `false`                | no false-positive re-stamp                              |
| Q2  | Stamp file with Invalid-mapping SID, re-scan: `false`                                          | no perpetual re-stamp loop                              |
| Q3  | Stamp file with DLM-root inheritance transform, re-scan with `applyInheritanceMode=true`: `false` | gate honors transform                                |
| Q4  | External actor adds an ACE to destination after stamp: `true`                                  | drift detected (aceExtraOnDestination)                  |
| Q5  | External actor removes an ACE: `true`                                                          | drift detected (aceMissingOnDestination)                |
| Q6  | External actor flips destination's DaclProtected: `true`                                       | drift detected                                          |
| Q7  | External actor reorders DACL: `true`                                                           | drift detected positionally                             |
| Q8  | Source ACL changed (new ACE added on source): `true`                                           | drift detected, triggers re-stamp                       |
| Q9  | Source attribute toggled (Hidden added): `true`                                                | stampable-attr drift                                    |
| Q10 | Source toggles a non-stampable attribute (Compressed added): `false`                           | gate does NOT loop (correctly ignored)                  |

## R. Cross-validator consistency (the latent-bug suite)

Run the *same* source/dest pair through both `securityDescriptorEquals` and `validateAclOperation` and assert they agree, except in documented disagreement cases:

| #  | Scenario                                                  | gate (`equals`) | validate                       | Action                  |
| -- | --------------------------------------------------------- | --------------- | ------------------------------ | ----------------------- |
| R1 | Identical SDs                                             | equal           | empty `inValid`                | ✓ agree                 |
| R2 | Dest has *extra* ACE                                      | not equal       | empty `inValid` ← **bug**      | unify or document       |
| R3 | Dest has *larger* AccessMask (superset)                   | not equal       | empty `inValid` ← **bug**      | unify or document       |
| R4 | Dest has DACL reordered (same multiset)                   | not equal       | empty `inValid` ← **bug**      | unify or document       |
| R5 | Dest has different AceFlags (e.g. OI dropped)             | not equal       | empty `inValid` ← **bug**      | unify or document       |
| R6 | Dest missing an ACE                                       | not equal       | non-empty `inValid`            | ✓ agree                 |
| R7 | Owner mismatch                                            | not equal       | non-empty                      | ✓ agree                 |

---

## Suggested test organization

```
win-operation.service.spec.ts
├── describe('securityDescriptorEquals')
│   ├── owner/group           (A)
│   ├── flags                 (B, C)
│   ├── attributes            (D)
│   ├── ACE counts            (E)
│   ├── ACE field equality    (F)
│   ├── canonical order       (G)
│   ├── flag-bit subtleties   (H)
│   ├── type filtering        (I)
│   ├── well-known SIDs       (J)
│   ├── null/edge             (N, P)
│   └── perf                  (N3)
├── describe('prepareExpectedDestinationSecurityDescriptor')
│   ├── SID mapping           (K)
│   └── inheritance mode      (L)
├── describe('cross-validator consistency')
│   └── R1–R7
└── describe('end-to-end behaviors')
    └── Q1–Q10  (integration with stamp pipeline)
```

A few of these (Q1–Q10, R-series) are integration-leaning and need a fake/mock `getAclOperation` so you can program source/dest sequences. The rest are pure-function tests on `securityDescriptorEquals` / `applySmbInheritanceModeTransform` and should run in microseconds.
