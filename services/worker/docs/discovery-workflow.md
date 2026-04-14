# Discovery Workflow - Worker Service

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [End-to-End Flow](#end-to-end-flow)
4. [Phase 1: Worker Registration & Bootstrap](#phase-1-worker-registration--bootstrap)
5. [Phase 2: Worker Setup](#phase-2-worker-setup)
6. [Phase 3: Redis Memory Validation](#phase-3-redis-memory-validation)
7. [Phase 4: Core Discovery Scanning](#phase-4-core-discovery-scanning)
8. [Phase 5: Directory Scanning Deep Dive](#phase-5-directory-scanning-deep-dive)
9. [Phase 6: Reporting](#phase-6-reporting)
10. [Phase 7: Cleanup](#phase-7-cleanup)
11. [Data Flow & Redis Architecture](#data-flow--redis-architecture)
12. [Task Queue Architecture](#task-queue-architecture)
13. [Error Handling & Retry Strategy](#error-handling--retry-strategy)
14. [Exclusion & Filtering Logic](#exclusion--filtering-logic)
15. [Pause / Stop / Resume Signals](#pause--stop--resume-signals)
16. [Configuration Reference](#configuration-reference)
17. [Working Examples](#working-examples)
18. [Troubleshooting](#troubleshooting)

---

## Overview

The Discovery Workflow is a distributed file system scanning system built on top of **Temporal** (workflow orchestration) and **Redis** (state management & streaming). Its purpose is to recursively discover files and directories on a source path, collect their metadata (size, permissions, timestamps, type), and publish the inventory to Redis streams for downstream consumption (e.g., migration, reporting).

Key design goals:

- **Parallelism** — scan multiple directory batches concurrently across multiple workers
- **Memory efficiency** — stream directory entries with `opendir()` (O(1) per entry), batch subdirectories into Redis
- **Fault tolerance** — retry failed scans, heartbeat to prevent timeouts, `continueAsNew` to avoid unbounded workflow history
- **Controllability** — pause, resume, and stop scanning at any point via Temporal signals

---

## Architecture

### High-Level System Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            CONTROL PLANE                                     │
│                                                                              │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │ Config       │   │ Job          │   │ Report       │   │ Keycloak     │  │
│  │ Service      │   │ Service      │   │ Service      │   │ (Auth)       │  │
│  │ :3002        │   │ :3006        │   │ :3003        │   │              │  │
│  └──────┬───────┘   └──────────────┘   └──────┬───────┘   └──────┬───────┘  │
│         │                                      │                  │          │
└─────────┼──────────────────────────────────────┼──────────────────┼──────────┘
          │  REST/HTTPS                          │                  │
          │                                      │                  │
┌─────────┼──────────────────────────────────────┼──────────────────┼──────────┐
│         ▼                                      ▼                  ▼          │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                       WORKER SERVICE (NestJS)                          │ │
│  │                                                                         │ │
│  │  ┌──────────────┐     ┌─────────────────────────────────────────────┐  │ │
│  │  │ WorkManager   │────▶│           Temporal Workers                  │  │ │
│  │  │ Service       │     │                                             │  │ │
│  │  │ (Polls config │     │  ┌──────────┐  ┌──────────┐  ┌──────────┐ │  │ │
│  │  │  every 10s)   │     │  │ Parent   │  │ Worker-  │  │ Job-     │ │  │ │
│  │  └──────────────┘     │  │ Workflow │  │ Specific │  │ Specific │ │  │ │
│  │                        │  │ Worker   │  │ Worker   │  │ Worker   │ │  │ │
│  │                        │  └──────────┘  └──────────┘  └──────────┘ │  │ │
│  │                        └─────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────┐         ┌─────────────────────────────────────────────┐  │
│  │ Temporal Server │◀───────▶│                  Redis                      │  │
│  │ (gRPC :7233)   │         │  (State, Streams, Job Context, Batches)    │  │
│  └────────────────┘         └─────────────────────────────────────────────┘  │
│                                                                              │
│                          WORKER NODE                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Workflow Hierarchy

```
DiscoveryWorkflow (Parent)                         ← ParentWorkflow-TaskQueue
│
├── SetupWorkerWorkflow (per worker)               ← {workerId}-TaskQueue
│
├── RedisMemoryCheckWorkflow                       ← default TaskQueue
│
├── executeDiscoveryChildWorkflows                 ← inline (same workflow)
│   │
│   └── ChildScanWorkflow                          ← {jobRunId}-TaskQueue
│       │
│       ├── createInitialDirBatch (activity)
│       │
│       └── [loop] executeBatchScan
│           │
│           └── scanDirectories (activity)         ← actual FS scanning
│               │
│               └── DiscoveryScanService.scanDirectory()
│
├── handleReporting
│   │
│   └── GenerateDiscoveryReportWorkflow            ← reports-TaskQueue
│
└── executeCleanup
    │
    └── CleanupWorkerWorkflow (per worker)         ← {workerId}-TaskQueue
```

---

## End-to-End Flow

Below is the complete lifecycle of a single discovery job from trigger to completion.

```
                    ┌─────────────────────┐
                    │   Control Plane      │
                    │   submits job with   │
                    │   traceId + workers  │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  1. Worker Setup     │
                    │  (per worker node)   │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │  2. Redis Memory     │
                    │     Validation       │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │  3. Start Child      │
                    │  Scan Workflow       │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
        ┌───────────┐  ┌───────────┐  ┌───────────┐
        │  Batch 1  │  │  Batch 2  │  │  Batch N  │
        │  Scan     │  │  Scan     │  │  Scan     │
        └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
              │               │               │
              └───────┬───────┘───────┬───────┘
                      │               │
                      ▼               ▼
              ┌───────────┐  ┌───────────────┐
              │  New sub-  │  │  Aggregate    │
              │  directory │  │  file/dir     │
              │  batches   │  │  counts       │
              └─────┬──────┘  └───────────────┘
                    │
                    ▼
            (repeat until no
             more sub-dirs)
                    │
                    ▼
          ┌─────────────────────┐
          │  4. Reporting       │
          │  (wait for signal,  │
          │   generate report)  │
          └─────────┬───────────┘
                    │
          ┌─────────▼───────────┐
          │  5. Cleanup         │
          │  (per worker +      │
          │   Redis context)    │
          └─────────────────────┘
```

**Source**: `discovery-parent-workflow.ts`

```typescript
// Simplified orchestration (actual source)
export const DiscoveryWorkflow = async ({ traceId, payload, options }) => {
  // Phase 1: Setup workers
  const setup = await executeWorkerSetup({ jobRunId: traceId, workerIds: payload.workers, options });

  // Phase 2: Ensure Redis has capacity
  await waitUntilRedisMemoryOk(traceId);

  // Phase 3: Run the scan
  const result = await executeDiscoveryChildWorkflows({ jobRunId: traceId });

  // Phase 4: Report
  await handleReporting(traceId, result.status, {
    excludedPaths: result.excludedPaths,
    skippedPaths: result.skippedPaths,
  });

  // Phase 5: Clean up
  await executeCleanup({ jobRunId: traceId, workerIds: setup.setupCompletedWorkers, options });

  return { traceId, ...setup, ...result };
};
```

---

## Phase 1: Worker Registration & Bootstrap

Before any discovery job starts, the worker service itself must register with the control plane and establish connectivity.

### Bootstrap Sequence

**Source**: `work-manager.service.ts` — `onApplicationBootstrap()`

```
Worker Service Starts
       │
       ▼
┌──────────────────┐
│ Load worker       │   Read current_version from versions.conf
│ version           │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Check UPGRADED    │   If post-upgrade boot, send ACK to Control Plane
│ flag              │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────┐
│ Register with Config Service │   POST {WORKER_CONFIG_URL}/api/v1/work-manager/config
│                              │   Body: { envVariables, isRebootCall: true, workerVersion }
│                              │   Headers: Authorization, x-client-platform, x-worker-ip
│                              │
│ Receives:                    │   - CA certificate for TLS
│                              │   - Updated env variables
│                              │   - JWT tokens
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ Build Temporal Config        │   Address, TLS settings, JWT auth
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ Create Temporal Connections  │   NativeConnection (for workers)
│                              │   ClientConnection (for workflow ops)
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ Schedule JWT Refresh         │   Interval: JWT_REFRESH_INTERVAL_MINUTES (default 1380 min / 23h)
└──────────────────────────────┘
```

### Configuration Polling (Every 10 Seconds)

After bootstrap, the `WorkManagerService` polls the config service every 10 seconds to dynamically manage Temporal workers.

**Source**: `work-manager.service.ts` — `handleCron()`

```
Every 10 seconds
       │
       ▼
┌──────────────────────────────────────────┐
│ GET /api/v1/work-manager/config          │
│ Headers: Authorization, x-client-platform│
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ Response contains metaConfig[]           │
│                                          │
│ Each WorkerConfiguration:                │
│   - workerId: string                     │
│   - configName: PARENT_WORKFLOW          │
│                 | WORKER_SPECIFIC_WORKFLOW│
│                 | JOB_SPECIFIC_WORKFLOW   │
│   - taskQueueId: string                  │
│   - dynamicTaskQueue: boolean            │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ handleConfigurations(configs)            │
│                                          │
│ 1. Compute which workers to START        │
│    (configs not in activeWorkers map)    │
│                                          │
│ 2. Compute which workers to STOP         │
│    (activeWorkers not in new configs)    │
│                                          │
│ 3. Create WorkFlowOptions per config     │
│    (binds activities to service methods) │
│                                          │
│ 4. Call Worker.create() + worker.run()   │
└──────────────────────────────────────────┘
```

### Worker Types & Task Queues

| Type | Task Queue | Purpose |
|------|-----------|---------|
| `PARENT_WORKFLOW` | `ParentWorkflow-TaskQueue` | Runs top-level orchestration workflows (Discovery, Migration) |
| `WORKER_SPECIFIC_WORKFLOW` | `{workerId}-TaskQueue` | Worker-level operations (setup, cleanup, speed test, validation) |
| `JOB_SPECIFIC_WORKFLOW` | `{taskQueueId}-TaskQueue` (dynamic) | Job-scoped scan/sync activities with configurable concurrency |

---

## Phase 2: Worker Setup

**Source**: `execute-setup-workflow.ts`

When a discovery job is triggered, the parent workflow first ensures all designated worker nodes are ready.

```
DiscoveryWorkflow
       │
       ▼
executeWorkerSetup({ jobRunId, workerIds: ["worker-A", "worker-B"] })
       │
       ├──▶ startChild('SetupWorkerWorkflow', {
       │      taskQueue: 'worker-A-TaskQueue',
       │      workflowId: 'SetupWorkerWorkflow-{jobRunId}-worker-A'
       │    })
       │
       └──▶ startChild('SetupWorkerWorkflow', {
              taskQueue: 'worker-B-TaskQueue',
              workflowId: 'SetupWorkerWorkflow-{jobRunId}-worker-B'
            })
       │
       ▼
┌──────────────────────────────────────┐
│ Wait until:                          │
│   - At least 1 worker succeeds, OR  │
│   - ALL workers fail                 │
│                                      │
│ wf.condition(() =>                   │
│   setupCompletedWorkers.length > 0   │
│   || failedWorkers.length === total) │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ If ALL failed:                       │
│   → updateJobErrorStatus()           │
│   → throw NonRetryable error         │
│                                      │
│ Otherwise:                           │
│   → return { setupCompletedWorkers,  │
│              failedWorkers }         │
└──────────────────────────────────────┘
```

**Key behavior**: The workflow does NOT wait for all workers to succeed. As soon as **one** worker succeeds, it can proceed. Failed workers are recorded but don't block the job.

**Error enrichment**: Connection errors (ECONNRESET, ETIMEDOUT) get human-readable messages before being reported.

---

## Phase 3: Redis Memory Validation

**Source**: `memory-utils.ts`

Before starting the scan, the workflow checks that Redis has enough memory capacity. This prevents out-of-memory conditions when publishing large volumes of file metadata.

```typescript
export const waitUntilRedisMemoryOk = async (traceId): Promise<void> => {
  const redisChild = await wf.startChild('RedisMemoryCheckWorkflow', {
    args: [],
    workflowId: `RedisMemoryCheckWorkflow-${traceId}`,
  });
  await redisChild.result();  // Blocks until memory is below threshold
};
```

The `RedisMemoryCheckWorkflow` invokes the `checkMemoryUsage` activity, which compares current Redis memory usage against the configured threshold (default **90%**, via `REDIS_MEM_USAGE_THRESHOLD`).

---

## Phase 4: Core Discovery Scanning

### Launching the Child Scan Workflow

**Source**: `execute-discover-child-workflows.ts`

```
executeDiscoveryChildWorkflows({ jobRunId })
       │
       ▼
┌──────────────────────────────────────────────────┐
│ Register action signal handler                    │
│                                                    │
│ wf.setHandler(actionSignal, (action) => {         │
│   if (action === 'Stopped')                       │
│     → cancel child scan workflow                  │
│   else                                            │
│     → forward signal to child scan workflow       │
│ })                                                │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│ Start ChildScanWorkflow as child                  │
│                                                    │
│ wf.startChild('ChildScanWorkflow', {              │
│   args: [{ jobRunId, isMigration: false }],       │
│   workflowId: `ScanWorkflow-${jobRunId}`,         │
│   taskQueue: `${jobRunId}-TaskQueue`,             │
│ })                                                │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│ Await result                                      │
│                                                    │
│ On success: return { fileCount, dirCount, status } │
│ On cancel:  status = Stopped                      │
│ On error:   status = Failed                       │
│             → updateWorkerResponse with error      │
└──────────────────────────────────────────────────┘
```

### The ChildScanWorkflow (Core Scanning Loop)

**Source**: `child-scan.workflow.ts`

This is the heart of the discovery system. It implements a recursive, batched directory scanning loop.

```
ChildScanWorkflow({ jobRunId, dirsToScan: ['/'], batchSize: 100 })
       │
       ▼
┌─────────────────────────────┐
│ Update job status: RUNNING  │
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ Create initial directory batch           │
│                                          │
│ createInitialDirBatchActivity({          │
│   dirsToScan: ['/'],                    │
│   jobRunId                              │
│ })                                      │
│ → Returns batchId (hash of directory    │
│   list), stores batch in Redis          │
└────────────┬────────────────────────────┘
             │
             ▼
      ┌──────────────┐
      │ SCAN LOOP    │◀──────────────────────────────────┐
      └──────┬───────┘                                    │
             │                                            │
             ▼                                            │
   ┌─────────────────────┐                               │
   │ Check action state   │                               │
   │                      │                               │
   │ Stopped? → break     │                               │
   │ Paused?  → wait      │                               │
   └─────────┬────────────┘                               │
             │                                            │
             ▼                                            │
   ┌──────────────────────────────────────────────┐      │
   │ executeBatchScan({ batches: dirBatchIds })    │      │
   │                                               │      │
   │ Process up to MAX_CONCURRENT_BATCHES (20)     │      │
   │ batches in parallel using Promise.all()       │      │
   │                                               │      │
   │ Each batch → scanDirectories() activity       │      │
   │                                               │      │
   │ Returns:                                      │      │
   │   fileCount, dirCount                         │      │
   │   batchDirs[] ← NEW subdirectory batches      │      │
   └─────────┬─────────────────────────────────────┘      │
             │                                            │
             ▼                                            │
   ┌──────────────────────────┐                          │
   │ dirBatchIds = new batches │──── not empty? ──────────┘
   └─────────┬────────────────┘
             │ empty
             ▼
   ┌──────────────────────────────────┐
   │ Check iterations > 1000?         │
   │                                   │
   │ YES → continueAsNew()            │
   │   (prevents workflow history      │
   │    from growing unbounded)        │
   │                                   │
   │ NO  → return results              │
   └──────────────────────────────────┘
```

### Batch Execution Detail

```
executeBatchScan({ batches: [batchId1, batchId2, ..., batchIdN] })
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Process batches in chunks of MAX_CONCURRENT_BATCHES (20) │
│                                                           │
│ for (i = 0; i < batches.length; i += 20) {               │
│   batchSlice = batches.slice(i, i + 20)                  │
│                                                           │
│   Promise.all(                                           │
│     batchSlice.map(batchId =>                            │
│       scanDirectories({ batchSize, jobRunId, batchId })  │
│     )                                                    │
│   )                                                      │
│ }                                                        │
│                                                           │
│ Aggregate: fileCount, dirCount, new batchDirs            │
└──────────────────────────────────────────────────────────┘
```

---

## Phase 5: Directory Scanning Deep Dive

### ScanService.scanDirectories() — The Activity

**Source**: `scan-activity.service.ts`

This is the Temporal activity that bridges workflows to actual filesystem operations.

```
scanDirectories({ jobRunId, isMigration: false, batchSize, batchId })
       │
       ▼
┌──────────────────────────────────────┐
│ Start heartbeat (every 2 seconds)    │  ← Prevents Temporal timeout
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│ Get job context from Redis           │
│ jobContext = redisService             │
│   .getJobManagerContext(jobRunId)     │
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│ Build or retrieve scan task          │
│                                      │
│ Task contains:                       │
│   - id (hash)                        │
│   - sPathId (source path ID)         │
│   - tPathId (target path ID)         │
│   - commands[] (directories to scan) │
│   - status: RUNNING                  │
│   - retryCount                       │
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────┐
│ Execute task: scan directories in parallel        │
│                                                    │
│ for commands in chunks of maxConcurrency (100):    │
│   Promise.allSettled(                             │
│     chunk.map(cmd =>                              │
│       discoveryScanService.scanDirectory(cmd)     │
│     )                                             │
│   )                                               │
└────────────┬─────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│ Batch subdirectories                 │
│                                      │
│ Group subDirs into batches of        │
│ batchSize (default 100)              │
│ Store each batch in Redis with       │
│ hash-based batchId                   │
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│ Report task status                   │
│                                      │
│ No errors:  COMPLETED → delete task  │
│ Fatal err:  delete + throw           │
│ Retryable:  throw RetryableError     │
│ Max retries: publish to error stream │
└──────────────────────────────────────┘
```

### DiscoveryScanService.scanDirectory() — The Filesystem Scanner

**Source**: `discovery-scan.service.ts`

This is the lowest-level component that actually reads the filesystem.

```
scanDirectory({ jobContext, sourcePath, sourcePrefix, command, settings })
       │
       ▼
┌──────────────────────────────────────────┐
│ Verify source path exists                │
│ if (!exists) throw FatalError            │
└────────────┬─────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Open directory with streaming: fs.promises.opendir()         │
│                                                               │
│ for await (const item of dir) {                              │
│                                                               │
│   ┌───────────────────────────────────────────────────────┐  │
│   │ 1. EXCLUDE/SKIP CHECK                                 │  │
│   │    shouldExcludeOrSkip({                              │  │
│   │      fullPath, stats,                                 │  │
│   │      excludePatterns,                                 │  │
│   │      skipTime,                                        │  │
│   │      olderThan                                        │  │
│   │    })                                                 │  │
│   │    → If excluded, skip this item                      │  │
│   └───────────────────────────────────────────────────────┘  │
│                                                               │
│   ┌───────────────────────────────────────────────────────┐  │
│   │ 2. DETECT FILE TYPE                                    │  │
│   │    fileTypeDetectionService.detectFileType()           │  │
│   │    → FILE, DIRECTORY, SYMBOLIC_LINK, SOCKET,          │  │
│   │      FIFO, CHARACTER_DEVICE, BLOCK_DEVICE,            │  │
│   │      VOLUME_MOUNT_POINT, STREAM, UNKNOWN              │  │
│   └───────────────────────────────────────────────────────┘  │
│                                                               │
│   ┌───────────────────────────────────────────────────────┐  │
│   │ 3. PUBLISH TO FILE STREAM                             │  │
│   │    jobContext.publishToFileStream(itemInfo)            │  │
│   │                                                        │  │
│   │    ItemInfo contains:                                  │  │
│   │      - relativePath                                   │  │
│   │      - isDirectory, isSymbolicLink                    │  │
│   │      - depth (computed from path segments)            │  │
│   │      - extension                                      │  │
│   │      - fileType                                       │  │
│   │      - sourceMeta { accessTime, birthTime,            │  │
│   │                     modifiedTime, permission }        │  │
│   │      - fileSize                                       │  │
│   │      - inode number (stats.ino)                       │  │
│   └───────────────────────────────────────────────────────┘  │
│                                                               │
│   ┌───────────────────────────────────────────────────────┐  │
│   │ 4. WINDOWS ADS DETECTION (if shouldScanADS)           │  │
│   │    winOperationService.detectADSInfo()                 │  │
│   │    → Publishes each ADS stream as separate ItemInfo   │  │
│   └───────────────────────────────────────────────────────┘  │
│                                                               │
│   ┌───────────────────────────────────────────────────────┐  │
│   │ 5. IF DIRECTORY:                                       │  │
│   │    - Skip if symbolic link                            │  │
│   │    - Skip if volume mount point                       │  │
│   │    - SMB: check case-sensitive conflicts              │  │
│   │    - Add to subDirs[] for recursive scanning          │  │
│   │                                                        │  │
│   │ IF FILE:                                               │  │
│   │    - Increment fileCount                              │  │
│   └───────────────────────────────────────────────────────┘  │
│                                                               │
│ }  // end for-await loop                                     │
└──────────────────────────────────────────────────────────────┘
```

---

## Phase 6: Reporting

**Source**: `handle-reporting.ts`

After scanning completes, the workflow enters a reporting phase that uses a **signal-based gate** pattern.

```
handleReporting(traceId, status, { excludedPaths, skippedPaths })
       │
       ▼
┌──────────────────────────────────────────┐
│ Register signal handler: 'reportingSignal'│
│                                           │
│ Supported report types:                   │
│   DISCOVER_REPORTED                       │
│   MIGRATE_REPORTED                        │
│   CUT_OVER_REPORTED                       │
│   RETRY_REPORTED                          │
│   DB_WRITER_FAILURE_REPORTED              │
└────────────┬─────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│ Wait for signal                          │
│                                           │
│ await wf.condition(() => !isBlocked)     │
│                                           │
│ (External system sends signal when        │
│  ready for report generation)             │
└────────────┬─────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│ 1. Save excluded/skipped entries         │
│    addExcludedSkippedEntriesActivity()   │
│                                           │
│ 2. Update job status                     │
│    updateStatusActivity()                │
│                                           │
│ 3. Generate discovery report             │
│    → Start GenerateDiscoveryReportWorkflow│
│      on 'reports-TaskQueue'              │
└──────────────────────────────────────────┘
```

---

## Phase 7: Cleanup

**Source**: `execute-cleanup-workflow.ts`

```
executeCleanup({ jobRunId, workerIds })
       │
       ├──▶ CleanupWorkerWorkflow (worker-A)    ← worker-A-TaskQueue
       │
       ├──▶ CleanupWorkerWorkflow (worker-B)    ← worker-B-TaskQueue
       │
       └──▶ (all in parallel via Promise.allSettled)
             │
             ▼
┌──────────────────────────────────────────┐
│ cleanupJobContextActivity(jobRunId)      │
│                                           │
│ Cleans up Redis entries:                  │
│   - Job context                          │
│   - Batch directories                    │
│   - Task records                         │
│   - Stream entries                       │
└──────────────────────────────────────────┘
```

---

## Data Flow & Redis Architecture

Redis is the central state store. Here's how data flows through it during discovery.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           REDIS                                         │
│                                                                         │
│  ┌──────────────────────────┐    ┌──────────────────────────────────┐  │
│  │ JobManagerContext         │    │ File Stream                      │  │
│  │                           │    │                                  │  │
│  │ jobRunId                  │    │ Published by: scanDirectory()    │  │
│  │ jobConfig:                │    │                                  │  │
│  │   sourceDirectoryPath     │    │ Each entry = ItemInfo:           │  │
│  │   destinationDirectoryPath│    │   relativePath                   │  │
│  │   options:                │    │   isDirectory                    │  │
│  │     excludePatterns[]     │    │   fileType                       │  │
│  │     excludeOlderThan      │    │   sourceMeta { atime, mtime,    │  │
│  │     shouldScanADS         │    │     birthtime, permission }      │  │
│  │     jobType               │    │   fileSize                       │  │
│  └──────────────────────────┘    │   inode                          │  │
│                                   └──────────────────────────────────┘  │
│  ┌──────────────────────────┐    ┌──────────────────────────────────┐  │
│  │ Tasks                     │    │ Error Stream                     │  │
│  │                           │    │                                  │  │
│  │ key: activityId (hash)    │    │ Published by: error handlers     │  │
│  │ value:                    │    │                                  │  │
│  │   id, sPathId, tPathId   │    │ Each entry = DmError:            │  │
│  │   commands[] (dirs)       │    │   origin (SOURCE/DEST)           │  │
│  │   status (RUNNING/DONE)   │    │   operation (READ_DIR/...)       │  │
│  │   retryCount              │    │   errorType                      │  │
│  │   workerId                │    │   commandId                      │  │
│  └──────────────────────────┘    │   details { name, path }         │  │
│                                   └──────────────────────────────────┘  │
│  ┌──────────────────────────┐    ┌──────────────────────────────────┐  │
│  │ Batch Directories         │    │ Task Stream                      │  │
│  │                           │    │                                  │  │
│  │ key: hash(dirList)        │    │ Published by: scan activity      │  │
│  │ value: string[]           │    │                                  │  │
│  │   (directory paths in     │    │ Task status updates:             │  │
│  │    this batch)            │    │   RUNNING → COMPLETED / ERRORED  │  │
│  └──────────────────────────┘    └──────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Subdirectory Batching Strategy

When a directory scan finds subdirectories, they're grouped into batches and stored in Redis:

```typescript
// From scan-activity.service.ts — batchSubDirs()
async batchSubDirs({ batchSize, subDirs, jobContext }) {
  const batchDirsId = [];

  while (subDirs.length > batchSize) {              // Default batchSize = 100
    const batchDirs = subDirs.splice(0, batchSize);
    const batchId = calculateHash(batchDirs);       // Deterministic hash of dir list
    batchDirsId.push(batchId);
    await jobContext.setBatchDir(batchId, batchDirs);  // Store in Redis
  }

  if (subDirs.length > 0) {                         // Remaining dirs
    const batchId = calculateHash(subDirs);
    batchDirsId.push(batchId);
    await jobContext.setBatchDir(batchId, subDirs);
  }

  return { subDirs: [], batchDirs: batchDirsId };
}
```

**Example**: Scanning `/data` finds 350 subdirectories:

```
subDirs = ["/data/a", "/data/b", ..., "/data/zz"]  (350 items)

Batch 1: batchId = hash(dirs[0..99])    → 100 dirs stored in Redis
Batch 2: batchId = hash(dirs[100..199]) → 100 dirs stored in Redis
Batch 3: batchId = hash(dirs[200..299]) → 100 dirs stored in Redis
Batch 4: batchId = hash(dirs[300..349]) →  50 dirs stored in Redis

Returns: batchDirs = [batchId1, batchId2, batchId3, batchId4]
```

These batch IDs feed back into the scan loop for the next iteration.

---

## Task Queue Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                       TEMPORAL SERVER                                 │
│                                                                       │
│  ┌─────────────────────────┐                                         │
│  │ ParentWorkflow-TaskQueue │ ← DiscoveryWorkflow, handleReporting   │
│  └─────────────────────────┘                                         │
│                                                                       │
│  ┌─────────────────────────┐                                         │
│  │ {workerId}-TaskQueue     │ ← SetupWorkerWorkflow,                 │
│  │                          │   CleanupWorkerWorkflow,               │
│  │  e.g. worker-A-TaskQueue │   ValidateConnection, etc.            │
│  └─────────────────────────┘                                         │
│                                                                       │
│  ┌─────────────────────────┐                                         │
│  │ {jobRunId}-TaskQueue     │ ← ChildScanWorkflow,                   │
│  │                          │   scanDirectories activity,            │
│  │  (dynamic, per job)      │   createInitialDirBatch activity       │
│  └─────────────────────────┘                                         │
│                                                                       │
│  ┌─────────────────────────┐                                         │
│  │ reports-TaskQueue        │ ← GenerateDiscoveryReportWorkflow      │
│  └─────────────────────────┘                                         │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Error Handling & Retry Strategy

### Activity-Level Retries (Temporal)

| Activity | Max Attempts | Initial Interval | Backoff | Timeout | Non-Retryable Errors |
|----------|-------------|------------------|---------|---------|---------------------|
| `scanDirectories` | 3 | 10s | 2.0x | 96h | `ActivityFailure`, `FatalError`, `CancelledFailure` |
| `updateStatus` | 3 | 30s | 1.0x | 24h | — |
| `createInitialDirBatch` | default | default | default | 10m | — |
| `generateReport` | 3 | 30s | 1.0x | 10m | — |

### Application-Level Error Classification

```
Error occurs during directory scan
       │
       ├── FatalError (e.g. source path doesn't exist)
       │     → Publish to error stream
       │     → Delete task from Redis
       │     → Throw (no retry)
       │
       ├── Source Fatal Error (isSourceFatalError)
       │     → Delete task from Redis
       │     → Throw FatalError
       │
       ├── Retryable Error (retryCount < maxRetryCount)
       │     → errorType = RECOVERABLE_ERROR
       │     → Throw RetryableError
       │     → Temporal retries the activity
       │
       └── Retry Exceeded (retryCount >= maxRetryCount)
             → errorType = TRANSIENT_ERROR
             → Publish to error stream
             → Delete task from Redis
             → Return (don't throw — scan continues)
```

### Worker Startup Retry

```
Worker.create() fails with overlapping registration error
       │
       ▼
Retry up to 3 times with exponential backoff:
  Attempt 1: delay = 2000ms * 2^0 + random(0-1000)ms = ~2-3s
  Attempt 2: delay = 2000ms * 2^1 + random(0-1000)ms = ~4-5s
  Attempt 3: delay = 2000ms * 2^2 + random(0-1000)ms = ~8-9s
```

---

## Exclusion & Filtering Logic

**Source**: `utils.ts`

Three independent filters are applied to every discovered item. If any returns `true`, the item is skipped.

```
┌─────────────────────────────────────────────────────────────────┐
│                  shouldExcludeOrSkip()                           │
│                                                                 │
│  Item path ──▶ shouldExclude(path, patterns)                    │
│                  │                                               │
│                  ├─ Direct segment match:                        │
│                  │    path.split('/').includes(pattern)          │
│                  │    e.g. pattern="node_modules" matches        │
│                  │    /data/node_modules/foo                     │
│                  │                                               │
│                  └─ Regex match:                                 │
│                       regex.test(normalizedPath)                │
│                                                                 │
│  Item stats ──▶ shouldSkipFile(stats, skipTime, jobType)        │
│                  │                                               │
│                  │ Only for MIGRATE jobs (not DISCOVER)          │
│                  │ skipTime format: "5-M", "2-H", "1-D"         │
│                  │ Skips if file modified within the window      │
│                  │                                               │
│                  │ "5-M" → skip if modified < 5 minutes ago     │
│                  │ "2-H" → skip if modified < 2 hours ago       │
│                  │ "1-D" → skip if modified < 1 day ago         │
│                                                                 │
│  Item stats ──▶ shouldExcludeOlderThan(stats, olderThan)        │
│                  │                                               │
│                  │ Excludes if mtime < olderThan date           │
│                  │ (job config: options.excludeOlderThan)       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### SMB Case-Sensitivity Conflict Detection

On Windows (SMB shares), two directories with names differing only in case (e.g., `Data` vs `data`) cause conflicts. The scanner detects this:

```typescript
// Maintains a Set of lowercased names seen so far
const lowerCaseSourceDirs = new Set<string>();

// For each directory item on SMB:
const lowerCaseName = item.name.toLowerCase();
if (lowerCaseSourceDirs.has(lowerCaseName)) {
  // → Publish error: "Another directory with same name but different case exists"
  // → Skip this directory
}
lowerCaseSourceDirs.add(lowerCaseName);
```

---

## Pause / Stop / Resume Signals

The discovery workflow supports runtime control via Temporal signals.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Signal Flow                                    │
│                                                                       │
│  External System                                                      │
│       │                                                               │
│       │ signal('action', 'Paused')                                   │
│       ▼                                                               │
│  DiscoveryWorkflow (Parent)                                          │
│       │                                                               │
│       │ forward signal to child                                       │
│       ▼                                                               │
│  executeDiscoveryChildWorkflows                                       │
│       │                                                               │
│       │ scanWorkflow.signal('scanActionSignal', action)               │
│       ▼                                                               │
│  ChildScanWorkflow                                                    │
│       │                                                               │
│       │ actionState = 'Paused'                                       │
│       │                                                               │
│       │ await wf.condition(() => actionState !== 'Paused')           │
│       │ ─── BLOCKS HERE until Resume signal arrives ───              │
│       │                                                               │
│       │ On 'Stopped': break out of scan loop                        │
│       │ On 'Running': continue scanning                              │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

| Signal | Behavior |
|--------|----------|
| `Running` | Resume scanning (default state) |
| `Paused` | Pause at next loop iteration; job status updated |
| `Stopped` | Cancel the child scan workflow; mark job as Stopped |

---

## Configuration Reference

All configuration is loaded from environment variables via `app.config.ts`.

### Core Scan Settings

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `MAX_COMMAND_CONCURRENCY` | 100 | Max directories scanned in parallel per task |
| `MAX_OPERATION_RETRY` | 3 | Max retry count before marking a task as failed |
| `COMMANDS_IN_TASK` | 100 | Number of directory commands grouped per task |
| `DIR_STREAM_BATCH_SIZE` | 5000 | Items per Redis stream publish batch |
| `MAX_SCAN_COMMAND` | 500 | Max scan commands |

### Redis & Temporal

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `REDIS_MEM_USAGE_THRESHOLD` | 90 | Max Redis memory % before pausing scan |
| `TEMPORAL_ADDRESS` | localhost:7233 | Temporal server gRPC address |
| `JOB_TASK_ACTIVITY_CONCURRENCY` | 1 | Max concurrent activity executions per job worker |
| `MAX_ACTIVITY_TASK_POLLERS` | auto (25% of concurrency) | Temporal activity pollers |
| `WORKER_STARTUP_TIMEOUT` | 2000 | ms to wait for worker to reach RUNNING state |
| `JWT_REFRESH_INTERVAL_MINUTES` | 1380 (23h) | How often to refresh Temporal JWT |

### Worker Identity

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `WORKER_ID` | UUID | Unique identifier for this worker node |
| `WORKER_CONFIG_URL` | http://localhost:3002 | Config service URL for registration |
| `WORKER_REPORT_SERVICE_URL` | http://localhost:3003 | Report service URL |
| `WORKER_JOB_SERVICE_URL` | http://localhost:3006 | Job service URL |

### Workflow Constants (Hardcoded for Temporal Determinism)

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_CONCURRENT_BATCHES` | 20 | Max batch activities run in parallel |
| `ITERATIONS_LIMIT` | 1000 | Max scan loop iterations before `continueAsNew` |
| `DEFAULT_BATCH_SIZE` | 100 | Directories per batch |
| `CMD_LENGTH_VALIDATION_ITERATIONS` | 10 | Iterations reserved for stream validation |

---

## Working Examples

### Example 1: Simple Discovery of a Small Directory Tree

**Input**:

```
Source path: /mnt/nfs/project
Structure:
  /mnt/nfs/project/
  ├── README.md           (4 KB)
  ├── src/
  │   ├── index.ts        (2 KB)
  │   └── utils.ts        (1 KB)
  └── docs/
      └── guide.md        (8 KB)
```

**Workflow Execution**:

```
1. DiscoveryWorkflow triggered with:
   { traceId: "job-123", payload: { workers: ["worker-A"] } }

2. Worker Setup:
   SetupWorkerWorkflow on worker-A-TaskQueue → success
   setupCompletedWorkers = ["worker-A"]

3. Redis Memory Check: 45% used → OK

4. ChildScanWorkflow starts:
   - createInitialDirBatch(['/']) → batchId = hash(['/'])
   
   Iteration 1:
   - scanDirectories(batchId) scans "/"
     → Finds: README.md (file), src/ (dir), docs/ (dir)
     → Publishes 3 ItemInfo entries to file stream
     → fileCount: 1, dirCount: 2
     → subDirs: ["/src", "/docs"]
     → batchSubDirs → 1 batch (2 dirs < batchSize of 100)
   
   Iteration 2:
   - scanDirectories(newBatchId) scans "/src" and "/docs"
     → /src: index.ts (file), utils.ts (file)
     → /docs: guide.md (file)
     → Publishes 3 more ItemInfo entries
     → fileCount: 3, dirCount: 0
     → subDirs: [] (no more subdirectories)
   
   Loop ends: dirBatchIds is empty

5. Result:
   { fileCount: 4, dirCount: 2, status: "Completed" }

6. Reporting: GenerateDiscoveryReportWorkflow creates report

7. Cleanup: CleanupWorkerWorkflow on worker-A, then Redis context cleanup
```

### Example 2: Large Directory with Exclusions and Parallel Workers

**Input**:

```
Source path: /data/warehouse
Job config:
  excludePatterns: ["*.tmp", "cache", ".git"]
  excludeOlderThan: "2025-01-01T00:00:00Z"
Workers: ["worker-A", "worker-B"]
```

**Workflow Execution**:

```
1. DiscoveryWorkflow triggered with:
   {
     traceId: "job-456",
     payload: { workers: ["worker-A", "worker-B"] }
   }

2. Worker Setup (parallel):
   - SetupWorkerWorkflow on worker-A-TaskQueue → success
   - SetupWorkerWorkflow on worker-B-TaskQueue → ETIMEDOUT
   
   Result: setupCompletedWorkers = ["worker-A"]
           failedWorkers = ["worker-B"]
   (Proceeds because at least 1 worker succeeded)

3. ChildScanWorkflow starts on job-456-TaskQueue
   
   Iteration 1: Scan root "/"
   - Finds 500 subdirectories
   - cache/ → EXCLUDED (matches "cache" pattern)
   - .git/  → EXCLUDED (matches ".git" pattern)
   - Remaining 498 dirs batched into 5 batches of 100 each
   - report_2024.csv (mtime: 2024-06-15) → EXCLUDED (older than 2025-01-01)
   - temp.tmp → EXCLUDED (matches "*.tmp" pattern)
   
   Iteration 2: Process 5 batches
   - MAX_CONCURRENT_BATCHES = 20, so all 5 run in parallel
   - Each batch scans up to 100 directories
   - New subdirectories discovered → batched again
   
   Iterations 3-47: Continue until all directories scanned
   
   Result: { fileCount: 245000, dirCount: 12400, status: "Completed",
             excludedPaths: [{path: "/cache", matchedPattern: "cache"}, ...] }
```

### Example 3: Pausing and Resuming a Discovery

```
1. Discovery starts normally (job-789)

2. At iteration 15, external system sends signal:
   signal('action', 'Paused')
   
   → ChildScanWorkflow receives scanActionSignal('Paused')
   → actionState = 'Paused'
   → Job status updated to 'Paused'
   → await wf.condition(() => actionState !== 'Paused')
   → BLOCKS — no more directories are scanned

3. Some time later, external system sends:
   signal('action', 'Running')
   
   → actionState = 'Running'
   → Condition resolves, scanning continues from where it left off
   → All in-progress batch IDs are preserved
```

### Example 4: Windows ADS (Alternate Data Streams) Discovery

```
Source: C:\data\files (Windows SMB share)
Job config: { shouldScanADS: true }

Scanning file: C:\data\files\report.docx
  → Normal ItemInfo published for report.docx (150 KB)
  
  → ADS detection: winOperationService.detectADSInfo()
    Found streams: ["Zone.Identifier" (26 bytes), "SummaryInfo" (4096 bytes)]
  
  → Additional ItemInfo entries published:
    - "report.docx:Zone.Identifier" (26 bytes, type: STREAM)
    - "report.docx:SummaryInfo" (4096 bytes, type: STREAM)
```

### Example 5: continueAsNew After Iteration Limit

```
Very deep directory tree: 50,000+ nested directories

ChildScanWorkflow runs for 1000+ iterations
  → iterations (1010) > ITERATIONS_LIMIT (1000)
  → Calls wf.continueAsNew({
      jobRunId,
      dirBatchIds: [remaining batch IDs],
      dirCount: 48000,      // accumulated so far
      fileCount: 1200000,   // accumulated so far
      isInitialScan: false, // don't recreate initial batch
    })
  
  → New workflow execution starts with preserved state
  → Temporal history is reset (prevents unbounded growth)
  → Scanning continues seamlessly
```

---

## Troubleshooting

### Common Issues

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Discovery never starts | All workers failed setup | Check worker connectivity, look for ECONNRESET/ETIMEDOUT in worker logs |
| Discovery stalls | Redis memory above 90% | Scale Redis or reduce `DIR_STREAM_BATCH_SIZE` |
| "UNAUTHENTICATED: Jwt is expired" | JWT token expired | Triggers automatic connection refresh; check `JWT_REFRESH_INTERVAL_MINUTES` |
| Excessive workflow history | Deep directory tree | `continueAsNew` should handle this; check `ITERATIONS_LIMIT` |
| Case-sensitivity errors on SMB | Duplicate dir names with different case | Expected behavior — items are logged to error stream |
| Worker overlapping registration | Previous worker not fully cleaned up | Auto-retries with backoff (3 attempts); check shutdown timing |

### Key Log Messages to Watch

```
[onApplicationBootstrap] - Starting Worker Service        ← Worker bootstrap start
Worker registered successfully                            ← Config service registration OK
Fetching configurations for platform: ...                 ← Config poll (every 10s)
Starting worker {id}                                      ← New Temporal worker created
Worker {id} started successfully                          ← Worker is polling for tasks
Stopping ChildScanWorkflow {id} as requested              ← Stop signal received
ChildScanWorkflow {id} has exceeded 1000 iterations       ← continueAsNew triggered
[ERROR] Error scanning directories for batch {id}         ← Scan failure (will retry)
[refreshTemporalConnections] - Refreshing connections     ← JWT refresh in progress
```
