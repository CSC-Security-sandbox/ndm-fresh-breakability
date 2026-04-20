# SMB/NFS Migration: Library & Language Comparison

_Research date: 2026-04-20_

This document compares options for replacing PowerShell-based SMB migration scripts. It covers Go SMB client libraries, alternative languages with SMB support, and performance tradeoffs of Python and Node.js.

---

## 1. Requirements

Features required for the migration use case:

1. Copy files from source SMB share to destination
2. Get / Set ACLs (security descriptors)
3. Add principals (modify ACLs to grant access)
4. Access shares using **BACKUP_OPERATOR** privilege (`FILE_OPEN_FOR_BACKUP_INTENT` + `SeBackupPrivilege`)
5. SID mapping and resolution (including cross-domain)

Library selection criteria:

1. Current issues/limitations in the required features
2. How active is maintenance/support
3. Frequency of releases
4. Performance of the library for copying

---

## 2. Go SMB Client Libraries

### 2.1 Repositories evaluated (as of 2026-04-20)

| Library | Stars | Last commit | Releases | Open issues | Status |
|---|---|---|---|---|---|
| **cloudsoda/go-smb2** | 28 | 2026-04-08 | No semver (snapshot `f37a6f4`, 2026-02-26) | 2 | **Actively maintained** |
| **hirochachacha/go-smb2** | 401 | 2022-07-15 | None | 43 | Effectively dead |
| **jfjallid/go-smb** | 76 | 2026-02-26 | v0.7.0 (Feb 2026), v0.6.2 (Apr 2025) | 3 | Actively maintained |
| **stacktitan/smb** | 170 | 2019-05-31 | None | 6 | Dead |
| gentlemanautomaton/smb | 97 | 2019-10-19 | — | — | Abandoned |
| macos-fuse-t/go-smb2 | 132 | active | — | — | Server only — out of scope |
| oiweiwei/go-msrpc | 150 | active | — | — | RPC-focused; uses hirochachacha fork |
| amzza0x00/go-impacket | 246 | 2023-08-28 | — | — | Stale; offensive-tooling port |

### 2.2 Feature matrix

Legend: **YES** = implemented and publicly exposed, **PART** = present but requires workaround / internal API, **NO** = not supported.

| Requirement | hirochachacha/go-smb2 | cloudsoda/go-smb2 | jfjallid/go-smb | stacktitan/smb |
|---|---|---|---|---|
| **SMB 2 dialect** | YES (2.0.2 / 2.1 / 3.0 / 3.0.2 / 3.1.1) | YES + fixes | YES (2.1 / 3.0 / 3.0.2 / 3.1.1; also raw SMB1 relay) | Partial SMB 2.1 only |
| **SMB3 encryption (AES-CCM/GCM)** | YES | YES (alloc fixes #36, #39) | YES (+DCE/RPC encryption Feb 2026) | NO |
| **SMB3 signing** | YES | YES | YES | Partial |
| **Kerberos auth** | YES (gokrb5) | YES (gokrb5) | YES (forked gokrb5) | NO |
| **Copy file src→dst** | YES (io.Reader/Writer) | YES + batched ReadDirPlus | PART (low-level OpenFile/Read/Write; no io.Copy helper) | Very limited |
| **Get ACL (security descriptor)** | NO — issue [#65](https://github.com/hirochachacha/go-smb2/issues/65) open since 2020 | **YES** — `Share.SecurityInfo`, `SecurityInfoRaw`, `ReadDirPlus` returns SDs | PART — `msdtyp` structs, `QueryInfoSecurity` (PR #18); issue #21 open: owner SID from shares | NO |
| **Set ACL / write SD** | NO | **YES** — `Share.SetSecurityInfo(Raw)`, `File.SetSecurityInfo(Raw)` (PR #23, #28). Auto WRITE_DAC/WRITE_OWNER | PART — `SetInfoReq/Res` primitives; hand-build the request | NO |
| **Add principal / modify ACE** | NO | YES — parse SD (cloudsoda/sddl), append ACE, write back | DIY via `msdtyp.ACE` / `msdtyp.SID` | NO |
| **SeBackupPrivilege / FILE_OPEN_FOR_BACKUP_INTENT** | Constant defined but **not exposed** (fork required) | Same — constant present, not exposed; small fork needed | **Best** — `NewCreateReq(..., createOptions uint32, ...)` accepts raw flags; OR in `0x00004000` | NO |
| **SID → Name / Name → SID (LSARPC)** | NO | NO | **YES** — `dcerpc/mslsad`: `LsarLookupSids2`, `LsarLookupNames3`, `LsarGetUserName` | NO |
| **Cross-domain SID resolution** | NO | NO | PART — trusted-domain error handling (STATUS_TRUSTED_DOMAIN_FAILURE) present | NO |
| **DFS referrals** | Open issue #69, #48 (no plans) | Open issue #20 (in progress) | Roadmap item (#19) | NO |
| **Thread safety** | YES (but stale mutex bugs #90, #101) | YES — atomic.Pointer session (#44), lockless tree tables (#45) | YES | Uncertain |
| **Performance posture** | No benchmarks; issue #52 "slow backup" open since 2022 | **Active perf work Mar 2026**: PRs #36, #39, #40, #41, #42; dedicated `conn_bench_test.go` | Adequate for RPC; not tuned for bulk copy | N/A |
| **Known crash bugs** | #98, #101, #90 open/unfixed | None outstanding | None outstanding | Unmaintained |
| **Maintenance cadence (last 6 mo)** | 0 commits | ~15 PRs merged Mar–Apr 2026 | ~15 commits Feb 2026 (v0.7.0) | 0 |
| **License** | BSD-2-Clause | BSD-2-Clause | MIT | MIT |

### 2.3 Key issues / PRs

- **hirochachacha**: [#65](https://github.com/hirochachacha/go-smb2/issues/65) (SEC_INFO request), [#98](https://github.com/hirochachacha/go-smb2/issues/98) (packet-validation crash), [#101](https://github.com/hirochachacha/go-smb2/issues/101) (panic on truncated pkt), [#90](https://github.com/hirochachacha/go-smb2/issues/90) (Azure encrypt crash), [#52](https://github.com/hirochachacha/go-smb2/issues/52) (slow backup)
- **cloudsoda**: PRs [#22](https://github.com/CloudSoda/go-smb2/pull/22)/[#23](https://github.com/CloudSoda/go-smb2/pull/23)/[#27](https://github.com/CloudSoda/go-smb2/pull/27)/[#28](https://github.com/CloudSoda/go-smb2/pull/28) SD read/write, [#24](https://github.com/CloudSoda/go-smb2/pull/24) Kerberos, [#42](https://github.com/CloudSoda/go-smb2/pull/42) compound SD queries, [#36](https://github.com/CloudSoda/go-smb2/pull/36)/[#39](https://github.com/CloudSoda/go-smb2/pull/39)/[#40](https://github.com/CloudSoda/go-smb2/pull/40)/[#41](https://github.com/CloudSoda/go-smb2/pull/41) perf, [#44](https://github.com/CloudSoda/go-smb2/pull/44) atomic session ptr. Open: [#20](https://github.com/CloudSoda/go-smb2/issues/20) DFS
- **jfjallid**: [#19](https://github.com/jfjallid/go-smb/issues/19) roadmap, [#21](https://github.com/jfjallid/go-smb/issues/21) owner SID from shares (open), [#18](https://github.com/jfjallid/go-smb/pull/18) QueryInfoSecurity (merged), [#23](https://github.com/jfjallid/go-smb/pull/23) decouple DCERPC from SMB (Feb 2026)

### 2.4 Capability gap map

| Requirement | Best Go library |
|---|---|
| File copy | cloudsoda/go-smb2 |
| Get/Set ACL | **cloudsoda/go-smb2** (only complete high-level API) |
| Add principal to ACL | cloudsoda/go-smb2 + [cloudsoda/sddl](https://github.com/cloudsoda/sddl) |
| BACKUP_INTENT | **jfjallid** (only lib exposing it); or small cloudsoda fork |
| SID ↔ Name (cross-domain) | **jfjallid/go-smb** (only Go lib with LSAT) |

### 2.5 Go recommendation

**Primary: `cloudsoda/go-smb2` + companion `jfjallid/go-smb` for SID resolution. Fork cloudsoda for BACKUP_INTENT.**

Rationale:

1. cloudsoda is the **only actively maintained Go SMB client with first-class ACL/SD support**. Covers requirements 1–3 directly. Active throughout March–April 2026 with performance, correctness, feature work. Companion `cloudsoda/sddl` parses/serializes security descriptors for ACE mutation.
2. **hirochachacha/go-smb2 is effectively dead** — last real commit July 2022, 43 open issues including unfixed crashes, zero SD support. High star count is historical.
3. jfjallid/go-smb is the **only Go SMB library with full LSAT** (`LsarLookupSids2`, `LsarLookupNames3`) including cross-domain trust error paths. Use it alongside cloudsoda via a separate IPC$ connection to the DC.
4. stacktitan/smb, gentlemanautomaton/smb, amzza0x00/go-impacket are dead.
5. macos-fuse-t/go-smb2 is a server library — not applicable. oiweiwei/go-msrpc uses a hirochachacha fork for transport, so not a standalone SMB client.

### 2.6 Caveats for Go path

- **BACKUP_INTENT is the real gap.** No Go SMB library exposes `FILE_OPEN_FOR_BACKUP_INTENT` on a high-level API. Options (in order of effort):
  - **Preferred:** Submit ~50-line PR to cloudsoda adding `WithBackupIntent()` MountOption. The constant is already in `internal/smb2/const.go`; just needs OR'ing into `CreateOptions` in call sites in `client.go`. Likely to be accepted given maintainer cadence.
  - Vendor/fork cloudsoda with the patch.
  - Use jfjallid end-to-end (exposes `createOptions`), losing cloudsoda's high-level file/ACL helpers.
- **No semver on cloudsoda** — pin a commit SHA in `go.mod` (e.g. `f37a6f4`). Maintainer has stated pre-1.0.0 status.
- **Cross-domain SID resolution** — jfjallid has the hooks but no documented test matrix for multi-forest / one-way trusts. Plan integration tests against actual AD topology.
- **DFS namespaces** — neither cloudsoda nor hirochachacha supports DFS referrals. Test early if DFS paths are in scope.
- **Benchmark before committing** — no published copy-throughput numbers exist. Run your own against representative filers.

---

## 3. Alternatives to PowerShell (languages with SMB support)

### 3.1 Out-of-the-box SMB support by language

| Language / Runtime | SMB native? | Notes |
|---|---|---|
| **.NET / C# (Windows)** | **Yes — fully native** | UNC paths `\\server\share` work with `System.IO.File`, `FileStream`. Uses the Windows SMB redirector (kernel mini-redirector). ACLs via `System.Security.AccessControl`. SID work via `System.Security.Principal`. Privileges via P/Invoke `AdjustTokenPrivileges`. |
| **.NET / C# (Linux/macOS)** | No | Need SMBLibrary or mount via kernel cifs. |
| **PowerShell** | Same as .NET | Current baseline. |
| **Python** | No (stdlib), but mature libs | `smbprotocol`, `pysmb`, `impacket`. |
| **Java** | No (stdlib) | `smbj` (hierynomus), `jcifs-ng`. |
| **Rust** | No | Early-stage crates only. |
| **Go** | No (stdlib) | Libraries covered in §2. |
| **C/C++** | No (stdlib) | `libsmb2` (Sahlberg), Samba's `libsmbclient`. |
| **Node.js** | No | npm SMB libs mostly abandoned; no SMB3/ACL support. |

### 3.2 Realistic alternatives

#### C# / .NET on Windows — strongest fit

| Requirement | How it's done |
|---|---|
| Copy file | `File.Copy(@"\\src\share\f", @"\\dst\share\f")` — kernel redirector handles SMB3/encryption/signing |
| Get/Set ACL | `File.GetAccessControl` / `SetAccessControl`, `FileSecurity.AddAccessRule` |
| Add principal | `fs.AddAccessRule(new FileSystemAccessRule(ntAccountOrSid, rights, AccessControlType.Allow))` |
| **BACKUP_OPERATOR / SeBackupPrivilege** | P/Invoke `AdjustTokenPrivileges` with `SE_BACKUP_NAME` / `SE_RESTORE_NAME`, then `CreateFile` with `FILE_FLAG_BACKUP_SEMANTICS` — fully supported, documented |
| SID mapping | `SecurityIdentifier.Translate(typeof(NTAccount))`; `LsaLookupSids2` via P/Invoke for cross-domain |
| Throughput | Uses kernel redirector → typically faster than any user-mode SMB stack |

Tools worth knowing:

- **SMBLibrary** (TalAloni) — pure-managed SMB1/2/3 client+server; useful cross-platform or when bypassing the redirector.
- **Robocopy** / **emcopy** — already handle BACKUP_OPERATOR + ACLs if CLI orchestration fits.
- **Microsoft Storage Migration Service** — end-to-end tool for file-server migrations incl. ACLs/SIDs.

#### Python — best cross-platform, very mature

- **[smbprotocol](https://github.com/jborean93/smbprotocol)** (jborean93) — actively maintained, SMB 2/3 with encryption/signing, Kerberos, DFS, security descriptor read/write, `CreateOptions` exposed so `FILE_OPEN_FOR_BACKUP_INTENT` can be passed directly.
- **[impacket](https://github.com/fortra/impacket)** — LSARPC/SAMR for SID resolution and trusted-domain lookups. Pairs with smbprotocol to match the Go (cloudsoda + jfjallid) combo.
- Copy performance: below kernel redirector; fine when parallelized.

#### Java — `smbj` (hierynomus)

- SMB 2/3, encryption, signing, Kerberos.
- Exposes `SMB2CreateOptions.FILE_OPEN_FOR_BACKUP_INTENT` directly.
- Security descriptor read/write via `File.getSecurityInformation` / `setSecurityInformation`.
- SID resolution: pair with `rpc4j` or call LSARPC yourself.
- Active, 1.6k stars, regular releases.

#### C with libsmb2 or libsmbclient

- Fastest user-mode option; most granular control.
- Highest dev cost; ACL/SID plumbing is all DIY.
- Pick only after hitting perf ceilings elsewhere.

### 3.3 Cross-option comparison

| Option | ACL | BACKUP_INTENT | SID resolution | Copy perf | Dev effort | Cross-platform |
|---|---|---|---|---|---|---|
| **C# on Windows** | Built-in | Built-in (P/Invoke) | Built-in | **Best** (kernel redirector) | Low | Windows only |
| **Python smbprotocol + impacket** | Yes | Yes | Yes | Medium | Low | Yes |
| **Java smbj** | Yes | Yes | DIY RPC | Medium | Medium | Yes |
| **Go cloudsoda + jfjallid** | Yes | Needs fork | Yes (jfjallid) | Medium, improving | Medium | Yes |
| **PowerShell (baseline)** | Yes | Yes | Yes | Best (same redirector) | Low | Windows only |
| **C libsmb2** | DIY | DIY | DIY | Best user-mode | High | Yes |
| **Node.js** | No lib | No lib | No lib | N/A | Very high (build it yourself) | N/A |

---

## 4. Python Performance for NFS/SMB Migration

### 4.1 Summary

- **NFS:** Python is fine. Mount via kernel; Python orchestrates `os`/`shutil`. Bottleneck is network, not language.
- **SMB via `smbprotocol`:** expect **2–5× lower per-connection throughput** than kernel redirectors or Go/C libs, especially with SMB3 encryption. Mitigate with heavy parallelism.

### 4.2 Where Python costs you

**Pure-Python SMB framing:**

| Operation | Python overhead impact |
|---|---|
| SMB3 AES-GCM / AES-CCM encryption | **Severe** — ~30–80 MB/s per connection vs. 500+ MB/s for kernel/Go |
| SMB3 signing (AES-CMAC) | Moderate — ~10–25% tax |
| Unencrypted SMB2 read/write | Small — ~70–85% of wire speed on 1 GbE |
| Metadata ops (Create/Close/QueryInfo) | **Significant** — ~1–3 ms Python overhead per call |

**GIL and parallelism:**

- Threads release GIL during socket I/O and `cryptography` C backend; scales to ~50–100 workers.
- Beyond that, use `multiprocessing` (separate processes, separate GILs, separate SMB sessions).
- Per-process memory: ~40–80 MB. 64 workers ≈ few GB.

**Small-file vs large-file:**

| Workload | Python impact |
|---|---|
| Small files (<1 MB, deep trees, ACLs) | Metadata-dominated. 10M files × 2 ms = ~5.5 h pure Python overhead |
| Large files (multi-GB) | Encryption-bound; unencrypted is tolerable |

**SID resolution (impacket LSARPC):** batches well (~1000 SIDs/call). 1M SIDs = minutes. Cache aggressively — most migrations see <10k unique SIDs on 10M files.

### 4.3 NFS is different

Kernel-mount NFS (`mount -t nfs`) → Python uses `os`, `shutil`, `pathlib`, `xattr`, `posix1e` against the mount. Python is not in the data path; throughput matches `cp`/`rsync`. Orchestration overhead is microseconds per file. User-space NFS clients in Python (`pyNFS` etc.) are unmaintained; don't use them.

### 4.4 Concrete expectations (10 GbE, encrypted SMB3)

| Stack | Large-file throughput | Small-file rate (4 KB ACL'd) |
|---|---|---|
| C# on Windows (kernel redirector) | 800+ MB/s | 1500–3000/s |
| Go (cloudsoda, post-2026 perf work) | 300–600 MB/s | 600–1200/s |
| **Python smbprotocol, single conn** | **50–100 MB/s** | **150–400/s** |
| **Python, 32 parallel processes** | **~1–3 GB/s aggregate** (NIC-bound) | **~3000–8000/s** |
| Kernel cifs mount + Python os.* | NIC-bound | 2000–5000/s |

Orders of magnitude, not benchmarks.

### 4.5 Mitigations for Python

1. **Kernel-mount when possible.** `mount -t cifs` with `backupuid` + `cifsacl`, then Python on the mount. Loses protocol-level BACKUP_OPERATOR story; gains kernel throughput.
2. **Multiprocessing pool > thread pool** for CPU-bound encrypt. 1 process per core.
3. **Disable encryption where security model allows** (dedicated migration VLAN). Signing alone is much cheaper. 3–5× throughput gain.
4. **Batch metadata.** `ReadDirPlus`-equivalent patterns, compound requests, cache SID lookups.
5. **Pin to `cryptography` with OpenSSL backend** (default); never pure-Python ciphers.
6. **Reuse SMB sessions** across files — Kerberos handshake is ~100–300 ms.

### 4.6 Python decision guide

| Scale | Verdict |
|---|---|
| <10 TB, <1M files, no encryption mandate | Fine — simplest path |
| 10–100 TB, encryption required, small files | Workable with heavy parallelism; 2–5× longer than C#/Go |
| >100 TB or tight window with encryption | Wrong tool — use C# (Windows) or Go |
| NFS-only or NFS-heavy | Python via kernel mount — no meaningful penalty |

---

## 5. Node.js vs Python

### 5.1 Headline

Node.js is the **weaker choice** for this migration — not because the runtime is slow, but because the **SMB library ecosystem is far behind Python's**. Raw runtime perf favors Node; real-world migration perf favors Python.

### 5.2 Runtime (language-level)

| Dimension | Node.js (V8) | Python (CPython 3.12+) | Winner |
|---|---|---|---|
| JIT compilation | Yes (TurboFan) | No (interpreter) | **Node** — 3–10× faster hot loops |
| Async I/O model | libuv, event-loop, non-blocking | asyncio / threads | **Node** — lower per-op overhead |
| CPU parallelism | `worker_threads`, `cluster` | `multiprocessing`, `threading` (GIL) | Tie via processes |
| Per-process memory | ~30–50 MB | ~40–80 MB | Node lighter |
| Native crypto | OpenSSL | OpenSSL via `cryptography` | Tie |
| Buffer / binary handling | Native `Buffer` | `bytes` / `memoryview` | **Node** |
| Startup time | 30–80 ms | 20–40 ms | Python slightly faster |

On pure compute, **Node is ~3–10× faster than Python** — matters for SMB framing hot loops.

### 5.3 SMB library gap (decisive)

| Capability | Python (`smbprotocol` + `impacket`) | Node.js (best npm) |
|---|---|---|
| Maintainer | jborean93, regular releases | Mostly abandoned/hobbyist |
| SMB 3.1.1 | Yes | **Mostly no** (SMB2 max in active pkgs) |
| SMB3 encryption | Yes | **No** |
| SMB3 signing | Yes | Partial / no |
| Kerberos | Yes (`pyspnego`, `pykrb5`) | Very limited |
| Security descriptor read/write | Yes | **No** |
| `FILE_OPEN_FOR_BACKUP_INTENT` | Exposed | Not exposed |
| SID ↔ name (LSARPC) | Yes (impacket) | **No** |
| DFS referrals | Yes | No |
| Last meaningful release | 2025–2026 | 2019–2022 |

This is the hard stop. Your migration requires SMB3 encryption, ACL r/w, SID resolution, and backup-intent opens. **None exist in Node.js today** — you'd write a production SMB3 client from scratch.

### 5.4 Where Node would win (hypothetically)

If a Node SMB3 library with ACL support existed:

- Thousands of concurrent file handles with minimal thread overhead.
- Faster per-packet framing (V8 JIT vs. CPython interpreter).
- Lower memory per concurrent op.

Estimated 2–3× single-connection throughput vs. smbprotocol. Theoretical — library doesn't exist.

### 5.5 Migration-context numbers

| Stack | Per-connection throughput | Feature completeness |
|---|---|---|
| C# / .NET on Windows | 800+ MB/s | Complete |
| Go (cloudsoda + jfjallid) | 300–600 MB/s | 90% (needs BACKUP_INTENT fork) |
| Python (smbprotocol) | 50–100 MB/s | Complete |
| **Node.js (hypothetical)** | ~150–300 MB/s | **~20% — you'd be writing it** |
| Node.js (existing npm) | 80–150 MB/s, **no SMB3/ACL** | **Blocker** |

### 5.6 Non-SMB parts

For orchestration APIs, dashboards, queues: Node and Python are interchangeable. Node edges out on high-concurrency HTTP; Python edges out on data/reporting and AD tooling (`ldap3`, `impacket`).

### 5.7 Kernel-mount path (viable Node option)

Kernel-mount the shares (`mount -t cifs` or Windows redirector) and drive `fs.copyFile`, `fs.stat`, `fs.chmod` against the mount:

- Node's I/O model shines for 1000s of parallel copies.
- ACLs via `cifsacl` xattrs or shell out to `getfacl`/`setfacl`/`icacls`.
- No protocol-level control (no BACKUP_INTENT unless mounted with `backupuid`).

Node ≈ Python in this mode; pick on team skill.

### 5.8 Node.js decision guide

| Situation | Choice |
|---|---|
| Need protocol-level SMB3 (BACKUP_INTENT, over-the-wire ACL, cross-domain SID) | **Python, not Node** |
| Kernel-mount acceptable, mostly orchestration | Either; pick on team skill |
| JS/TS-heavy team, mount-based migration fine | Node reasonable |
| Large scale (>50 TB) + encryption | Neither — use C# or Go |

---

## 6. Final Conclusions

### 6.1 Ranked recommendations

| Rank | Stack | When to pick |
|---|---|---|
| **1** | **C# / .NET on Windows** | Migration host can be Windows. Lowest risk replacement for PowerShell. Kernel-redirector throughput, built-in ACL/SID/BACKUP_OPERATOR. No third-party SMB library needed. |
| **2** | **Go: cloudsoda/go-smb2 + jfjallid/go-smb** | Cross-platform needed (Linux orchestrator), performance-sensitive, team comfortable maintaining a small fork for BACKUP_INTENT. |
| **3** | **Python: smbprotocol + impacket** | Cross-platform, tight timeline, moderate scale (<100 TB), willing to accept 2–5× slower per-connection perf offset by multiprocessing. All features exposed out-of-the-box including BACKUP_INTENT. |
| **4** | **Java smbj** | Already JVM-centric. Good SMB3 + BACKUP_INTENT support; SID resolution is DIY. |
| **5** | **Kernel cifs-mount + any language** | Fallback when library-level access isn't mandatory. Loses protocol-level BACKUP_OPERATOR but matches NIC speed. |
| **Not recommended** | **Node.js** | No viable SMB3/ACL library exists. Building one is out of scope for a migration. |

### 6.2 Requirement coverage summary

| Requirement | C# | Go (cloudsoda+jfjallid) | Python | Java (smbj) | Node.js |
|---|---|---|---|---|---|
| Copy | ✅ kernel | ✅ | ✅ | ✅ | ❌ no SMB3 lib |
| Get/Set ACL | ✅ | ✅ cloudsoda | ✅ | ✅ | ❌ |
| Add principal | ✅ | ✅ cloudsoda + sddl | ✅ | ✅ | ❌ |
| BACKUP_OPERATOR | ✅ P/Invoke | ⚠️ needs fork | ✅ | ✅ | ❌ |
| SID resolution (cross-domain) | ✅ | ✅ jfjallid | ✅ impacket | ⚠️ DIY | ❌ |

### 6.3 Performance summary (10 GbE, encrypted SMB3)

| Stack | Per-connection | Aggregate |
|---|---|---|
| C# (kernel redirector) | 800+ MB/s | NIC-bound |
| Kernel cifs + any orchestrator | NIC-bound | NIC-bound |
| Go (cloudsoda) | 300–600 MB/s | NIC-bound |
| Python (smbprotocol, 32 procs) | 50–100 MB/s each | ~1–3 GB/s aggregate |
| Node.js | Not viable for SMB3 at all | — |

### 6.4 Key caveats regardless of stack

- **Benchmark against your actual filers/NAS** before committing. Published numbers don't capture your workload mix.
- **Test cross-domain SID resolution early** against your AD topology (trusts, one-way, multi-forest).
- **Test DFS referrals** if any source paths are DFS — support is uneven across libraries.
- **Session reuse matters** — Kerberos handshakes are 100–300 ms; never open one session per file.
- **Encryption is the biggest perf lever** — if your security model allows disabling SMB3 encryption on a dedicated migration VLAN, expect 3–5× throughput gains. Signing alone is much cheaper.

### 6.5 The PowerShell exit strategy

If the goal is simply to replace PowerShell while keeping all capabilities:

1. **Same-platform (Windows) replacement:** C# console app or service. Minimal rewrite cost; same APIs under the hood as PowerShell. Gains: type safety, testability, performance.
2. **Cross-platform replacement:** Python with `smbprotocol` + `impacket`. Feature-complete but slower; mitigate with multiprocessing.
3. **Performance-first cross-platform:** Go with cloudsoda + jfjallid + a small BACKUP_INTENT fork.

Node.js is not a replacement path for PowerShell-based SMB migration at present.

---

## 7. Sources

### Go libraries

- [CloudSoda/go-smb2](https://github.com/CloudSoda/go-smb2)
- [hirochachacha/go-smb2](https://github.com/hirochachacha/go-smb2)
- [jfjallid/go-smb](https://github.com/jfjallid/go-smb)
- [stacktitan/smb](https://github.com/stacktitan/smb)
- [oiweiwei/go-msrpc](https://github.com/oiweiwei/go-msrpc)
- [gentlemanautomaton/smb](https://github.com/gentlemanautomaton/smb)
- [cloudsoda/sddl](https://github.com/cloudsoda/sddl)

### Other languages

- [jborean93/smbprotocol (Python)](https://github.com/jborean93/smbprotocol)
- [fortra/impacket (Python)](https://github.com/fortra/impacket)
- [hierynomus/smbj (Java)](https://github.com/hierynomus/smbj)
- [TalAloni/SMBLibrary (.NET)](https://github.com/TalAloni/SMBLibrary)
- [sahlberg/libsmb2 (C)](https://github.com/sahlberg/libsmb2)

### Reference

- [PowerShell FILE_FLAG_BACKUP_SEMANTICS discussion](https://github.com/PowerShell/PowerShell/issues/20770)
- [golang/go #23312 FILE_FLAG_BACKUP_SEMANTICS](https://github.com/golang/go/issues/23312)
- [Priv2Admin: SeBackupPrivilege reference](https://github.com/gtworek/Priv2Admin/blob/master/SeBackupPrivilege.md)