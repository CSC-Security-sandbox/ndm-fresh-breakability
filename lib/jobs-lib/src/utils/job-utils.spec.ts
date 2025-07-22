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
  it('should return "0 Bytes" for 0', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format bytes to KB', () => {
    expect(formatBytes(1024)).toBe('1.02 KB');
  });

  it('should format bytes to MB', () => {
    expect(formatBytes(1048576)).toBe('1.05 MB');
  });

  it('should format bytes to GB', () => {
    expect(formatBytes(1073741824)).toBe('1.07 GB');
  });

  it('should format negative bytes as positive', () => {
    expect(formatBytes(-1024)).toBe('1.02 KB');
  });

  it('should use custom decimals', () => {
    expect(formatBytes(1536, 1)).toBe('1.5 KB');
    expect(formatBytes(1536, 3)).toBe('1.536 KB');
  });

  it('should handle large numbers (TB)', () => {
    expect(formatBytes(1099511627776)).toBe('1.1 TB');
  });

  it('should handle values less than 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
});
