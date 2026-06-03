# NDM ACL Stamping — Architecture

How the pieces fit together, where the code lives, and what calls what.

## High-level pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Source SMB share (NetApp ONTAP CIFS or Windows NTFS)                       │
│  Holds the security descriptor (SD) we want to copy.                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ SMB
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Worker process (Node.js + embedded PowerShell)                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 1. SCAN-TIME GATE                                                   │   │
│  │    SecurityDescriptorChangeDetectorService.hasSecurityDescriptorChanged │
│  │       ↓ calls                                                       │   │
│  │    WinOperationService.getAclOperation(source) ─┐                   │   │
│  │    WinOperationService.getAclOperation(dest)   ─┘── PS runspace     │   │
│  │       ↓ each runs                                                   │   │
│  │    powershell.script.ts → Get-FileSecurityFast                      │   │
│  │       ↓ P/Invoke                                                    │   │
│  │    advapi32!GetNamedSecurityInfo                                    │   │
│  │       ↓ returns                                                     │   │
│  │    JSON { Owner, Group, DaclPresent, DaclProtected,                 │   │
│  │           DaclAutoInherit, DaclAces, Attributes }                   │   │
│  │       ↓                                                             │   │
│  │    securityDescriptorEquals(expected, actual)                       │   │
│  │       returns { equal, reason: { field, expectedValue, ... } }      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 2. STAMP (when gate says "drift")                                   │   │
│  │    StampMetaService.stampObjectACL                                  │   │
│  │       ↓ calls                                                       │   │
│  │    WinOperationService.stampAclOperation                            │   │
│  │       ├─ getAclOperation(source)            (read source SD)        │   │
│  │       ├─ mapSIDToTarget (Redis identity)    (cross-domain SID map)  │   │
│  │       ├─ Invalid-SID filter                 (drop unmappable ACEs)  │   │
│  │       ├─ applySmbInheritanceMode            (DLM root only)         │   │
│  │       ├─ setAclOperation(target, mapped)    (the actual stamp)      │   │
│  │       │     ↓                                                       │   │
│  │       │  powershell.script.ts → Set-FileSecurityFast                │   │
│  │       │     ↓ P/Invoke                                              │   │
│  │       │  kernel32!CreateFileW                                       │   │
│  │       │  advapi32!SetSecurityInfo                                   │   │
│  │       └─ validateAclOperation(source, dest)  (post-stamp audit)     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ SMB
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Destination SMB share                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File map

### TypeScript layer

All under `services/worker/src/activities/core/migrate/command-execution/win-opeartions/`:

| File | Role |
|---|---|
| `win-operation.service.ts` | The main orchestrator. Hosts `getAclOperation`, `setAclOperation`, `stampAclOperation`, `mapSIDToTarget`, `applySmbInheritanceModeTransform`, `validateAclOperation`. Also hosts the ADS (Alternate Data Streams) detection via koffi. |
| `security-descriptor-change-detector.service.ts` | The scan-time gate. Hosts `hasSecurityDescriptorChanged`, `securityDescriptorEquals`, `prepareExpectedDestinationSecurityDescriptor`, the CREATOR OWNER partition logic. |
| `powershell.script.ts` | The embedded PowerShell as a string constant. Defines `Get-FileSecurityFast`, `Set-FileSecurityFast`, `Resolve-UsernamesToSid`, `Map-Sid`, `SidToName`. |
| `acl-operation.type.ts` | TypeScript types: `SecurityDescriptor`, `Ace`, `SecurityDescriptorCompareResult`, `SecurityDescriptorMismatchField`. Documents the three-state DaclAces contract. |
| `acl-operation.error.ts` | Error types: `SourceAclError`, `TargetAclError`, `WindowsAPINotAvailableError`. |
| `file-attributes.ts` | Stampable-attribute mask logic (Compressed/Encrypted/Sparse excluded because they need separate Win32 syscalls). |

### Orchestration layer

| File | Role |
|---|---|
| `services/worker/src/activities/core/migrate/command-execution/stamp-meta.service.ts` | Higher-level stamping orchestration. Wraps `stampObjectACL`, atime/mtime preservation, error stream publishing. |
| `services/worker/src/activities/core/shared/command-generation.service.ts` | Generates commands during scan. Calls `isMetaUpdated` which calls the SD change detector for SMB paths. |
| `services/worker/src/activities/utils/utils.ts` | Hosts `isMetaUpdated`, `isAtimeUpdated`, `isDirectoryLevelMigration`. Bridges scan logic to the SD detector. |

### Standalone scripts

| File | Role |
|---|---|
| `scripts/stamp-metadata.ps1` | Ad-hoc bulk stamping script (~1012 lines). Mirrors the worker's `Set-FileSecurityFast` logic. **Has known bugs that haven't been backported from the worker** — see `known-bugs-and-fixes.md`. |
| Worker host `C:\Users\datamigrator\Desktop\standalone.ps1` | Engineer's test harness for end-to-end stamp reproduction. We've fixed this in-session multiple times. |
| `services/worker/test/test-*.ps1` | ctime-validation test scripts. Not part of the production pipeline. |

### Tests

| File | Role |
|---|---|
| `services/worker/src/activities/core/migrate/command-execution/win-opeartions/security-descriptor-change-detector.service.spec.ts` | The main test file for the comparator. Has 2000+ lines including the A–R / S matrix from `docs/acl-comparator-test-matrix.md`. The R-series pins known divergences between gate and validator. |
| `services/worker/src/activities/core/migrate/command-execution/win-opeartions/win-operation.service.spec.ts` | Tests for the orchestration service. |
| `docs/acl-comparator-test-matrix.md` | Authoritative test matrix (A–S sections). Updated as new edge cases are added. |

## Key data structures

### `SecurityDescriptor` (TypeScript)

```typescript
type SecurityDescriptor = {
  Owner: string;              // SID string, e.g. "S-1-5-21-...-1102"
  Group: string;
  DaclAces: Ace[] | null;     // null when DaclPresent is false (NULL DACL)
  Attributes: string;          // comma-separated, e.g. "Directory, Archive"
  DaclPresent: boolean;
  DaclProtected: boolean;
  DaclAutoInherit: boolean;
  originalOwner: string;       // populated by mapSIDToTarget — pre-mapping value
  originalGroup: string;
};

type Ace = {
  Sid: string;                 // SID after mapping (when mapping is enabled)
  AccessMask: number;
  AceType: number;             // 0 = AccessAllowed, 1 = AccessDenied
                               // 9, 10 = callback ACEs (bug Bug 2)
                               // 5 = AccessAllowedObject (AD-integrated DFS)
  AceFlags: number;            // bitfield: OI=0x01, CI=0x02, NP=0x04,
                               //           IO=0x08, INH=0x10, audit-bits
  IsInherited: boolean;        // semantically redundant with AceFlags & 0x10
  originalSid: string;         // pre-mapping SID
};
```

### `SecurityDescriptorCompareResult`

```typescript
type SecurityDescriptorMismatchField =
  | 'owner'
  | 'group'
  | 'daclPresent'
  | 'daclProtected'
  | 'attributes'
  | 'aceMissingOnDestination'
  | 'aceExtraOnDestination'
  | 'aceFieldDiff';
  // Note: 'daclAutoInherit' is intentionally NOT in this union — see Bug 9.

interface SecurityDescriptorCompareResult {
  equal: boolean;
  reason?: {
    field: SecurityDescriptorMismatchField;
    expectedValue: unknown;
    actualValue: unknown;
  };
}
```

## Three-state `DaclAces` contract

This is documented in the `SecurityDescriptor` type but worth repeating because it ties multiple layers together:

| `DaclPresent` | `DaclAces` | Win32 semantic | Effective access |
|---|---|---|---|
| `false` | `null` | NULL DACL (SE_DACL_PRESENT clear) | Grant all access to everyone |
| `true` | `[]` | Empty present DACL | Deny everyone |
| `true` | `[ace, ace, ...]` | Populated DACL | Evaluated per-ACE |

The read path (`Get-FileSecurityFast`) and the write path (`Set-FileSecurityFast`) are kept in lockstep. The comparator and validator both special-case the `(false, null)` row to short-circuit ACE comparison (no DACL = nothing to compare).

## Inheritance-mode transform

Two modes, applied only at the DLM root (controlled by `command.ops[OPS_CMD.STAMP_META].params.applyInheritanceMode`):

| Mode | Effect on inherited ACEs |
|---|---|
| `INHERIT_PERMS_AS_IS` (default) | Drop ACEs with `IsInherited: true` entirely. |
| `INHERIT_PERMS_AS_EXPLICIT` | Flip `IsInherited: true → false`, clear `AceFlags & 0x10`. Result: ACEs that were inherited on source become explicit on destination. |

Rationale: the migration root has no meaningful parent on destination (different domain, different identity, no inheritance source). Keeping ACEs as "inherited" would be semantically wrong, so the root is either flattened-to-explicit or stripped of inherited entries.

The transform is NOT applied to non-root paths — they keep their inheritance relationships within the migrated subtree.

## SID-mapping flow

Active only when `jobContext.jobConfig.options.isIdentityMappingAvailable === true`.

```
Source ACE { Sid: "src-domain-SID" }
  │
  │ Redis lookup: GET <jobRunId>:identity:SID:<src-domain-SID>
  ▼
Three outcomes:
  ─ Returns a destination-domain SID  → ace.Sid = "dst-domain-SID"
  ─ Returns the literal "Invalid"     → ace.Sid = "Invalid"  ─┐
  ─ Returns null (no mapping)         → ace.Sid unchanged     │
                                                              ▼
                                              stampAclOperation filters
                                              out any ACE with Sid === 'Invalid'.
                                              See Bug 6.
```

The destination filer ultimately sees raw SIDs (translated or not). It does not do its own SID translation in this pipeline.

## Comparator vs Validator

Two equality-checking layers that have historically diverged:

**`securityDescriptorEquals` (comparator / gate)**
- Used by `hasSecurityDescriptorChanged` at scan time.
- Strict: positional ACE comparison, equality on `AccessMask` and `AceFlags`, lenient on CREATOR OWNER (count-by-AceType) and `DaclAutoInherit` (not checked).
- Decides whether to triggera STAMP_META command.

**`validateAclOperation` (validator)**
- Used at post-stamp time, after `setAclOperation`.
- Looser: subset match on `AccessMask` (`(tgt & src) === src` allows destination to have MORE rights), set-based (not positional), records mismatches in `command.ops[OPS_CMD.STAMP_META].params.sidMap`.
- This divergence is a known issue (Bug 7) — recommended fix is to make validator delegate to comparator.

## Logs

PowerShell scripts emit a `"logs": [...]` JSON array alongside their data, which the TS layer forwards to the worker's logger:

- `[Get-FileSecurityFast:SRC]` / `[Get-FileSecurityFast:DST]` — per-call diagnostics from the read path.
- `[Set-FileSecurityFast]` — per-call diagnostics from the write path, including `DaclAceCount` going into `SetSecurityInfo` (very useful for triaging Bug 1 and Bug 6).

The TS-side forwarder is in `win-operation.service.ts` (`forwardGetAclScriptLogs`).

Gate-side drift produces a single structured log line:

```
ACL mismatch on destination - target=<path> source=<path>
  field=<owner|group|daclPresent|daclProtected|attributes|aceMissingOnDestination|aceExtraOnDestination|aceFieldDiff>
  expectedValue=<json>
  actualValue=<json>
  expectedSd=<full JSON of expected SD>
  actualSd=<full JSON of actual SD>
```

Grep for `"ACL mismatch on destination"` to find these.

## Test matrix anchors

The comparator's expected behavior is pinned by `docs/acl-comparator-test-matrix.md` (sections A–S) and the matching tests in `security-descriptor-change-detector.service.spec.ts`. When extending the comparator, add a row to the matrix doc AND the corresponding test case, then run:

```bash
cd services/worker && npx jest --testPathPattern "win-opeartions" --no-coverage
```

Should be ~300 tests passing.
