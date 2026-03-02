# NDM Upgrade Guide

This document covers the end-to-end upgrade process for NetApp Data Migrator (NDM), including the Control Plane (CP) and all connected Workers.

---

## Table of Contents

1. [Overview](#overview)
2. [Upgrade Architecture](#upgrade-architecture)
3. [Building the Upgrade Bundle (NDM Team)](#building-the-upgrade-bundle-ndm-team)
4. [Control Plane Upgrade (Customer)](#control-plane-upgrade-customer)
5. [Worker Upgrade](#worker-upgrade)
6. [Automatic Rollback](#automatic-rollback)
7. [Manual Worker Upgrade](#manual-worker-upgrade)
8. [Troubleshooting](#troubleshooting)
9. [File and Directory Reference](#file-and-directory-reference)

---

## Overview

NDM upgrades follow a two-phase approach:

1. **Control Plane upgrade** — Upload the upgrade bundle via the UI, then trigger the upgrade. An Ansible playbook runs on the host to uninstall the current Helm release, import new Docker images, install the new Helm chart, run database migrations, and verify pod readiness. If any step fails, the playbook automatically rolls back (database schema + previous Helm chart).

2. **Worker upgrade** — After the CP upgrade succeeds, the admin-service automatically distributes new worker binaries to all healthy workers (multicast) and then triggers each worker to execute its local upgrade script. Workers back up their current state, swap binaries, merge environment files, and restart the service. If the service fails to start, the worker rolls back automatically.

### Upgrade Flow Diagram

```
Upload Bundle (UI)
       │
       ▼
 Chunked Upload → Assemble → Extract → Validate Checksums → Organize
       │
       ▼
 Trigger CP Upgrade (UI)
       │
       ▼
 Check for blocking jobs (running/scheduled/active)
       │
       ▼
 Stage in DB → Launch Ansible via systemd-run (nsenter)
       │
       ▼
 Ansible Playbook on Host:
   ├── Get current version
   ├── Back up current Helm chart for rollback
   ├── Uninstall Helm release + clean namespace
   ├── Verify PVs (postgres, redis, openbao)
   ├── Import Docker images into MicroK8s
   ├── Install new Helm chart
   ├── Wait for pods to become ready
   ├── Patch JWT issuers if needed
   ├── Update versions.conf
   └── Move artifacts to /root for future rollback
       │
       ▼
 Pod restarts with new version
       │
       ▼
 admin-service onModuleInit:
   ├── Read versions.conf → detect SUCCESS
   ├── Auto-trigger worker binary multicast
   │     └── Temporal BinaryMulticastWorkflow → stream binaries to workers
   └── Auto-trigger worker upgrade execution
         └── Temporal UpgradeExecutionWorkflow → workers run upgrade script
```

---

## Upgrade Architecture

### Status Lifecycle

**Upload Status:**
```
UPLOADING → PROCESSING → SUCCESS / FAILED
                       → CANCELLED (user cancelled)
```

**Upgrade Status (Control Plane):**
```
PENDING → STAGED → SUCCESS / FAILED / ROLLED_BACK
                 → SKIPPED (user clicked Reset)
```

**Worker Aggregate Status:**
```
IDLE → IN_PROGRESS → COMPLETED
```

### Key Components

| Component | Role |
|---|---|
| `upgrade.service.ts` | Orchestrates upload, CP upgrade trigger, worker multicast, and execution |
| `upgrade-playbook.yaml` | Ansible playbook that performs the CP upgrade on the host |
| `upgrade-ansible.cfg` | Ansible configuration (log path, callbacks) |
| `upgrade.sh` | Linux worker upgrade script |
| `upgrade.ps1` | Windows worker upgrade script |
| `versions.conf` | Tracks `initial_version`, `current_version`, and `previous_version` |
| Temporal Workflows | `BinaryMulticastWorkflow` and `UpgradeExecutionWorkflow` for worker distribution |

---

## Building the Upgrade Bundle (NDM Team)

### 1. Create a release branch

Create a release branch from `main`:

```
release/<version>
```

### 2. Run the release workflow

Run the release workflow on the release branch. This uploads the Helm chart and Docker images to Artifactory. Verify the artifacts at:

```
https://generic.repo.eng.netapp.com/artifactory/openlab-generic/cicd/ndm/releases
```

### 3. Build the upgrade bundle

The upgrade bundle is a `.tar.gz` archive with the following structure:

```
upgrade-<version>/
├── checksums-<version>.sha256
├── upgrade-playbook.yaml
├── upgrade-ansible.cfg
├── docker/
│   └── datamigrator-images-<version>.tar
├── helm/
│   └── datamigrator-helmchart-<version>.tgz
└── worker/
    ├── datamigrator-worker-linux-<version>.tar.gz
    └── datamigrator-worker-windows-<version>.zip
```

The final file must be named `upgrade-<version>.tar.gz` (e.g., `upgrade-2026.02.10.tar.gz`).

The `checksums-<version>.sha256` file contains SHA-256 hashes for every file in the bundle, in standard format:

```
<sha256hash>  <relative-path-to-file>
```

### 4. Deliver to customer

Provide the `upgrade-<version>.tar.gz` file to the customer.

---

## Control Plane Upgrade (Customer)

### Prerequisites

- **Stop all jobs**: Deactivate all job configurations and ensure no jobs are running or scheduled. The upgrade will block if active jobs are detected.
- **Ensure sufficient disk space**: The bundle can be several GB. The CP needs space for the upload, extraction, and Docker image import.
- **Access to the NDM UI** with admin privileges.

### Step 1 — Upload the Bundle

1. Open the NDM UI and navigate to the **Upgrade** page.
2. Select the `upgrade-<version>.tar.gz` file.
3. The UI uploads the file in 15 MB chunks. Progress is shown in real time.
4. After all chunks are uploaded, the system automatically:
   - Assembles the chunks into the full archive
   - Extracts the archive
   - Validates all file checksums against `checksums-<version>.sha256`
   - Organizes files into the deployment structure at `/upload/<version>/`
   - Triggers worker binary multicast (distributes worker binaries to all healthy workers)

### Step 2 — Trigger the Upgrade

1. Once the upload succeeds, the UI shows the **Upgrade** button.
2. Click **Upgrade** to start the Control Plane upgrade.
3. The system:
   - Verifies no jobs are running, scheduled, or active
   - Marks the upgrade as `STAGED` in the database
   - Launches the Ansible playbook on the host via `systemd-run` (decoupled from the pod's lifecycle)
4. The Ansible playbook runs through the following steps:

| Step | Action |
|------|--------|
| 3 | Get currently deployed Helm chart version |
| 4 | Locate previous Helm chart on disk for rollback |
| 5 | Uninstall current Helm release, delete CronJobs, force-delete pods, clean namespace |
| 6 | Verify critical PVs exist (PostgreSQL, Redis, OpenBao) — **aborts if missing** |
| 7 | Import new Docker images into MicroK8s |
| 8 | Install new Helm chart, wait for pods to become ready |
| 9 | Patch JWT issuer in RequestAuthentication resources (if placeholder detected) |
| 10 | Move upgrade artifacts to `/root/` for future rollback |
| Post | Update `versions.conf` at `/opt/datamigrator/conf/` and `/upgrade/` |

5. During the upgrade, the UI will lose connectivity (pods are restarting). The UI automatically reconnects and polls for the upgrade result.

### Step 3 — Worker Upgrade (Automatic)

After the CP upgrade succeeds and pods restart:

1. The `admin-service` reads `versions.conf` on startup and detects the upgrade succeeded.
2. If worker binaries were already distributed (multicast completed), it auto-triggers **worker upgrade execution**.
3. If multicast hasn't happened yet, it auto-triggers **binary multicast** first, then execution.

The worker upgrade flow:

1. **Binary Multicast** — A Temporal `BinaryMulticastWorkflow` streams the worker binary (`.tar.gz` for Linux, `.zip` for Windows) from the CP to each healthy worker. Workers download and stage the binary.
2. **Upgrade Execution** — A Temporal `UpgradeExecutionWorkflow` signals each worker to run its local upgrade script. Workers execute the upgrade and report back.

### Step 4 — Verify

- The UI shows the upgrade status for both CP and all workers.
- Check `versions.conf` on the CP:
  ```
  initial_version=<first-ever-installed-version>
  current_version=<new-version>
  previous_version=<old-version>
  ```
- Restart any previously stopped jobs. Migrations resume from where they left off.

---

## Worker Upgrade

### How It Works

Each worker runs a local upgrade script that performs the following phases:

#### Phase 1 — Backup and Merge (service still running)

1. Create a timestamped backup directory
2. Back up the current binary, environment file, and `versions.conf`
3. Merge the new `.env` template with the current environment, preserving instance-specific keys:
   - `WORKER_ID`, `CONTROL_PLANE_IP`, `CP_BASE_URL`, `KEYCLOAK_BASE_URL`
   - `TEMPORAL_ADDRESS`, `REDIS_HOST`, `WORKER_CONFIG_URL`
   - `WORKER_JOB_SERVICE_URL`, `WORKER_REPORT_SERVICE_URL`
   - `TEMPORAL_TLS_ENABLED`, `TEMPORAL_TLS_SERVER_NAME`, `TEMPORAL_JWT_ENABLED`
   - `WORKER_SECRET`, `PROJECT_ID`, `OTEL_COLLECTOR_ENDPOINT`
   - `CLIENT_ID`, `CLIENT_SECRET`, `BASE_WORKING_PATH`, `BUILD_ID`
4. Validate the new binary exists before stopping anything

#### Phase 2 — Stop Service

5. Stop the worker service (`systemctl stop` on Linux, `Stop-Service` on Windows)
6. Wait up to 30 seconds for the process to exit
7. Back up and clear log files

#### Phase 3 — Swap (service is down — minimize this window)

8. Copy the new binary into the binary directory
9. Apply the merged environment file
10. Update `versions.conf` with the new version
11. Write the `UPGRADED` flag (read by the worker bootstrap)

#### Phase 4 — Start and Verify

12. Start the worker service
13. Wait 10 seconds for stabilization
14. If the service is running → **upgrade successful**, clean up staging directory
15. If the service is NOT running → **automatic rollback** (see below)

### File Locations

| Item | Linux | Windows |
|------|-------|---------|
| Binary | `/opt/datamigrator/binary/` | `C:\datamigrator\binary\` |
| Environment | `/opt/datamigrator/conf/worker.env` | `C:\datamigrator\binary\.env` |
| Versions | `/opt/datamigrator/conf/versions.conf` | `C:\datamigrator\conf\versions.conf` |
| Staging | `/opt/datamigrator/staging/<version>/` | `C:\datamigrator\staging\<version>\` |
| Backup | `/opt/datamigrator/backup/<version>/<timestamp>/` | `C:\datamigrator\backup\<version>\<timestamp>\` |
| Upgrade log | `/opt/datamigrator/upgrade.log` | `C:\datamigrator\upgrade.log` |
| Service name | `datamigrator-worker` (systemd) | `DatamigratorWorker` (Windows Service) |

---

## Automatic Rollback

### Control Plane Rollback

If any step in the Ansible playbook fails after the Helm uninstall (steps 7–10), the `rescue` block triggers automatic rollback:

1. **Collect diagnostics** — Gather pod logs from the failed deployment
2. **Clean up failed install** — Uninstall the failed Helm release, delete all pods and CronJobs
3. **Rollback database schema** — Run Liquibase rollback using the `db-migrations` image from the previous version, reverting to the pre-upgrade tag
4. **Reinstall previous version** — Install the old Helm chart (old Docker images are still in the MicroK8s registry since image import is additive)
5. **Verify restored versions** — Confirm all services are running with the previous version

The playbook fails with a clear message indicating the rollback result.

### Worker Rollback

If the worker service fails to start after the binary swap:

1. Restore the binary from backup
2. Restore the environment file from backup
3. Restore `versions.conf` from backup
4. Set the `UPGRADED` flag to `false`
5. Attempt to start the service with the restored files
6. If the rollback also fails, log `CRITICAL: Rollback ALSO failed — manual intervention required`

---

## Manual Worker Upgrade

If the automatic worker upgrade does not trigger (e.g., the CP upgrade succeeded but the worker multicast/execution failed), you can SSH to the worker and run the upgrade script manually.

The upgrade script and new binary must already be present in the worker's staging directory (`/opt/datamigrator/staging/<version>/` on Linux, `C:\datamigrator\staging\<version>\` on Windows).

### Linux

```bash
sudo /opt/datamigrator/staging/<version>/upgrade.sh <version>
```

Example:

```bash
sudo /opt/datamigrator/staging/2026.02.10/upgrade.sh 2026.02.10
```

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File C:\datamigrator\staging\<version>\upgrade.ps1 -Version <version>
```

Example:

```powershell
powershell -ExecutionPolicy Bypass -File C:\datamigrator\staging\2026.02.10\upgrade.ps1 -Version 2026.02.10
```

Check the upgrade log after execution:
- Linux: `/opt/datamigrator/upgrade.log`
- Windows: `C:\datamigrator\upgrade.log`

---

## Troubleshooting

### CP upgrade stuck in STAGED status

The admin-service polls `versions.conf` every 30 seconds after startup. If the Ansible playbook is still running, the status remains `STAGED`. If it stays stuck for more than 30 minutes, the system marks it as `FAILED`.

Check the Ansible log on the CP host:

```bash
cat /opt/datamigrator/logs/ndm-upgrade.log
```

Check the systemd unit status:

```bash
systemctl status ndm-upgrade
```

### Worker multicast timeout

Binary multicast has a 60-minute timeout. If workers haven't acknowledged the download within that window, remaining workers are marked as `FAILED`. You can retry multicast from the UI or manually copy the binaries to the worker's staging directory.

### Worker execution timeout

Worker upgrade execution has a 5-minute window. Workers that haven't reported back within that time are marked as `FAILED`. Check the worker's upgrade log and run the upgrade script manually if needed.

### Upload fails or is interrupted

- If the browser tab is closed during upload, the upload is marked as `FAILED`.
- Stale uploads (no activity for the calculated timeout based on file size) are automatically cleaned up.
- You can start a new upload at any time after a failed or cancelled upload.

### Critical PVs missing after uninstall

If the Ansible playbook detects that PostgreSQL, Redis, or OpenBao PVs are missing after the Helm uninstall, it aborts immediately **before** attempting the new install. This protects against data loss. Investigate the PV state before retrying.

### Rollback Helm chart not found

If the previous Helm chart `.tgz` file is not found on disk at `/root/`, the playbook warns that rollback capability is limited. Always keep previous upgrade bundles on the CP machine.

---

## File and Directory Reference

### Control Plane

| Path | Description |
|------|-------------|
| `/upload/` | Upload working directory (chunks, assembled archives, organized bundles) |
| `/upload/<version>/` | Organized bundle ready for deployment |
| `/upload/<version>/CP/docker/` | Docker image tar for MicroK8s import |
| `/upload/<version>/CP/helm/` | Helm chart `.tgz` for installation |
| `/upload/<version>/worker/linux/` | Linux worker binary (`.tar.gz`) |
| `/upload/<version>/worker/windows/` | Windows worker binary (`.zip`) |
| `/upgrade/` | Deploy path (pod-visible mount) |
| `/upgrade/<version>/` | Staged bundle for Ansible |
| `/upgrade/versions.conf` | Version tracking file (pod-visible) |
| `/opt/datamigrator/conf/versions.conf` | Version tracking file (host) |
| `/opt/datamigrator/logs/ndm-upgrade.log` | Ansible playbook log |

### Worker (Linux)

| Path | Description |
|------|-------------|
| `/opt/datamigrator/binary/` | Active worker binary |
| `/opt/datamigrator/conf/worker.env` | Worker environment configuration |
| `/opt/datamigrator/conf/versions.conf` | Version tracking |
| `/opt/datamigrator/conf/UPGRADED` | Flag file (`true`/`false`) read by bootstrap |
| `/opt/datamigrator/staging/<version>/` | Staged upgrade files (binary, env template, upgrade script) |
| `/opt/datamigrator/backup/<version>/<timestamp>/` | Backup of previous binary, env, versions, and logs |
| `/opt/datamigrator/backup/latest` | Pointer to the most recent backup directory |
| `/opt/datamigrator/upgrade.log` | Upgrade script log |

### Worker (Windows)

| Path | Description |
|------|-------------|
| `C:\datamigrator\binary\` | Active worker binary and `.env` |
| `C:\datamigrator\conf\versions.conf` | Version tracking |
| `C:\datamigrator\conf\UPGRADED` | Flag file read by bootstrap |
| `C:\datamigrator\staging\<version>\` | Staged upgrade files |
| `C:\datamigrator\backup\<version>\<timestamp>\` | Backup of previous state |
| `C:\datamigrator\backup\latest` | Pointer to the most recent backup directory |
| `C:\datamigrator\upgrade.log` | Upgrade script log |
