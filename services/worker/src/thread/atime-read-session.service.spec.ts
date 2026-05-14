import { AtimeReadSessionService } from './atime-read-session.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

/**
 * Coverage target: every branch in AtimeReadSessionService.
 *
 * The service is a per-job-run dedup cache for atime-preservation
 * diagnostics + strategy-skip flags. It has no external state, so the
 * tests are pure: assert that the first call returns true / logs, and
 * subsequent calls for the same key return false / do not re-log. The
 * "missing jobRunId" early-out is exercised explicitly because that
 * branch is the most likely production miss (jobRunId is plumbed
 * through the call stack and any consumer that forgets it should
 * silently no-op rather than throw or log noise).
 */

describe('AtimeReadSessionService', () => {
  let service: AtimeReadSessionService;
  let loggerLog: jest.Mock;
  let loggerFactory: LoggerFactory;

  beforeEach(() => {
    loggerLog = jest.fn();
    loggerFactory = {
      create: jest.fn().mockReturnValue({
        log: loggerLog,
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      }),
    } as unknown as LoggerFactory;
    service = new AtimeReadSessionService(loggerFactory);
  });

  describe('markSourceOpenNoatimeIneffective / shouldSkipSourceOpenNoatime', () => {
    it('returns true on first mark and false on subsequent marks', () => {
      expect(service.markSourceOpenNoatimeIneffective('job-1')).toBe(true);
      expect(service.markSourceOpenNoatimeIneffective('job-1')).toBe(false);
    });

    it('returns false when jobRunId is empty', () => {
      expect(service.markSourceOpenNoatimeIneffective('')).toBe(false);
    });

    it('shouldSkip returns true after mark, false otherwise', () => {
      expect(service.shouldSkipSourceOpenNoatime('job-2')).toBe(false);
      service.markSourceOpenNoatimeIneffective('job-2');
      expect(service.shouldSkipSourceOpenNoatime('job-2')).toBe(true);
    });

    it('shouldSkip returns false when jobRunId is undefined', () => {
      expect(service.shouldSkipSourceOpenNoatime(undefined)).toBe(false);
    });
  });

  describe('markNfsMountNoatimeUnsupported / shouldAttemptNfsMountNoatime', () => {
    it('returns true on first mark and false on subsequent marks', () => {
      expect(service.markNfsMountNoatimeUnsupported('job-1')).toBe(true);
      expect(service.markNfsMountNoatimeUnsupported('job-1')).toBe(false);
    });

    it('returns false when jobRunId is empty', () => {
      expect(service.markNfsMountNoatimeUnsupported('')).toBe(false);
    });

    it('shouldAttempt is true by default and false after mark', () => {
      expect(service.shouldAttemptNfsMountNoatime('job-3')).toBe(true);
      service.markNfsMountNoatimeUnsupported('job-3');
      expect(service.shouldAttemptNfsMountNoatime('job-3')).toBe(false);
    });

    it('shouldAttempt is true when jobRunId is undefined (default-permissive)', () => {
      expect(service.shouldAttemptNfsMountNoatime(undefined)).toBe(true);
    });
  });

  describe('markSmbMountNoatimeUnsupported / shouldAttemptSmbMountNoatime', () => {
    it('returns true on first mark and false on subsequent marks', () => {
      expect(service.markSmbMountNoatimeUnsupported('job-1')).toBe(true);
      expect(service.markSmbMountNoatimeUnsupported('job-1')).toBe(false);
    });

    it('returns false when jobRunId is empty', () => {
      expect(service.markSmbMountNoatimeUnsupported('')).toBe(false);
    });

    it('shouldAttempt is true by default and false after mark', () => {
      expect(service.shouldAttemptSmbMountNoatime('job-4')).toBe(true);
      service.markSmbMountNoatimeUnsupported('job-4');
      expect(service.shouldAttemptSmbMountNoatime('job-4')).toBe(false);
    });

    it('shouldAttempt is true when jobRunId is undefined (default-permissive)', () => {
      expect(service.shouldAttemptSmbMountNoatime(undefined)).toBe(true);
    });

    it('NFS and SMB tracking are independent: NFS mark does not affect SMB', () => {
      service.markNfsMountNoatimeUnsupported('job-5');
      expect(service.shouldAttemptSmbMountNoatime('job-5')).toBe(true);
    });
  });

  describe('logSmbBackupIntentOnce', () => {
    it('logs exactly once per jobRunId and returns true only the first time', () => {
      expect(service.logSmbBackupIntentOnce('job-1')).toBe(true);
      expect(service.logSmbBackupIntentOnce('job-1')).toBe(false);
      expect(loggerLog).toHaveBeenCalledTimes(1);
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('mount_smb:strategy_1_windows_backup_privileges_enabled'),
      );
      expect(loggerLog).toHaveBeenCalledWith(expect.stringContaining('jobRunId=job-1'));
    });

    it('returns false and does not log when jobRunId is undefined', () => {
      expect(service.logSmbBackupIntentOnce(undefined)).toBe(false);
      expect(loggerLog).not.toHaveBeenCalled();
    });

    it('logs separately for distinct jobRunIds', () => {
      service.logSmbBackupIntentOnce('job-a');
      service.logSmbBackupIntentOnce('job-b');
      expect(loggerLog).toHaveBeenCalledTimes(2);
    });
  });

  describe('logReadAtimeStrategyOnce', () => {
    it('logs once per (jobRunId, sourcePathId) pair', () => {
      service.logReadAtimeStrategyOnce('job-1', 'src-1', 'strategy_2_o_noatime');
      service.logReadAtimeStrategyOnce('job-1', 'src-1', 'strategy_2_o_noatime');
      expect(loggerLog).toHaveBeenCalledTimes(1);
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('read_atime_strategy=strategy_2_o_noatime'),
      );
      expect(loggerLog).toHaveBeenCalledWith(expect.stringContaining('sourcePathId=src-1'));
    });

    it('logs separately for different sourcePathIds within the same job', () => {
      service.logReadAtimeStrategyOnce('job-1', 'src-1', 'lbl');
      service.logReadAtimeStrategyOnce('job-1', 'src-2', 'lbl');
      expect(loggerLog).toHaveBeenCalledTimes(2);
    });

    it('uses "n/a" sourcePathId placeholder when missing', () => {
      service.logReadAtimeStrategyOnce('job-1', undefined, 'lbl');
      expect(loggerLog).toHaveBeenCalledWith(expect.stringContaining('sourcePathId=n/a'));
    });

    it('does not log when jobRunId is undefined', () => {
      service.logReadAtimeStrategyOnce(undefined, 'src-1', 'lbl');
      expect(loggerLog).not.toHaveBeenCalled();
    });

    it('does not log when strategyLabel is empty', () => {
      service.logReadAtimeStrategyOnce('job-1', 'src-1', '');
      expect(loggerLog).not.toHaveBeenCalled();
    });
  });

  describe('logONoatimeSessionDemotionOnce', () => {
    it('logs exactly once per jobRunId', () => {
      service.logONoatimeSessionDemotionOnce('job-1');
      service.logONoatimeSessionDemotionOnce('job-1');
      expect(loggerLog).toHaveBeenCalledTimes(1);
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('o_noatime_ineffective_for_job_remaining_files_use_standard_read'),
      );
    });

    it('does not log when jobRunId is undefined', () => {
      service.logONoatimeSessionDemotionOnce(undefined as unknown as string);
      expect(loggerLog).not.toHaveBeenCalled();
    });
  });

  describe('logStampConfigOnce', () => {
    it('logs once per (jobRunId, sourcePathId) pair with gate + window', () => {
      service.logStampConfigOnce('job-1', 'src-1', {
        relatimeGateEnabled: true,
        relatimeWindowMs: 86400000,
      });
      service.logStampConfigOnce('job-1', 'src-1', {
        relatimeGateEnabled: true,
        relatimeWindowMs: 86400000,
      });
      expect(loggerLog).toHaveBeenCalledTimes(1);
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('strategy_4b_gate=true'),
      );
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('relatime_window_ms=86400000'),
      );
    });

    it('logs separately for distinct sourcePathIds', () => {
      const params = { relatimeGateEnabled: false, relatimeWindowMs: 0 };
      service.logStampConfigOnce('job-1', 'src-1', params);
      service.logStampConfigOnce('job-1', 'src-2', params);
      expect(loggerLog).toHaveBeenCalledTimes(2);
    });

    it('does not log when jobRunId is undefined', () => {
      service.logStampConfigOnce(undefined, 'src-1', {
        relatimeGateEnabled: true,
        relatimeWindowMs: 1000,
      });
      expect(loggerLog).not.toHaveBeenCalled();
    });
  });

  describe('logStampReadonlySourceOnce', () => {
    it('logs once per (jobRunId, sourcePathId) and includes example path', () => {
      service.logStampReadonlySourceOnce('job-1', 'src-1', '/mnt/ro/file.txt');
      service.logStampReadonlySourceOnce('job-1', 'src-1', '/mnt/ro/another.txt');
      expect(loggerLog).toHaveBeenCalledTimes(1);
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('strategy_6_readonly_skip_restore'),
      );
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('example=/mnt/ro/file.txt'),
      );
    });

    it('logs separately for distinct sourcePathIds within the same job', () => {
      service.logStampReadonlySourceOnce('job-1', 'src-1', '/a');
      service.logStampReadonlySourceOnce('job-1', 'src-2', '/b');
      expect(loggerLog).toHaveBeenCalledTimes(2);
    });

    it('does not log when jobRunId is undefined', () => {
      service.logStampReadonlySourceOnce(undefined, 'src-1', '/a');
      expect(loggerLog).not.toHaveBeenCalled();
    });
  });

  describe('cross-method isolation', () => {
    it('different log channels do not collide on the same (jobRunId, sourcePathId)', () => {
      service.logReadAtimeStrategyOnce('job-1', 'src-1', 'lbl');
      service.logStampConfigOnce('job-1', 'src-1', {
        relatimeGateEnabled: true,
        relatimeWindowMs: 1000,
      });
      service.logStampReadonlySourceOnce('job-1', 'src-1', '/a');
      service.logStampStrategy5SkippedOnce('job-1', 'src-1', 'mount_noatime_in_effect');
      // Four distinct channel keys, all should fire once.
      expect(loggerLog).toHaveBeenCalledTimes(4);
    });
  });

  describe('markMountNoatimeApplied / isMountNoatimeAppliedForSource', () => {
    it('returns false before any mark and true after marking the same source', () => {
      expect(service.isMountNoatimeAppliedForSource('job-1', 'src-1')).toBe(false);
      service.markMountNoatimeApplied('job-1', 'src-1');
      expect(service.isMountNoatimeAppliedForSource('job-1', 'src-1')).toBe(true);
    });

    it('isolates state per (jobRunId, sourcePathId)', () => {
      service.markMountNoatimeApplied('job-1', 'src-1');
      // Same source under a different job should not see the mark.
      expect(service.isMountNoatimeAppliedForSource('job-2', 'src-1')).toBe(false);
      // Same job, different source should not see the mark.
      expect(service.isMountNoatimeAppliedForSource('job-1', 'src-2')).toBe(false);
    });

    it('handles undefined sourcePathId as a stable key (single-source jobs)', () => {
      service.markMountNoatimeApplied('job-1', undefined);
      expect(service.isMountNoatimeAppliedForSource('job-1', undefined)).toBe(true);
      // A named source on the same job is a different key — must be isolated.
      expect(service.isMountNoatimeAppliedForSource('job-1', 'src-1')).toBe(false);
    });

    it('is a no-op when jobRunId is missing', () => {
      service.markMountNoatimeApplied(undefined, 'src-1');
      expect(service.isMountNoatimeAppliedForSource(undefined, 'src-1')).toBe(false);
    });
  });

  describe('logStampStrategy5SkippedOnce', () => {
    it('logs once per (jobRunId, sourcePathId) and includes the reason', () => {
      expect(
        service.logStampStrategy5SkippedOnce('job-1', 'src-1', 'mount_noatime_in_effect'),
      ).toBe(true);
      expect(
        service.logStampStrategy5SkippedOnce('job-1', 'src-1', 'mount_noatime_in_effect'),
      ).toBe(false);
      expect(loggerLog).toHaveBeenCalledTimes(1);
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('strategy_5_skipped_kernel_noatime_guaranteed'),
      );
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('reason=mount_noatime_in_effect'),
      );
    });

    it('logs separately for distinct sourcePathIds within the same job', () => {
      service.logStampStrategy5SkippedOnce('job-1', 'src-1', 'r');
      service.logStampStrategy5SkippedOnce('job-1', 'src-2', 'r');
      expect(loggerLog).toHaveBeenCalledTimes(2);
    });

    it('does not log when jobRunId is missing', () => {
      expect(service.logStampStrategy5SkippedOnce(undefined, 'src-1', 'r')).toBe(false);
      expect(loggerLog).not.toHaveBeenCalled();
    });
  });

  describe('logSmbWindowsStrategy3UnavailableOnce', () => {
    it('logs the structural-unavailability line exactly once per job', () => {
      expect(service.logSmbWindowsStrategy3UnavailableOnce('job-1')).toBe(true);
      expect(service.logSmbWindowsStrategy3UnavailableOnce('job-1')).toBe(false);
      expect(loggerLog).toHaveBeenCalledTimes(1);
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining(
          'mount_smb:strategy_3_not_applicable_windows_net_use_no_atime_option',
        ),
      );
    });

    it('logs separately for distinct jobs', () => {
      service.logSmbWindowsStrategy3UnavailableOnce('job-1');
      service.logSmbWindowsStrategy3UnavailableOnce('job-2');
      expect(loggerLog).toHaveBeenCalledTimes(2);
    });

    it('does not log when jobRunId is missing', () => {
      expect(service.logSmbWindowsStrategy3UnavailableOnce(undefined)).toBe(false);
      expect(loggerLog).not.toHaveBeenCalled();
    });
  });

  describe('clearJob', () => {
    it('drops every per-jobRunId set entry for the cleared job', () => {
      service.markSourceOpenNoatimeIneffective('job-1');
      service.markNfsMountNoatimeUnsupported('job-1');
      service.markSmbMountNoatimeUnsupported('job-1');
      service.logSmbBackupIntentOnce('job-1');
      service.logSmbWindowsStrategy3UnavailableOnce('job-1');
      service.logONoatimeSessionDemotionOnce('job-1');
      service.markMountNoatimeApplied('job-1', 'src-1');
      service.logStampStrategy5SkippedOnce('job-1', 'src-1', 'r');

      service.clearJob('job-1');

      // After clearJob, the should* checks default-permissive again and a
      // fresh mark/log call returns true (i.e. the state was actually reset).
      expect(service.shouldSkipSourceOpenNoatime('job-1')).toBe(false);
      expect(service.shouldAttemptNfsMountNoatime('job-1')).toBe(true);
      expect(service.shouldAttemptSmbMountNoatime('job-1')).toBe(true);
      expect(service.isMountNoatimeAppliedForSource('job-1', 'src-1')).toBe(false);
      expect(service.markSourceOpenNoatimeIneffective('job-1')).toBe(true);
      expect(service.markNfsMountNoatimeUnsupported('job-1')).toBe(true);
      expect(service.markSmbMountNoatimeUnsupported('job-1')).toBe(true);
      expect(service.logSmbBackupIntentOnce('job-1')).toBe(true);
      expect(service.logSmbWindowsStrategy3UnavailableOnce('job-1')).toBe(true);
      expect(service.logStampStrategy5SkippedOnce('job-1', 'src-1', 'r')).toBe(true);
    });

    it('drops only entries belonging to the cleared job, leaving siblings untouched', () => {
      service.markSourceOpenNoatimeIneffective('job-A');
      service.markSourceOpenNoatimeIneffective('job-B');
      service.logReadAtimeStrategyOnce('job-A', 'src-1', 'lbl');
      service.logReadAtimeStrategyOnce('job-B', 'src-1', 'lbl');
      service.logStampConfigOnce('job-A', 'src-1', {
        relatimeGateEnabled: true,
        relatimeWindowMs: 1,
      });
      service.logStampConfigOnce('job-B', 'src-1', {
        relatimeGateEnabled: true,
        relatimeWindowMs: 1,
      });
      service.logStampReadonlySourceOnce('job-A', 'src-1', '/a');
      service.logStampReadonlySourceOnce('job-B', 'src-1', '/a');

      const logsBefore = loggerLog.mock.calls.length;
      service.clearJob('job-A');

      // job-A is fully reset.
      expect(service.shouldSkipSourceOpenNoatime('job-A')).toBe(false);
      expect(service.markSourceOpenNoatimeIneffective('job-A')).toBe(true);
      // Re-emitting the same per-source logs for job-A re-fires (state gone),
      // but for job-B does NOT (state still cached).
      service.logReadAtimeStrategyOnce('job-A', 'src-1', 'lbl');
      service.logReadAtimeStrategyOnce('job-B', 'src-1', 'lbl');
      service.logStampConfigOnce('job-A', 'src-1', {
        relatimeGateEnabled: true,
        relatimeWindowMs: 1,
      });
      service.logStampConfigOnce('job-B', 'src-1', {
        relatimeGateEnabled: true,
        relatimeWindowMs: 1,
      });
      service.logStampReadonlySourceOnce('job-A', 'src-1', '/a');
      service.logStampReadonlySourceOnce('job-B', 'src-1', '/a');

      // 3 new log lines for job-A (read + stamp_cfg + readonly), 0 for job-B.
      expect(loggerLog.mock.calls.length - logsBefore).toBe(3);
      expect(service.shouldSkipSourceOpenNoatime('job-B')).toBe(true);
    });

    it('is a safe no-op when called with undefined or unknown jobRunId', () => {
      service.markSourceOpenNoatimeIneffective('job-keep');
      service.clearJob(undefined);
      service.clearJob('job-never-seen');
      expect(service.shouldSkipSourceOpenNoatime('job-keep')).toBe(true);
    });
  });

  describe('FIFO bound on per-Set growth', () => {
    /**
     * The bound is documented as MAX_ENTRIES_PER_SET=10_000. We don't reach
     * for that constant directly (it's a private static); instead we test
     * the observable contract: after Set.size exceeds the cap, the oldest
     * inserted key is evicted, so a re-insertion of that oldest key now
     * returns true (newly added) rather than false (already present).
     *
     * To keep the test fast we overwhelm the cap by accessing the private
     * static via a cast, then add cap+2 distinct keys.
     */
    it('evicts the oldest entry once the per-Set cap is exceeded', () => {
      const cap = (AtimeReadSessionService as unknown as { MAX_ENTRIES_PER_SET: number })
        .MAX_ENTRIES_PER_SET;
      // First key is the oldest, we expect it to be evicted.
      const oldest = 'job-oldest';
      expect(service.markSourceOpenNoatimeIneffective(oldest)).toBe(true);
      // Re-insertion before any eviction returns false (already present).
      expect(service.markSourceOpenNoatimeIneffective(oldest)).toBe(false);
      // Fill the Set past cap with cap distinct keys, forcing eviction of the
      // oldest. (We've already added 1, so cap more brings the Set to cap+1
      // immediately followed by an eviction back down to cap.)
      for (let i = 0; i < cap; i++) {
        service.markSourceOpenNoatimeIneffective(`job-fill-${i}`);
      }
      // The oldest key has been evicted, so re-marking it must report "newly added".
      expect(service.markSourceOpenNoatimeIneffective(oldest)).toBe(true);
    });
  });
});
