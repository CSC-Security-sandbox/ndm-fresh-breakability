import {
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
