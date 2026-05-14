import {
  ATIME_DIAG,
  atimeKernelGuaranteed,
  isErrnoCode,
  isNoatimeOpenCapabilityError,
  shouldRestoreSourceAtimeRelatime,
} from './atime-preserve.utils';

describe('shouldRestoreSourceAtimeRelatime', () => {
  const day = 24 * 60 * 60 * 1000;

  it('returns true when atime is older than mtime', () => {
    expect(
      shouldRestoreSourceAtimeRelatime({
        atimeMs: 100,
        mtimeMs: 200,
        ctimeMs: 200,
        relatimeWindowMs: day,
        nowMs: 10_000,
      }),
    ).toBe(true);
  });

  it('returns true when atime is older than ctime', () => {
    expect(
      shouldRestoreSourceAtimeRelatime({
        atimeMs: 100,
        mtimeMs: 100,
        ctimeMs: 200,
        relatimeWindowMs: day,
        nowMs: 10_000,
      }),
    ).toBe(true);
  });

  it('returns true when atime is outside relatime window', () => {
    const now = 10_000_000;
    expect(
      shouldRestoreSourceAtimeRelatime({
        atimeMs: now - 2 * day,
        mtimeMs: now - 3 * day,
        ctimeMs: now - 3 * day,
        relatimeWindowMs: day,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it('returns false when none of the relatime triggers apply', () => {
    const now = 10_000_000;
    expect(
      shouldRestoreSourceAtimeRelatime({
        atimeMs: now - 3600000,
        mtimeMs: now - 7200000,
        ctimeMs: now - 7200000,
        relatimeWindowMs: day,
        nowMs: now,
      }),
    ).toBe(false);
  });
});

describe('errno helpers', () => {
  it('detects EINVAL as capability-style open failure', () => {
    expect(isErrnoCode({ code: 'EINVAL' }, 'EINVAL')).toBe(true);
    expect(isNoatimeOpenCapabilityError({ code: 'EINVAL' })).toBe(true);
  });
});

describe('atimeKernelGuaranteed', () => {
  it('is true when mount noatime is in effect, regardless of per-file outcome', () => {
    expect(
      atimeKernelGuaranteed({
        atimeReadStrategy: ATIME_DIAG.STRATEGY_2_FALLBACK_STD_SAME_FILE,
        mountNoatimeApplied: true,
      }),
    ).toBe(true);
    expect(
      atimeKernelGuaranteed({
        atimeReadStrategy: undefined,
        mountNoatimeApplied: true,
      }),
    ).toBe(true);
  });

  it('is true when per-file Strategy 2 O_NOATIME succeeded', () => {
    expect(
      atimeKernelGuaranteed({
        atimeReadStrategy: ATIME_DIAG.STRATEGY_2_O_NOATIME,
        mountNoatimeApplied: false,
      }),
    ).toBe(true);
  });

  it('is false for Strategy 2 fallbacks without an active mount-noatime', () => {
    for (const label of [
      ATIME_DIAG.STRATEGY_2_FALLBACK_STD_SAME_FILE,
      ATIME_DIAG.STRATEGY_2_FALLBACK_STD_SESSION,
      ATIME_DIAG.STRATEGY_2_KERNEL_NO_FLAG,
      ATIME_DIAG.STRATEGY_2_SESSION_SKIP,
    ]) {
      expect(
        atimeKernelGuaranteed({
          atimeReadStrategy: label,
          mountNoatimeApplied: false,
        }),
      ).toBe(false);
    }
  });

  it('is false for Windows SMB read fallback (Strategy 1 partial) — atime was bumped', () => {
    expect(
      atimeKernelGuaranteed({
        atimeReadStrategy: ATIME_DIAG.WIN_READ_STAMP_FALLBACK,
        mountNoatimeApplied: false,
      }),
    ).toBe(false);
  });

  it('is false when nothing is known about the read path', () => {
    expect(
      atimeKernelGuaranteed({
        atimeReadStrategy: undefined,
        mountNoatimeApplied: false,
      }),
    ).toBe(false);
  });
});
