## ADDED Requirements

### Requirement: Atime-only drift emits stamp work on non-discovery migrations

When a migrate scan evaluates an existing source object and an existing destination object, the system SHALL compare access time using numeric **`atimeMs`** from the source `Stats` and destination `Stats` (from the same `lstat` family already used for that object type).

The system SHALL emit a command that leads to destination access time being updated to match the source **only if all** of the following hold:

1. **Neither** a content update **nor** a metadata update is required for that object under the same rules used today for migrate scan (`isContentUpdate` false and `isMetaUpdated` false with configured metadata tolerance).
2. The **destination** object exists (paired `Stats` available for comparison).
3. **`source.atimeMs` !== `destination.atimeMs`** (strict inequality on the numeric values).
4. The active job is **not** a discovery job (this logic MUST NOT run for discovery).

This behavior SHALL **not** depend on the **`preserveAccessTime`** job option: the option MUST neither enable nor disable this requirement.

#### Scenario: Non-discovery migrate with aligned content and metadata but mismatched atime

- **WHEN** the job type is a migration flow other than discovery
- **AND** `isContentUpdate` is false for the source/destination pair
- **AND** `isMetaUpdated` is false for the pair
- **AND** `source.atimeMs` differs from `destination.atimeMs`
- **THEN** the scan SHALL emit a command that includes pending destination metadata stamping such that execution updates the destination to the source access time from command metadata

#### Scenario: Discovery job must not trigger atime-only commands

- **WHEN** the job is a discovery job
- **AND** content and metadata checks would otherwise allow the atime-only branch
- **AND** `source.atimeMs` differs from `destination.atimeMs`
- **THEN** the scan MUST NOT emit a command solely for atime reconciliation

#### Scenario: preserveAccessTime does not gate atime reconcile

- **WHEN** `preserveAccessTime` is false on the job configuration
- **AND** all conditions for atime-only drift (non-discovery, no content update, no metadata update, `atimeMs` mismatch) are satisfied
- **THEN** the system SHALL still emit the atime reconciliation command as required above

### Requirement: Files and directories

The atime comparison and conditional stamp emission SHALL apply to **files** and **directories** that pass the same object-type handling as existing migrate scan commands for those kinds.

#### Scenario: Directory with atime-only drift

- **WHEN** the object is a directory
- **AND** neither content nor metadata updates are required
- **AND** `atimeMs` differs between source and destination
- **AND** the job is not discovery
- **THEN** the scan SHALL emit a stamp-only style command appropriate for directories

### Requirement: Dedicated atime-only stamp operation

The system SHALL define a dedicated operation `OPS_CMD.STAMP_ATIME` that, when present on a command and not already `COMPLETED`, applies the source access time and modified time from `command.metadata` to the **destination object only**, without touching destination permissions, ownership, or ACLs.

The atime-only branch in migrate scan SHALL emit `OPS_CMD.STAMP_ATIME` (not `OPS_CMD.STAMP_META`) for atime-only drift, with the paired `COPY_FILE` / `COPY_DIR` / `COPY_SYMLINK` op set to `OPS_STATUS.COMPLETED`.

#### Scenario: Atime-only drift emits STAMP_ATIME, not STAMP_META

- **WHEN** the atime-only branch fires for a non-discovery job
- **AND** `source.atimeMs` differs from `destination.atimeMs`
- **THEN** the emitted command SHALL have `OPS_CMD.STAMP_ATIME` with status `READY`
- **AND** the command MUST NOT contain `OPS_CMD.STAMP_META`
- **AND** the paired `COPY_FILE` / `COPY_DIR` / `COPY_SYMLINK` op SHALL have status `COMPLETED`

#### Scenario: STAMP_ATIME execution does not modify permissions or ownership

- **WHEN** a worker executes a command containing only `COPY_*` (`COMPLETED`) and `OPS_CMD.STAMP_ATIME` (`READY`)
- **THEN** the worker MUST NOT invoke `chmod`, `chown`, `lchown`, or ACL stamping on the destination
- **AND** the worker MUST invoke an access-time-aligning syscall on the destination object only

#### Scenario: STAMP_ATIME completes when destination already aligned

- **WHEN** `OPS_CMD.STAMP_ATIME` execution observes that the destination object's `atimeMs` already equals `command.metadata.atime`
- **THEN** the worker MUST skip the access-time syscall on the destination
- **AND** the worker SHALL mark `command.ops[OPS_CMD.STAMP_ATIME].status` as `COMPLETED`

### Requirement: Symlink coverage

The atime-only branch and `OPS_CMD.STAMP_ATIME` execution SHALL apply to symbolic links by acting on the **link node**, not the link target.

#### Scenario: Symlink with atime-only drift

- **WHEN** the source object is a symbolic link
- **AND** neither content nor metadata updates are required for the link
- **AND** `atimeMs` differs between source and destination link nodes
- **AND** the job is not discovery
- **THEN** the scan SHALL emit a command with paired `OPS_CMD.COPY_SYMLINK` (`COMPLETED`) and `OPS_CMD.STAMP_ATIME` (`READY`)
- **AND** worker execution SHALL use `lutimes` (not `utimes`) on the destination link node

### Requirement: Source preservation runs in parallel when option enabled

When `OPS_CMD.STAMP_ATIME` executes and `jobConfig.options.preserveAccessTime` is `true`, the worker SHALL re-apply source access and modified times to the source object in parallel with the destination stamp, using the same `lutimes`/`utimes` selection rule as the existing `StampMetaService.preserveAccessAndModifiedTime`.

When `jobConfig.options.preserveAccessTime` is `false`, the worker MUST NOT modify source timestamps as part of `OPS_CMD.STAMP_ATIME` execution.

#### Scenario: preserveAccessTime=true preserves source while stamping destination

- **WHEN** a command with `OPS_CMD.STAMP_ATIME` (`READY`) is executed
- **AND** `jobConfig.options.preserveAccessTime` is `true`
- **THEN** the worker SHALL apply source `atime`/`mtime` to the destination object
- **AND** in parallel, the worker SHALL re-apply source `atime`/`mtime` to the source object

#### Scenario: preserveAccessTime=false leaves source untouched

- **WHEN** a command with `OPS_CMD.STAMP_ATIME` (`READY`) is executed
- **AND** `jobConfig.options.preserveAccessTime` is `false`
- **THEN** the worker SHALL apply source `atime`/`mtime` to the destination object
- **AND** the worker MUST NOT call `utimes`/`lutimes` on the source object

### Requirement: Protocol coverage — NFS and SMB

`OPS_CMD.STAMP_ATIME` scan emission and execution SHALL behave identically for **NFS** workers (Linux) and **SMB** workers (Windows over UNC paths), subject only to the underlying filesystem's timestamp granularity. The implementation MUST NOT branch on protocol or platform for the scan-emission decision.

#### Scenario: Same scan branch fires for NFS and SMB

- **WHEN** the scan evaluates the same source/destination pair on an NFS-mounted volume and on an SMB share
- **AND** all gating conditions for atime-only drift are met on both
- **THEN** the scan SHALL emit equivalent commands containing `OPS_CMD.STAMP_ATIME` for both protocols

#### Scenario: SMB execution uses utimes/lutimes via UNC paths

- **WHEN** the worker executes a command containing `OPS_CMD.STAMP_ATIME` against an SMB destination
- **AND** the metadata indicates the object is a symlink
- **THEN** the worker SHALL call `fs.promises.lutimes` against the destination UNC path
- **AND** for non-symlink destinations the worker SHALL call `fs.promises.utimes`

### Requirement: Job-run mutual exclusion with metadata stamping

For any single migrate-scan evaluation of a source/destination pair, the emitted command SHALL contain **at most one** of `OPS_CMD.STAMP_META` or `OPS_CMD.STAMP_ATIME` (never both). When content or metadata stamping is required, `OPS_CMD.STAMP_META` SHALL be emitted and `OPS_CMD.STAMP_ATIME` MUST NOT be emitted, even if atime also differs (the wider `STAMP_META` op already aligns `atime`).

#### Scenario: Content update suppresses STAMP_ATIME

- **WHEN** `isContentUpdate` is `true` for the pair
- **AND** `atimeMs` also differs
- **THEN** the emitted command SHALL contain `OPS_CMD.STAMP_META` with status `READY`
- **AND** the emitted command MUST NOT contain `OPS_CMD.STAMP_ATIME`

#### Scenario: Metadata update suppresses STAMP_ATIME

- **WHEN** `isContentUpdate` is `false` and `isMetaUpdated` is `true` for the pair
- **AND** `atimeMs` also differs
- **THEN** the emitted command SHALL contain `OPS_CMD.STAMP_META` with status `READY`
- **AND** the emitted command MUST NOT contain `OPS_CMD.STAMP_ATIME`

### Requirement: Test coverage

The change SHALL be accompanied by three test tiers:

1. **Unit tests** (Jest, mocked `fs`) covering input validation, positive and negative branch selection, and error propagation for both scan and execution paths.
2. **Component tests** (Jest with `os.tmpdir()`-backed real files; no external services) validating real `utimes`/`lutimes` behavior across files, directories, and symlinks, including idempotency.
3. **End-to-end tests** (Ginkgo v2 + Gomega in `ndm-api-tests`) running against real SMB and NFS shares via `--protocol_type`, exercising discovery (negative), migration, incremental migration, and cutover for files, directories, and symlinks with both atime-mismatch and atime-match cases, and with `preserveAccessTime` both enabled and disabled.

No test SHALL modify production source files.

#### Scenario: Unit test asserts STAMP_ATIME emission for non-discovery migrate

- **WHEN** the unit test invokes `CommandGenerationService.buildCommand` with `jobType='MIGRATE'`, equal content, equal metadata, and differing `atimeMs`
- **THEN** the returned `Cmd` SHALL contain `OPS_CMD.STAMP_ATIME` with status `READY`
- **AND** the returned `Cmd` MUST NOT contain `OPS_CMD.STAMP_META`

#### Scenario: Component test verifies real atime is aligned on destination

- **WHEN** the component test sets a known source `atimeMs` via `fs.promises.utimes` in `os.tmpdir()` and invokes `StampAtimeService.stampAtime`
- **THEN** `fs.promises.lstat(destination).atimeMs` SHALL equal the source `atimeMs`

#### Scenario: E2E discovery does not change destination atime

- **WHEN** the E2E spec runs a discovery job on an environment where source and destination atimes differ
- **AND** the spec waits for the discovery job to complete
- **THEN** destination atimes for file, directory, and symlink SHALL be unchanged from their pre-discovery values

#### Scenario: E2E cutover aligns destination atime to source

- **WHEN** the E2E spec runs a bulk cutover job (approve path) on an environment where source and destination atimes differ
- **AND** the spec waits for the cutover run to complete
- **THEN** destination atimes for file, directory, and symlink SHALL equal source atimes
