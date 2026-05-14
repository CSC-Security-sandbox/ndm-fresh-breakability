import { Inject, Injectable } from '@nestjs/common';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

/**
 * Per job-run hints so we do not repeat failing atime-avoidance strategies
 * (O_NOATIME opens, NFS mount noatime options) for every file/mount in the session.
 *
 * Also owns **at most one diagnostic log line per source** (jobRunId + sourcePathId)
 * for read path and stamp path, to avoid log storms on very large migrations.
 *
 * Memory bound: each underlying Set is capped at MAX_ENTRIES_PER_SET with FIFO
 * eviction (Set preserves insertion order per ECMA-262, so `.values().next()`
 * gives the oldest key). The cap is large enough that a single job will never
 * hit it (the largest set is keyed per source-path which is bounded by the
 * job's source mounts), but small enough that a long-lived worker accumulating
 * thousands of distinct jobRunIds cannot leak unbounded memory. Callers that
 * have an explicit job-completion signal SHOULD also call `clearJob(jobRunId)`
 * for prompt cleanup; the FIFO bound is the safety net for callers that don't.
 */
@Injectable()
export class AtimeReadSessionService {
  /** FIFO cap per Set. ~10k entries × ~100 bytes/key ≈ <1 MB ceiling per Set. */
  private static readonly MAX_ENTRIES_PER_SET = 10_000;

  private readonly openNoatimeSkip = new Set<string>();
  private readonly nfsMountNoatimeSkip = new Set<string>();
  private readonly smbMountNoatimeSkip = new Set<string>();
  private readonly smbBackupIntentLogged = new Set<string>();
  private readonly readStrategyLogged = new Set<string>();
  private readonly stampConfigLogged = new Set<string>();
  private readonly stampReadonlyLogged = new Set<string>();
  private readonly oNoatimeJobDemotionLogged = new Set<string>();
  private readonly logger: LoggerService;

  constructor(@Inject(LoggerFactory) loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create(AtimeReadSessionService.name);
  }

  /**
   * Insert with FIFO eviction. Returns true iff the key was newly added.
   * The eviction is a "diagnostic loss" failure mode (worst case: the same
   * once-only log re-fires after the Set has rolled over), which is much
   * cheaper than the alternative — unbounded growth on long-running workers.
   */
  private boundedAdd(set: Set<string>, key: string): boolean {
    if (set.has(key)) return false;
    set.add(key);
    if (set.size > AtimeReadSessionService.MAX_ENTRIES_PER_SET) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
    return true;
  }

  private sourceKey(
    jobRunId: string | undefined,
    sourcePathId: string | undefined,
  ): string {
    return `${jobRunId ?? ''}\u001f${sourcePathId ?? '_'}`;
  }

  /**
   * Drop all session state for a finished job. Callers with a job-completion
   * hook (e.g. workflow shutdown, parent-workflow cleanup) should invoke this
   * to release memory promptly; the per-Set FIFO cap covers callers that
   * don't. Safe to call with an unknown jobRunId — it's a no-op when nothing
   * is tracked.
   */
  clearJob(jobRunId: string | undefined): void {
    if (!jobRunId) return;
    this.openNoatimeSkip.delete(jobRunId);
    this.nfsMountNoatimeSkip.delete(jobRunId);
    this.smbMountNoatimeSkip.delete(jobRunId);
    this.smbBackupIntentLogged.delete(jobRunId);
    this.oNoatimeJobDemotionLogged.delete(jobRunId);
    const prefix = `${jobRunId}\u001f`;
    for (const k of this.readStrategyLogged) {
      if (k.startsWith(prefix)) this.readStrategyLogged.delete(k);
    }
    for (const k of this.stampConfigLogged) {
      if (k.startsWith(prefix)) this.stampConfigLogged.delete(k);
    }
    for (const k of this.stampReadonlyLogged) {
      if (k.startsWith(prefix)) this.stampReadonlyLogged.delete(k);
    }
  }

  /** @returns true if this jobRunId was newly marked (first ineffective O_NOATIME for the session). */
  markSourceOpenNoatimeIneffective(jobRunId: string): boolean {
    if (!jobRunId) return false;
    return this.boundedAdd(this.openNoatimeSkip, jobRunId);
  }

  shouldSkipSourceOpenNoatime(jobRunId: string | undefined): boolean {
    return !!jobRunId && this.openNoatimeSkip.has(jobRunId);
  }

  /** @returns true if this jobRunId was newly marked (first NFS noatime mount fallback). */
  markNfsMountNoatimeUnsupported(jobRunId: string): boolean {
    if (!jobRunId) return false;
    return this.boundedAdd(this.nfsMountNoatimeSkip, jobRunId);
  }

  shouldAttemptNfsMountNoatime(jobRunId: string | undefined): boolean {
    return !jobRunId || !this.nfsMountNoatimeSkip.has(jobRunId);
  }

  /** @returns true if this jobRunId was newly marked (first SMB noatime mount fallback). */
  markSmbMountNoatimeUnsupported(jobRunId: string): boolean {
    if (!jobRunId) return false;
    return this.boundedAdd(this.smbMountNoatimeSkip, jobRunId);
  }

  shouldAttemptSmbMountNoatime(jobRunId: string | undefined): boolean {
    return !jobRunId || !this.smbMountNoatimeSkip.has(jobRunId);
  }

  /**
   * One info line per job: Windows SMB mount has the SeBackupPrivilege /
   * SeRestorePrivilege pair enabled. The Strategy-1 backup-intent flag
   * isn't requested per-file by Node's stream APIs (so on the read path
   * we still see the Strategy-1 fallback log via STRATEGY_1_SMB_BACKUP_INTENT_ENABLED
   * → WIN_READ_STAMP_FALLBACK), but the privilege scope is process-wide
   * and is the prerequisite for any future native-binding upgrade that
   * would request CreateFile(FILE_FLAG_BACKUP_SEMANTICS) directly.
   */
  logSmbBackupIntentOnce(jobRunId: string | undefined): boolean {
    if (!jobRunId) return false;
    if (!this.boundedAdd(this.smbBackupIntentLogged, jobRunId)) return false;
    this.logger.log(
      `[atime-diagnostic] jobRunId=${jobRunId} mount_smb:strategy_1_windows_backup_privileges_enabled`,
    );
    return true;
  }

  /** One info line per source (task sPathId): first copy result establishes read-side atime strategy label. */
  logReadAtimeStrategyOnce(
    jobRunId: string | undefined,
    sourcePathId: string | undefined,
    strategyLabel: string,
  ): void {
    if (!jobRunId || !strategyLabel) return;
    const k = this.sourceKey(jobRunId, sourcePathId);
    if (!this.boundedAdd(this.readStrategyLogged, k)) return;
    this.logger.log(
      `[atime-diagnostic] jobRunId=${jobRunId} sourcePathId=${sourcePathId ?? 'n/a'} read_atime_strategy=${strategyLabel}`,
    );
  }

  /** Job-wide: once when O_NOATIME is demoted to plain reads for this job. */
  logONoatimeSessionDemotionOnce(jobRunId: string): void {
    if (!jobRunId) return;
    if (!this.boundedAdd(this.oNoatimeJobDemotionLogged, jobRunId)) return;
    this.logger.log(
      `[atime-diagnostic] jobRunId=${jobRunId} read_atime_note=o_noatime_ineffective_for_job_remaining_files_use_standard_read`,
    );
  }

  /** One info line per source: stamp phase uses relatime gate + window (Strategy 4b + 5). */
  logStampConfigOnce(
    jobRunId: string | undefined,
    sourcePathId: string | undefined,
    params: { relatimeGateEnabled: boolean; relatimeWindowMs: number },
  ): void {
    if (!jobRunId) return;
    const k = this.sourceKey(jobRunId, sourcePathId) + '\u001fstamp_cfg';
    if (!this.boundedAdd(this.stampConfigLogged, k)) return;
    this.logger.log(
      `[atime-diagnostic] jobRunId=${jobRunId} sourcePathId=${sourcePathId ?? 'n/a'} stamp_atime=strategy_4b_gate=${params.relatimeGateEnabled} relatime_window_ms=${params.relatimeWindowMs} (then strategy_5 source utimes when gate says restore)`,
    );
  }

  /** One info line per source: first time a file on this source is not writable (Strategy 6). */
  logStampReadonlySourceOnce(
    jobRunId: string | undefined,
    sourcePathId: string | undefined,
    examplePath: string,
  ): void {
    if (!jobRunId) return;
    const k = this.sourceKey(jobRunId, sourcePathId) + '\u001fro';
    if (!this.boundedAdd(this.stampReadonlyLogged, k)) return;
    this.logger.log(
      `[atime-diagnostic] jobRunId=${jobRunId} sourcePathId=${sourcePathId ?? 'n/a'} stamp_atime=strategy_6_readonly_skip_restore example=${examplePath}`,
    );
  }
}
