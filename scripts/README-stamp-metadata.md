# stamp-metadata.ps1

Stamps all file metadata from a source SMB share to a destination SMB share, preserving NTFS ACLs, owner/group SIDs, timestamps, and file attributes.

Uses the same `FastAcl` P/Invoke layer and `Get-FileSecurityFast` / `Set-FileSecurityFast` functions as the NDM worker service (`powershell.script.ts`), and the same `TokenManipulator` privilege helper.

## Prerequisites

- **Windows** machine (PowerShell 5.1 or later)
- **Run as Administrator** (required for `SeBackupPrivilege` and `SeRestorePrivilege` to set owner SIDs)
- Network access to both source and destination SMB shares on port 445
- User accounts with read permission on source and write/restore permission on destination
- The script file must be saved with **CRLF line endings** (Windows default). If edited on macOS/Linux, convert with `unix2dos` or the PowerShell ISE before running.

## What It Preserves

| Property | Details |
|---|---|
| Owner SID | The security identifier of the file owner |
| Group SID | The primary group SID |
| DACL | All Access Control Entries (Allow/Deny), in exact source order, with all AceFlags |
| Inherited ACEs | Inherited ACEs from the source are promoted to explicit ACEs on the destination (see ACL Behavior below) |
| File Attributes | Hidden, ReadOnly, Archive, System, Compressed, etc. |
| CreationTime | UTC creation timestamp |
| LastWriteTime | UTC last-modified timestamp |
| LastAccessTime | UTC last-accessed timestamp |

## ACL Behavior

The destination DACL is always written with `PROTECTED_DACL_SECURITY_INFORMATION`. This means:

- **All source ACEs** (both explicit and inherited) are stamped onto the destination as explicit ACEs.
- The Inherited bit (`0x10`) is stripped from AceFlags so ACEs appear as fully explicit in the Windows Security UI.
- Inheritance propagation flags (`ContainerInherit`, `ObjectInherit`, etc.) are preserved so child objects will still inherit correctly from the destination.
- The destination no longer inherits from its own parent container after stamping. This faithfully reproduces the source security descriptor rather than mixing source ACEs with destination-parent inherited ACEs.

> **Cross-domain SIDs**: If source and destination are in different domains, SIDs that cannot be resolved on the destination machine will appear as raw SID strings (e.g. `S-1-5-21-...`) in the Windows Security UI. The ACE is still applied correctly; Windows just cannot display a username for an unknown-domain SID. Use `-SidMapFile` to translate source SIDs to their destination-domain equivalents before stamping.

## Usage

### Basic (same credentials, auto-scan all files)

```powershell
.\stamp-metadata.ps1 `
    -SourceShare "\\source-server\share1" `
    -DestShare "\\dest-server\share1" `
    -SourceUsername "DOMAIN\admin" `
    -SourcePassword "P@ssw0rd"
```

Mounts both shares, recursively scans all files and directories on the source, and stamps metadata onto the matching paths on the destination.

### Different credentials for source and destination

```powershell
.\stamp-metadata.ps1 `
    -SourceShare "\\source-server\share1" `
    -DestShare "\\dest-server\share1" `
    -SourceUsername "DOMAIN\src-admin" `
    -SourcePassword "SrcPass" `
    -DestUsername "DOMAIN\dst-admin" `
    -DestPassword "DstPass"
```

### With a CSV input file (specific files only)

```powershell
.\stamp-metadata.ps1 `
    -SourceShare "\\source-server\share1" `
    -DestShare "\\dest-server\share1" `
    -SourceUsername "DOMAIN\admin" `
    -SourcePassword "P@ssw0rd" `
    -InputFile "files-to-stamp.csv"
```

### With SID mapping (cross-domain migration)

When migrating between two different domains, use `-SidMapFile` to translate source-domain SIDs to their destination-domain equivalents:

```powershell
.\stamp-metadata.ps1 `
    -SourceShare "\\source-server\share1" `
    -DestShare "\\dest-server\share1" `
    -SourceUsername "SRCDOMAIN\admin" `
    -SourcePassword "SrcPass" `
    -DestUsername "DSTDOMAIN\admin" `
    -DestPassword "DstPass" `
    -InputFile "files.csv" `
    -SidMapFile "sid-map.csv"
```

### Custom log and error file paths

```powershell
.\stamp-metadata.ps1 `
    -SourceShare "\\source-server\share1" `
    -DestShare "\\dest-server\share1" `
    -SourceUsername "DOMAIN\admin" `
    -SourcePassword "P@ssw0rd" `
    -LogFile "C:\logs\stamp.log" `
    -ErrorFile "C:\logs\stamp-errors.log"
```

## Parameters

| Parameter | Required | Default | Description |
|---|---|---|---|
| `-SourceShare` | Yes | — | UNC path to source share (`\\server\share`) |
| `-DestShare` | Yes | — | UNC path to destination share (`\\server\share`) |
| `-SourceUsername` | Yes | — | Credentials for source share (`DOMAIN\user` or `user@domain`) |
| `-SourcePassword` | Yes | — | Password for source share |
| `-DestUsername` | No | Same as `-SourceUsername` | Credentials for destination share |
| `-DestPassword` | No | Same as `-SourcePassword` | Password for destination share |
| `-InputFile` | No | (scan all) | CSV of specific paths to stamp (see format below) |
| `-SidMapFile` | No | (no translation) | CSV mapping source SIDs to destination SIDs (see format below) |
| `-LogFile` | No | `stamp-metadata-<ts>.log` | Path to full execution log |
| `-ErrorFile` | No | `stamp-metadata-<ts>-errors.log` | Path to per-item error log |

## CSV Input File Format

The CSV must have a column named exactly `Source Path`. The same path is used as both source and destination — there is no separate `DestPath` column. **Any additional columns are ignored**, so reports exported by other tools (with extra columns like `Error Type`, `Error Code`, `Error Message`, `Origin`, `Destination`, `Operation`, `Job Run Id`, `Last Failed Timestamp (UTC)`, etc.) can be passed in directly.

Minimal form:

```csv
Source Path
folder1\file1.txt
folder2\report.doc
subfolder\data
```

Multi-column form (extra columns are ignored):

```csv
Source Path,Error Type,Error Code,Error Message,Origin,Destination,Operation,Job Run Id,Last Failed Timestamp (UTC)
/srv/nfs_share/file_0001.txt,PERM_STAMP_CTIME_ERROR,PERM_STAMP_CTIME_CONFLICT,Permission ...,Origin...,Destination...,Update Metadata,eb00bf34-...,Tue Apr 28 2026 08:16:52
/srv/nfs_share/file_0002.txt,PERM_STAMP_CTIME_ERROR,PERM_STAMP_CTIME_CONFLICT,Permission ...,Origin...,Destination...,Update Metadata,eb00bf34-...,Tue Apr 28 2026 08:16:52
```

Paths are **relative to the share root** — do not include `\\server\share\` prefixes or drive letters. Each value is normalised before use:

- Leading `/` or `\` are stripped, so `/srv/nfs_share/file_0001.txt` is treated as `srv/nfs_share/file_0001.txt`.
- Forward slashes are converted to backslashes for the Windows/SMB mounted view, so `mtime/hello.txt` becomes `mtime\hello.txt` and is accessed as `S:\mtime\hello.txt` on the mounted source share (and `T:\mtime\hello.txt` on the destination).

## SID Map File Format (`-SidMapFile`)

Required columns: `SourceSID`, `DestSID`.

```csv
SourceSID,DestSID
S-1-5-21-142954655-3166001488-1321770916-1373,S-1-5-21-444-555-666-1001
S-1-5-21-142954655-3166001488-1321770916-2757,S-1-5-21-444-555-666-1002
S-1-5-21-142954655-3166001488-1321770916-9999,Invalid
```

**Behaviour per row:**

| DestSID value | Effect |
|---|---|
| A valid SID string | Owner, Group, or ACE SID is replaced with the destination SID before stamping |
| `Invalid` | The ACE with that source SID is **dropped** from the DACL (Owner/Group fallback to raw SID with a warning) |
| *(absent from file)* | SID is stamped as-is (raw SID string) |

The map is applied to the Owner, Group, and every ACE SID in the DACL. SIDs not listed in the file are left unchanged.

### How to generate the SID map

Run the following on a machine that has access to both domains to match users by `SamAccountName`:

```powershell
$srcDomain  = "rootdomain.local"
$destDomain = "anf-26f1.rootdomain.local"

"SourceSID,DestSID" | Out-File sid-map.csv -Encoding UTF8
Get-ADUser -Filter * -Server $srcDomain -Properties SID | ForEach-Object {
    $destUser = Get-ADUser -Filter "SamAccountName -eq '$($_.SamAccountName)'" `
                           -Server $destDomain -ErrorAction SilentlyContinue
    if ($destUser) {
        "$($_.SID),$($destUser.SID)" | Out-File sid-map.csv -Append -Encoding UTF8
    }
}
```

## Output Files

| File | Description |
|---|---|
| `stamp-metadata-YYYYMMDD-HHMMSS.log` | Full execution log (all INFO, WARN, ERROR messages) |
| `stamp-metadata-YYYYMMDD-HHMMSS-errors.log` | Per-item errors: source path, dest path, stage, and error message |
| `stamp-metadata-YYYYMMDD-HHMMSS-failures.csv` | CSV of all failed items (`Source Path`, `Error`). Can be passed directly to `-InputFile` for retry. |

## Retrying Failed Items

If some files fail (e.g., access denied on a few paths), the script writes a `-failures.csv` file. Re-run with it as input:

```powershell
.\stamp-metadata.ps1 `
    -SourceShare "\\source-server\share1" `
    -DestShare "\\dest-server\share1" `
    -SourceUsername "DOMAIN\admin" `
    -SourcePassword "P@ssw0rd" `
    -InputFile "stamp-metadata-20260427-140000-failures.csv"
```

## Error Scenarios Handled

| Scenario | Behavior |
|---|---|
| Invalid UNC path | Exits with error before mounting |
| Source and dest are the same share | Exits with error (prevents self-overwrite) |
| Empty credentials | Exits with error |
| InputFile not found or not CSV | Exits with error |
| InputFile empty or missing SourcePath column | Exits with error showing found columns |
| SidMapFile not found or not CSV | Exits with error |
| SidMapFile missing SourceSID or DestSID column | Exits with error showing found columns |
| ACE SID maps to `Invalid` | ACE dropped from DACL, logged as WARN |
| SID not in map | Stamped as raw SID string; if unresolvable on destination, logged as WARN |
| Server unreachable on port 445 | Exits with error (pre-checked with `Test-NetConnection`) |
| Drive letter already in use (`net use` error 85) | Exits with accurate error message extracted from `net use` output |
| Mount fails (bad creds, wrong share, etc.) | Exits with human-readable message for the specific Windows error code (1326 = bad password, 53 = path not found, 1219 = multiple connections, etc.) |
| Not running as Administrator | Warning logged, continues (owner SID stamping may fail on some files) |
| Source path not found | Skipped, logged as WARN, written to error file |
| Dest path not found | Skipped, logged as WARN, written to error file |
| Type mismatch (source is dir, dest is file) | Skipped, logged as WARN |
| Path exceeds MAX_PATH (260 chars) | Warning logged, operation attempted anyway |
| `GetNamedSecurityInfo` fails | Logged as ERROR with Win32 message, written to error file and failures CSV |
| Unsupported ACE type | Exception thrown, item logged as FAIL |
| `SetNamedSecurityInfo` fails | Exception thrown, logged as ERROR with Win32 error code and message |
| Unresolved SIDs on destination | WARN logged with SID list and written to error file; ACE is still applied |
| Cannot set file attributes | Warning logged; ACL and timestamps still applied |
| Cannot set timestamps | Warning logged; ACL and attributes still applied |
| Script interrupted (Ctrl+C) | `finally` block runs: prints summary, exports failures CSV, unmounts drives |
| P/Invoke memory leak | `finally` block in `Set-FileSecurityFast` always frees `AllocHGlobal` pointers |
| Symlinks / junctions / reparse points | Detected and processed (metadata stamped on the link itself) |

## Drive Letters

The script mounts the source share to `S:` and the destination share to `T:`. If either is already in use by a local drive or another network share, edit the `$srcDrive` and `$dstDrive` variables near the bottom of the script before the `Mount-Share` calls.

## Implementation Notes

The script embeds the same P/Invoke C# types and PowerShell functions used by the NDM worker service:

| Component | Source in NDM codebase |
|---|---|
| `FastAcl` + `MarshalHelpers` C# types | `psBaseAclDefinition` in `powershell.script.ts` |
| `TokenManipulator` C# type | `psEnableBackupPrivilegeScript` in `powershell.script.ts` |
| `Get-FileSecurityFast` | `psBaseAclDefinition` in `powershell.script.ts` |
| `Set-FileSecurityFast` | `psBaseAclDefinition` in `powershell.script.ts` |
| `Map-Sid` | `psBaseAclDefinition` in `powershell.script.ts` |

Timestamps (`CreationTime`, `LastWriteTime`, `LastAccessTime`) are handled by a separate `Set-FileTimestamps` function because `Get-FileSecurityFast` does not include them in its JSON output.

## Limitations

- SACL (audit entries) are not transferred. Transferring SACL requires `SeSecurityPrivilege` and is rarely needed for data migration.
- Cross-domain SIDs stamp correctly by raw SID value but will display as unresolved in the Windows Security UI if the destination machine cannot contact the source domain. Use `-SidMapFile` to translate them to destination-domain SIDs. The access rules are enforced correctly by the kernel regardless of display name resolution.
- Compressed/encrypted attributes: the attribute flag is copied, but actual NTFS compression/encryption state depends on the destination filesystem.
- Sparse file flag is preserved as an attribute but sparse data ranges are not modified.
