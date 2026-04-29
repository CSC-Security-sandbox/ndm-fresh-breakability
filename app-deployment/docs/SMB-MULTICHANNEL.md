# Enabling SMB Multichannel on Datamigrator Workers

SMB Multichannel opens multiple parallel TCP connections per SMB session, allowing the kernel SMB redirector to drive higher throughput against the source/destination file servers. This guide covers what to enable, where, and how to verify it on a Datamigrator Windows worker.

## Table of Contents

- [When this applies](#when-this-applies)
- [How multichannel works at a glance](#how-multichannel-works-at-a-glance)
- [Prerequisites](#prerequisites)
  - [NIC requirements](#nic-requirements)
  - [Cloud-specific NIC notes](#cloud-specific-nic-notes)
  - [Server-side requirements](#server-side-requirements)
- [Applying the configuration](#applying-the-configuration)
  - [On existing workers (one-shot script)](#on-existing-workers-one-shot-script)
  - [On new workers (Inno Setup installer)](#on-new-workers-inno-setup-installer)
- [What the script changes](#what-the-script-changes)
- [Verification](#verification)
- [Adjacent tuning that compounds the win](#adjacent-tuning-that-compounds-the-win)
- [Troubleshooting](#troubleshooting)
- [Rollback](#rollback)
- [References](#references)

---

## When this applies

- **Windows workers** that mount SMB shares via UNC paths (`\\server\share`) using the Windows kernel SMB redirector. This is the default Datamigrator path on Windows workers.
- Linux workers do **not** apply — they don't mount SMB. SMB cifs mounts on Linux are handled by the `jobs-service` on the control plane and are out of scope for this document.

## How multichannel works at a glance

```
                ┌──────────────────────────────────────────┐
                │           Datamigrator Worker            │
                │                                          │
                │   SMB client (mrxsmb.sys redirector)     │
                │   ┌───┐  ┌───┐  ┌───┐  ┌───┐             │
                │   │ch1│  │ch2│  │ch3│  │ch4│  ← TCP/445 │
                │   └─┬─┘  └─┬─┘  └─┬─┘  └─┬─┘             │
                └─────┼──────┼──────┼──────┼───────────────┘
                      │      │      │      │
                      ▼      ▼      ▼      ▼
                ┌──────────────────────────────────────────┐
                │  RSS-capable NIC (multi-queue)           │
                │  ↓                                       │
                │  Source / Destination SMB server         │
                └──────────────────────────────────────────┘
```

A single RSS-capable NIC opens N TCP connections (one per RSS queue, up to `ConnectionCountPerRssNetworkInterface`). Multichannel does **not** require multiple physical NICs.

---

## Prerequisites

### NIC requirements

You need **one** of the following on the worker. Without one, multichannel will silently fall back to a single channel.

| Setup | Channels obtained | Typical use |
|---|---|---|
| 1 RSS-capable NIC with ≥ 4 receive queues | 1 connection × `ConnectionCountPerRssNic` (default 4) | Most cloud VMs and modern bare metal |
| 2+ NICs of the same speed | 1 channel per NIC | Bare metal with redundant networking |
| 1 RDMA NIC (RoCE / iWARP / IB) | SMB Direct, kernel-bypass | Specialized fabrics |
| 1 non-RSS NIC | 1 channel only — **no benefit** | Avoid this |

Verify on the worker:

```powershell
Get-NetAdapterRss | Format-Table Name, Enabled, NumberOfReceiveQueues
Get-SmbClientNetworkInterface
```

Required: `Enabled = True`, `NumberOfReceiveQueues >= 4`, and `RSS Capable = True` in `Get-SmbClientNetworkInterface`.

### Cloud-specific NIC notes

Multiple NICs are **not** required. The right VM SKU with accelerated networking gets you multi-queue RSS on a single NIC.

| Cloud | Required setting |
|---|---|
| **Azure** | Enable **Accelerated Networking** on the worker NIC. Requires supported SKUs (Dv3/Dsv3+, Fsv2, etc.). Without it, RSS queues = 1. |
| **AWS** | **ENA** driver + multi-queue-capable instance (c5n, m5n, m6i, etc.). T-class instances typically have a single queue. |
| **GCP** | gVNIC driver + Tier_1 networking on supported machine types (n2-standard-32+, c3, …). |
| **vSphere** | VMXNET3 with RSS enabled in the guest. |
| **Bare metal** | Any modern 10 GbE+ NIC with RSS — Intel X710, Mellanox CX-4+, Broadcom 57xxx. |

### Server-side requirements

The other half of the story. Both client and server must support and enable multichannel.

| Server | Action |
|---|---|
| **Windows file server** | `Set-SmbServerConfiguration -EnableMultiChannel $true`. Default true on 2012+, but verify. Server NICs also need RSS. |
| **NetApp ONTAP** | `vserver cifs options modify -vserver <svm> -is-multichannel-enabled true -max-connections-per-session 4` |
| **Samba** | `smb.conf`: `server multi channel support = yes` (Samba 4.4+). Production stability is weaker than Windows/ONTAP — test before relying on it. |
| **Azure Files** | Multichannel **off by default**. Premium tier only. Enable: `Set-AzStorageFileServiceProperty -EnableSmbMultichannel $true`. |
| **AWS FSx for Windows** | Enable in the console / via the AWS API. |

Network path constraints:

- TCP port 445 reachable end-to-end (multichannel uses the same port for every channel, just multiple TCP sessions).
- Stateful firewalls or load balancers between worker and server must not pin SMB sessions to one backend or coalesce flows.
- No NIC teaming (LBFO) below SMB. Pick teaming **or** multichannel, not both. SET (Switch Embedded Teaming) is fine.
- No QoS policy pinning SMB traffic to a single queue.

---

## Applying the configuration

The repo ships an idempotent PowerShell script and an Inno Setup hook that runs it during install.

### On existing workers (one-shot script)

Copy [`services/worker/wininstaller/scripts/enable-smb-multichannel.ps1`](../../services/worker/wininstaller/scripts/enable-smb-multichannel.ps1) to the worker (e.g. `C:\datamigrator\scripts\`) and run it as Administrator:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File C:\datamigrator\scripts\enable-smb-multichannel.ps1
```

Optional flags:

```powershell
# Bump connection cap (useful when MAX_WRITE_CONCURRENCY is high)
.\enable-smb-multichannel.ps1 -MaxConnectionsPerServer 128

# Dry-run — show what would change without applying
.\enable-smb-multichannel.ps1 -WhatIf
```

The script is idempotent — safe to re-run. Outputs:

| Output | Path |
|---|---|
| Run log | `C:\datamigrator\logs\enable-smb-multichannel.log` |
| Pre-state snapshot (rollback reference) | `C:\datamigrator\logs\smb-multichannel-pre-state-<timestamp>.json` |

### On new workers (Inno Setup installer)

The script is bundled into [`installer.iss`](../../services/worker/wininstaller/installer.iss) and runs automatically during post-install (after fluent-package). No operator action needed — just rebuild the installer per [WINDOWS-WORKER.md](WINDOWS-WORKER.md) and use the resulting `datamigrator-worker-setup.exe`.

The bundled script is installed at `C:\datamigrator\scripts\enable-smb-multichannel.ps1` so it can be re-run later.

---

## What the script changes

All client-side, all reversible. Server-side and NIC-hardware settings are out of scope and must be applied separately.

| Setting | Default applied | Why |
|---|---|---|
| `EnableMultiChannel` (SMB client) | `True` | Master switch on the redirector. |
| `MaximumConnectionCountPerServer` | `64` | Default 32 caps total channels per server. With high `MAX_WRITE_CONCURRENCY` and parallel sessions, 32 becomes a bottleneck. |
| `ConnectionCountPerRssNetworkInterface` | `4` | Channels opened per RSS-capable NIC. Don't exceed NIC RSS queue count. |
| `ConnectionCountPerRdmaNetworkInterface` | `2` | Channels opened per RDMA NIC (only relevant on SMB Direct setups). |
| `Enable-NetAdapterRss` on every physical "Up" NIC | enabled | Without RSS, multichannel collapses to 1 channel. |

No reboot required. Existing SMB sessions don't pick up the change — multichannel kicks in on the **next** SMB connection. Datamigrator's `MOUNT_IDLE_TIMEOUT_MS=600000` (10 min) means idle mounts will recycle and pick up the new behavior naturally.

---

## Verification

Run on the worker **while a real migration is in flight** (multichannel state is only visible when an SMB session is open):

```powershell
# Should show multiple rows per server with Selected=True
Get-SmbMultichannelConnection

# Active SMB sessions and the negotiated dialect
Get-SmbConnection

# Confirms client config landed
Get-SmbClientConfiguration | Format-List EnableMultiChannel,
                                          MaximumConnectionCountPerServer,
                                          ConnectionCountPerRssNetworkInterface,
                                          ConnectionCountPerRdmaNetworkInterface
```

What to expect:

- `Get-SmbMultichannelConnection` shows N rows per server — one per active channel.
- `Get-SmbConnection` shows the SMB dialect (`3.1.1` is best).

If `Get-SmbMultichannelConnection` shows only **one** row during a heavy migration, multichannel is not active. Jump to [Troubleshooting](#troubleshooting).

---

## Adjacent tuning that compounds the win

Multichannel parallelism only helps if you can feed it. These changes complement the script.

| Setting | Where | Why |
|---|---|---|
| `CHUNK_SIZE` 1 MB → **4 MB** | `worker.env` (`{app}\binary\.env` on Windows) | Larger I/Os exploit SMB3 large-MTU and saturate channels. |
| `UV_THREADPOOL_SIZE` 16 → **32–64** | `worker.env` | Node's libuv pool gates concurrent fs syscalls. Match it to `MAX_WRITE_CONCURRENCY`. |
| Source-side atime off | Source server (`fsutil behavior set disablelastaccess 1` / ONTAP `-atime-update false`) | Removes a metadata write per read. |
| Disable SMB signing where policy allows | Source/dest server + client | Signing halves throughput. |
| Disable encryption where policy allows | Source/dest server + client | Pre–Server 2022, encryption serializes onto a single channel. Server 2022 + AES-NI fixes this. |

See [`docs/migration-workflow.md`](../../docs/migration-workflow.md) for the full set of worker tunables.

---

## Troubleshooting

### `Get-SmbMultichannelConnection` shows only one row

Run through these in order — order is by frequency-of-cause:

1. **NIC RSS queues = 1.** Check `Get-NetAdapterRss | Select Name, NumberOfReceiveQueues`. Fix at the cloud level (Accelerated Networking / ENA / gVNIC Tier_1) — software cannot synthesize RSS queues.
2. **Server side disabled.** Run server-side check (Windows: `Get-SmbServerConfiguration | Select EnableMultiChannel`; ONTAP: `cifs options show -fields is-multichannel-enabled`). Most common miss on Azure Files / FSx where it's off by default.
3. **Existing session still open.** Multichannel applies on new sessions. Wait for `MOUNT_IDLE_TIMEOUT_MS` (10 min) or restart the worker.
4. **NIC teaming / LBFO underneath.** Tear it down or move to SET.
5. **Stateful middle-box** (firewall, LB) coalescing or pinning flows. Check with the network team.
6. **SMB encryption forced + non-AES-NI CPU.** Check `Get-SmbConnection | Select Encrypted, Dialect`.

### Script reports "Failed to snapshot prior state"

Non-fatal. The actual config changes still apply. Snapshot is a convenience for rollback only.

### Script reports "RSS not supported" on a NIC

Expected on virtual / loopback / non-physical adapters. The script skips them. Verify your **primary data-path NIC** isn't the one being skipped.

### Throughput didn't improve after enabling

Multichannel removes the single-TCP-connection bottleneck, but you're now bottlenecked on whatever is next. Common follow-ons:

- `CHUNK_SIZE` still at 1 MB — bump to 4 MB.
- `UV_THREADPOOL_SIZE=16` capping concurrent fs syscalls — bump to 32–64.
- Source/dest disk IOPS or latency.
- Worker CPU (encryption / hashing) — check Task Manager during a copy.

---

## Rollback

The script writes a JSON snapshot of the prior client config to `C:\datamigrator\logs\smb-multichannel-pre-state-<timestamp>.json`. To revert manually:

```powershell
Set-SmbClientConfiguration -EnableMultiChannel $false -Confirm:$false
Set-SmbClientConfiguration -MaximumConnectionCountPerServer 32 -Confirm:$false
Set-SmbClientConfiguration -ConnectionCountPerRssNetworkInterface 4 -Confirm:$false
Set-SmbClientConfiguration -ConnectionCountPerRdmaNetworkInterface 2 -Confirm:$false
```

NIC RSS state is left enabled — it has no negative effect when multichannel is off, and other workloads (RDP, app traffic) benefit from RSS too.

---

## References

- Microsoft — [SMB Multichannel deployment](https://learn.microsoft.com/en-us/windows-server/storage/file-server/smb-direct)
- Microsoft — [`Get-SmbMultichannelConnection`](https://learn.microsoft.com/en-us/powershell/module/smbshare/get-smbmultichannelconnection)
- NetApp ONTAP — [SMB Multichannel for higher throughput](https://docs.netapp.com/us-en/ontap/smb-admin/improve-client-response-multichannel-concept.html)
- Internal — [`docs/migration-workflow.md`](../../docs/migration-workflow.md), [`app-deployment/docs/WINDOWS-WORKER.md`](WINDOWS-WORKER.md)
