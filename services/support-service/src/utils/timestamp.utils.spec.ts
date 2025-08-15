import { formatUnixTimestamp } from './timestamp.utils';

describe('timestamp.utils', () => {
  describe('formatUnixTimestamp', () => {
    it('should format valid Unix timestamp as string', () => {
      const timestamp = '1691500000'; // August 8, 2023
      const result = formatUnixTimestamp(timestamp);

      expect(result).toMatch(/\w+,\s+\d+\s+\w+\s+\d+\s+at\s+\d+:\d+\s+[ap]m/);
    });

    it('should format valid Unix timestamp as number', () => {
      const timestamp = 1691500000; // August 8, 2023
      const result = formatUnixTimestamp(timestamp);

      expect(result).toMatch(/\w+,\s+\d+\s+\w+\s+\d+\s+at\s+\d+:\d+\s+[ap]m/);
    });

    it('should handle invalid timestamp gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const timestamp = 'invalid-timestamp';

      const result = formatUnixTimestamp(timestamp);

      expect(result).toBe('invalid-timestamp');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to convert timestamp invalid-timestamp:',
        ),
      );

      consoleSpy.mockRestore();
    });

    it('should handle zero timestamp', () => {
      const timestamp = 0;
      const result = formatUnixTimestamp(timestamp);

      expect(result).toMatch(/Thursday, 1 January 1970 at \d+:\d+\s+[ap]m/);
    });

    it('should handle negative timestamp', () => {
      const timestamp = -1;
      const result = formatUnixTimestamp(timestamp);

      expect(result).toMatch(/\w+,\s+\d+\s+\w+\s+\d+\s+at\s+\d+:\d+\s+[ap]m/);
    });

    it('should handle very large timestamp', () => {
      const timestamp = 9999999999; // Year 2286
      const result = formatUnixTimestamp(timestamp);

      expect(result).toMatch(/\w+,\s+\d+\s+\w+\s+\d+\s+at\s+\d+:\d+\s+[ap]m/);
    });
  });
});
