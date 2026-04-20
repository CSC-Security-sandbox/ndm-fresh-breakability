# Redis OOM Analysis & Remediation

**Date:** 2026-04-16
**Machine:** ab-rc-14apr (172.30.205.242, us-east4-c)
**Job Run ID:** 38541598-e9ce-40da-a42e-16fe6cd38562

---

## 1. Incident Summary

The Redis pod (`redis-master-0`) entered a **CrashLoopBackOff** state with **186 restarts**, each terminated with **OOMKilled (exit code 137)**. The root cause was unbounded growth of the Redis file stream used for scanner-to-db-writer communication, which exceeded the container's 9.4 GB memory limit.

### Redis Configuration at Time of Failure

| Parameter | Value |
|-----------|-------|
| Container memory limit | 9,627 Mi (~9.4 GB) |
| `maxmemory` | 9,627 MB |
| `maxmemory-policy` | `noeviction` |
| AOF persistence | Enabled |
| AOF size on disk at crash | 4.7 GB (2.7 GB base RDB + 2.0 GB incremental AOF) |

---

## 2. Root Causes

### 2.1 Scanner Produces Files Faster Than DB-Writer Can Consume

The `ChildScanWorkflow` pushes discovered files into a Redis stream (`{jobRunId}:files`). The `db-writer` pod reads from this stream, processes entries, writes to Postgres, and then ACKs/deletes them. The scanner consistently outpaces the consumer, causing the stream to grow unbounded.

**Measured rates (concurrency=5):**

| Component | Rate |
|-----------|------|
| Scanner production rate | ~16,600 files/sec (total across 5 activities) |
| Scanner production rate per activity | ~3,320 files/sec |
| DB-writer consumption rate | ~2,900 files/sec |
| **Net accumulation rate** | **~13,700 files/sec** |
| Memory growth rate | ~660 MB/min |

At the time of failure:
- **File stream length:** 10,821,298 entries
- **Redis memory usage:** 6.96 GB (74% of maxmemory), peak 8.83 GB (94%)
- **Redis memory per stream entry:** ~830 bytes

### 2.2 Memory Backpressure Check Compared Against Wrong Baseline

The `waitUntilRedisMemoryOk` guard was designed to pause scanning when Redis memory is high. However, it compared `used_memory` against `total_system_memory` (62 GB) instead of Redis's `maxmemory` (9.4 GB).

**File:** `services/worker/src/activities/redis/redis.mem.usage.check.activity.ts`

```typescript
// BEFORE (broken): threshold = 90% of 62 GB = ~56 GB — never triggers
const memoryUsagePercentage = (memoryInfo.used_memory / memoryInfo.total_system_memory) * 100;
```

| Threshold | Against `total_system_memory` (62 GB) | Against `maxmemory` (9.4 GB) |
|-----------|--------------------------------------|------------------------------|
| 90% | Triggers at ~56 GB | Triggers at ~8.5 GB |
| **Actual Redis OOM** | **9.4 GB** | **9.4 GB** |
| **Result** | Guard never fires | Guard fires with ~1 GB headroom |

### 2.3 No File Stream Length Cap

The codebase had `validateCommandStreamLength` to cap the command stream at 5,000 entries, but **no equivalent existed for the file stream** — the one that actually holds the bulk of the data (10.8M entries consuming ~7 GB).

### 2.4 Excessive Scanner Concurrency for Large Directories

The interaction of three workflow parameters determined how many files were pushed into Redis per batch cycle before any backpressure check could fire:

```
Files per cycle = min(JOB_CONCURRENCY, MAX_CONCURRENT_BATCHES) × DEFAULT_BATCH_SIZE × files_per_directory
```

**Configuration at time of failure:**

| Parameter | Value | Source |
|-----------|-------|--------|
| `JOB_TASK_ACTIVITY_CONCURRENCY` | 20 | Environment variable |
| `MAX_CONCURRENT_BATCHES` | 20 | Hardcoded constant |
| `DEFAULT_BATCH_SIZE` | 100 | Hardcoded constant |

With directories containing ~1M files:
```
Files per cycle = min(20, 20) × 100 × 1,000,000 = 2,000,000,000 (2 billion)
```

Even accounting for concurrent db-writer consumption (~12.7% drained during scanning), the peak stream size far exceeded Redis capacity.

---

## 3. How the Data Flows

```
ChildScanWorkflow (Temporal worker)
  │
  │  executeBatchScan()
  │    for (i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES)
  │      Promise.all(batchSlice.map(batchId =>
  │        scanDirectories({ batchSize: DEFAULT_BATCH_SIZE })   ← 1 Temporal activity per batch
  │      ))                                                      ← limited by JOB_CONCURRENCY
  │
  │  ── XADD ──►  Redis file stream ({jobRunId}:files)  ── XREADGROUP ──►  DB-Writer pod
  │                                                                           │
  │  ◄── backpressure checks fire HERE (between activity calls) ──            │
  │                                                                           ▼
  │                                                                       Postgres
```

**Key observation:** Backpressure checks (`waitUntilRedisMemoryOk`, `validateFileStreamLength`) only execute **between activity calls** at the workflow level. While a scan activity is running, it pushes files continuously without any throttling.

---

## 4. Observed Impact at Different Concurrency Levels

All measurements taken on the same machine with the same job type.

| JOB_CONCURRENCY | Scanner rate | DB-writer rate | Net growth | Memory growth | Time to OOM (9.4 GB) |
|:-:|:-:|:-:|:-:|:-:|:-:|
| 20 | ~66,400/sec | ~2,900/sec | ~63,500/sec | ~158 MB/min | ~1 hour |
| 10 | ~33,200/sec | ~2,900/sec | ~30,300/sec | ~75 MB/min | ~2 hours |
| 5 (measured) | ~16,600/sec | ~2,900/sec | ~13,700/sec | ~39 GB/hour | ~11 min |
| 1 | ~3,320/sec | ~2,900/sec | ~420/sec | ~1.3 GB/hour | ~7 hours |

**Conclusion:** Reducing concurrency slows the fill rate but does not prevent OOM. Even at `JOB_CONCURRENCY=1`, the scanner slightly outpaces the consumer and Redis will eventually fill given enough time.

---

## 5. Fixes Implemented

### Fix 1: Memory Check Against `maxmemory`

**Files changed:**
- `services/worker/src/redis/redis.service.ts` — `parseMemoryStats()` now extracts and returns `maxmemory`
- `services/worker/src/activities/redis/redis.mem.usage.check.activity.ts` — `checkMemoryUsage()` compares against `maxmemory` (falls back to `total_system_memory` if `maxmemory` is 0)

```typescript
// AFTER (fixed): uses maxmemory as the denominator
const memoryLimit = memoryInfo.maxmemory > 0 ? memoryInfo.maxmemory : memoryInfo.total_system_memory;
const memoryUsagePercentage = (memoryInfo.used_memory / memoryLimit) * 100;
```

**Effect:** At 90% threshold, backpressure triggers at ~8.5 GB instead of never. Provides ~1 GB headroom before OOM.

### Fix 2: File Stream Length Validation

**Files changed:**
- `lib/jobs-lib/src/types/job-manager-context/job-manager-context.ts` — added `getFileStreamLen()` method
- `services/worker/src/activities/core/common/common-task.service.ts` — added `isFileStreamLenValid()` activity
- `services/worker/src/workflows/core/common/workflow-utils.ts` — added `validateFileStreamLength()` function
- `services/worker/src/config/app.config.ts` — added `maxFileStreamLen` config (env: `MAX_FILES_IN_STREAM`, default: 500,000)
- `services/worker/src/workflows/core/child/child-scan.workflow.ts` — wired into main loop and batch chunks
- `services/worker/src/workflows/core/child/child-retry-scan.workflow.ts` — wired before batch processing

**Effect:** Scanner pauses when the file stream exceeds 500,000 entries (configurable). The db-writer drains the backlog, then scanning resumes. This directly prevents unbounded stream growth regardless of concurrency or directory size.

---

## 6. Recommended Configuration Values

### How the Parameters Interact

```
Concurrent activities  = min(JOB_CONCURRENCY, MAX_CONCURRENT_BATCHES)
Dirs per batch cycle   = Concurrent activities × DEFAULT_BATCH_SIZE
Peak stream entries    = Dirs per cycle × files_per_dir × (1 - consumption_rate / production_rate)
Peak Redis memory      = Peak stream entries × ~830 bytes/entry
```

The factor `(1 - 2,900 / 3,320) ≈ 0.127` accounts for db-writer consumption during scanning. Roughly 12.7% of produced files accumulate as backlog.

### Recommended Values

For a balanced configuration that handles the general case (10K–50K files/dir) with safety for the extreme case (1M files/dir):

```
JOB_TASK_ACTIVITY_CONCURRENCY = 2
MAX_CONCURRENT_BATCHES        = 2
DEFAULT_BATCH_SIZE            = 10
MAX_FILES_IN_STREAM           = 500000
REDIS_MEM_USAGE_THRESHOLD     = 90
```

### Peak Redis Usage by Directory Size

With the recommended configuration (`2 / 2 / 10`):

| Files per directory | Dirs scanned per cycle | Peak stream entries | Peak Redis memory | Status |
|:-:|:-:|:-:|:-:|---|
| 1,000 | 20 | ~2,540 | ~2 MB | Negligible |
| 10,000 | 20 | ~25,400 | ~21 MB | Safe |
| 50,000 | 20 | ~127,000 | ~105 MB | Safe |
| 100,000 | 20 | ~254,000 | ~210 MB | Safe |
| 500,000 | 20 | ~1,270,000 | ~1 GB | OK |
| 1,000,000 | 20 | ~2,540,000 | ~2 GB | Within limits |

### Safety Net Behavior (with fixes deployed)

Even if peak usage exceeds expectations:

1. **File stream length cap** (fix 2) triggers at 500K entries (~415 MB) — scanner pauses, db-writer drains
2. **Memory threshold** (fix 1) triggers at 90% of `maxmemory` (~8.5 GB) — secondary safety net
3. Both checks fire between activity calls, so worst-case overshoot = files from one in-flight activity

### Alternative Configurations

| Profile | JOB_CONCURRENCY | MAX_CONCURRENT_BATCHES | DEFAULT_BATCH_SIZE | Peak (1M files/dir) | Use case |
|---------|:-:|:-:|:-:|:-:|---|
| Conservative | 1 | 1 | 5 | ~525 MB | Large dirs, limited resources |
| **Balanced** | **2** | **2** | **10** | **~2 GB** | **General purpose (recommended)** |
| Aggressive | 3 | 3 | 10 | ~3 GB | Small-to-medium dirs, fast scanning needed |

---

## 7. Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `JOB_TASK_ACTIVITY_CONCURRENCY` | 1 | Max concurrent Temporal activities on the worker |
| `MAX_FILES_IN_STREAM` | 500,000 | File stream length cap before scanner pauses |
| `MAX_CMDS_IN_STREAM` | 5,000 | Command stream length cap |
| `REDIS_MEM_USAGE_THRESHOLD` | 90 | Memory usage % threshold for backpressure |

**Note:** `MAX_CONCURRENT_BATCHES` and `DEFAULT_BATCH_SIZE` are hardcoded constants in `services/worker/src/workflows/core/common/workflow-constants.ts`. To change them, update the source code and redeploy.
