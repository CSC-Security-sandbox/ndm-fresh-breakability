import { formatBytes, JobUtils } from './job-utils';

describe('JobUtils', () => {
  describe('getRedisKey', () => {
    it('should concatenate jobRunId and key with a colon', () => {
      expect(JobUtils.getRedisKey('run123', 'status')).toBe('run123:status');
    });

    it('should handle empty jobRunId', () => {
      expect(JobUtils.getRedisKey('', 'key')).toBe(':key');
    });

    it('should handle empty key', () => {
      expect(JobUtils.getRedisKey('run123', '')).toBe('run123:');
    });

    it('should handle both jobRunId and key empty', () => {
      expect(JobUtils.getRedisKey('', '')).toBe(':');
    });
  });
});

describe('formatBytes', () => {
  it('should return "0 B" for 0', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format bytes to KiB', () => {
    expect(formatBytes(1024)).toBe('1 KiB');
  });

  it('should format bytes to MiB', () => {
    expect(formatBytes(1048576)).toBe('1 MiB');
  });

  it('should format bytes to GiB', () => {
    expect(formatBytes(1073741824)).toBe('1 GiB');
  });

  it('should format negative bytes as positive', () => {
    expect(formatBytes(-1024)).toBe('1 KiB');
  });

  it('should use custom decimals', () => {
    expect(formatBytes(1536, 1)).toBe('1.5 KiB');
    expect(formatBytes(1536, 3)).toBe('1.5 KiB');
  });

  it('should handle large numbers (TiB)', () => {
    expect(formatBytes(1099511627776)).toBe('1 TiB');
  });

  it('should handle values less than 1 KiB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
});