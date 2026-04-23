# NFSv4 ACL POC

Proof-of-concept scripts to validate NFSv4 ACL support before full implementation.

## Files

| File | Purpose |
|------|---------|
| `nfs4-acl-types.ts` | Type definitions: `Nfs4AceText`, `Nfs4AceBinary`, constants for ACE type/flag/perm bits |
| `nfs4-acl-xdr.ts` | XDR binary parser/serializer + `nfs4_getfacl` text parser |
| `nfs4-acl-libc.ts` | koffi → libc.so.6 bindings for `getxattr` / `setxattr` |
| `nfs4-acl-poc.ts` | **Experiments 1 + 2**: round-trip fidelity + performance benchmark |
| `nfs4-acl-buildcommand-analysis.ts` | **Experiment 3**: buildCommand sync analysis + self-test |

## Prerequisites

- Linux worker machine (the datamigrator worker systemd service runs as `root`)
- NFSv4 source and target mounts available
- `nfs4-acl-tools` installed (for comparison/verification only — the POC itself uses koffi+libc, not the CLI tools)
- `koffi` already in `package.json` — no new npm packages needed

```bash
# Verify NFSv4 mounts
mount | grep nfs4

# Verify root
whoami  # should print: root

# Optional: install nfs4-acl-tools for manual comparison
apt install nfs4-acl-tools   # Ubuntu/Debian
yum install nfs4-acl-tools   # RHEL/CentOS
```

## Running the POC

### From the worker service directory

```bash
cd services/worker

# Experiment 3 first (no NFS mount needed — just logic analysis + self-test)
npx ts-node -r tsconfig-paths/register src/poc/nfs4-acl-buildcommand-analysis.ts

# Experiment 1: single file round-trip
# Replace paths with real NFSv4 mount paths
npx ts-node -r tsconfig-paths/register src/poc/nfs4-acl-poc.ts \
  /mnt/nfs4-source/testdir/file.txt \
  /mnt/nfs4-target/testdir/file.txt

# Experiments 1 + 2: round-trip + 100-file benchmark
npx ts-node -r tsconfig-paths/register src/poc/nfs4-acl-poc.ts \
  /mnt/nfs4-source/testdir/file.txt \
  /mnt/nfs4-target/testdir/file.txt \
  --bench 100
```

## What Each Experiment Validates

### Experiment 1 — Round-trip fidelity
- Reads `system.nfs4_acl` xattr from source via `koffi → getxattr`
- XDR-decodes binary → `Nfs4AceBinary[]` → `Nfs4AceText[]`
- In-memory encode/decode round-trip check
- Writes to target via `koffi → setxattr`  
- Reads back and compares ACEs
- **Pass criteria:** All A/D ACEs match exactly; latency < 10ms per file

### Experiment 2 — Performance benchmark
- Runs getxattr + XDR decode/encode + setxattr for N files
- Measures avg/p50/p95/p99 latency
- Compares to WinShellService PowerShell baseline (~50-200ms/op)
- **Pass criteria:** avg < 5ms/file → no persistent shell pool needed

### Experiment 3 — buildCommand sync analysis
- Verifies koffi calls are synchronous → buildCommand does NOT need to become async
- Self-tests the `isNfsV4()` helper function
- Documents exact files and lines that need to change in Phase 3

## Interpreting Results

### If `system.nfs4_acl` xattr is null on source
The NFS server does not expose NFSv4 ACLs via the xattr interface. Options:
- Check mount options: must include `nfsvers=4.x` (already correct per worker.env.j2)
- Check NFS server config: ACL support must be enabled server-side (ONTAP: `vserver nfs modify -vserver <vs> -v4-acl-preserve enabled`)
- Fall back to POSIX chmod/chown only (current behavior) — this is the graceful degradation path

### If XDR decode fails
The server uses a non-standard XDR format. Capture the raw hex and compare to RFC 7531.
Known variants:
- `system.nfs4_acl` — standard Linux NFS client (RFC 7531 XDR)
- `system.nfs4_acl_xdr` — TrueNAS/ZFS (same encoding, different xattr name)
- `security.nfs4acl_ndr` — Samba vfs_nfs4acl_xattr (NDR format, different encoding)

### If setxattr fails
- Ensure the process is running as root (`User=root` in worker.service.j2 — confirmed)
- Ensure target NFS mount supports ACL writes
- Check server-side ACL export permissions

## Key Design Decision Confirmed by POC

**koffi FFI calls are synchronous** — `buildCommand()` stays synchronous.
No persistent shell pool needed (unlike `WinShellService`).
No new npm packages needed (`koffi` already in package.json).
