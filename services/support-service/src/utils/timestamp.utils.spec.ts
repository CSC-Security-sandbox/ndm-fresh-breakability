import { formatUnixTimestamp } from './timestamp.utils';

describe('timestamp.utils', () => {
  describe('formatUnixTimestamp', () => {
    it('should format valid Unix timestamp (number) to readable date string', () => {
      // Unix timestamp for August 9, 2025, 7:25:00 AM (approx)
      const timestamp = 1754844300; // This would be around August 2025
      const result = formatUnixTimestamp(timestamp);

      // Check that result is a string and contains expected patterns
      expect(typeof result).toBe('string');
      expect(result).toMatch(/\d{4}/); // Should contain a year
    });

    it('should format valid Unix timestamp (string) to readable date string', () => {
      const timestamp = '1754844300';
      const result = formatUnixTimestamp(timestamp);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/\d{4}/); // Should contain a year
    });

    it('should handle zero timestamp', () => {
      const result = formatUnixTimestamp(0);

      expect(typeof result).toBe('string');
      // Zero timestamp should format to January 1, 1970
      expect(result).toContain('1970');
    });

    it('should handle string zero timestamp', () => {
      const result = formatUnixTimestamp('0');

      expect(typeof result).toBe('string');
      expect(result).toContain('1970');
    });

    it('should handle invalid string timestamp and return original value', () => {
      const invalidTimestamp = 'invalid-timestamp';

      // Mock console.warn to avoid noise in tests
      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const result = formatUnixTimestamp(invalidTimestamp);

      expect(result).toBe('invalid-timestamp');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to convert timestamp invalid-timestamp:',
        ),
      );

      consoleSpy.mockRestore();
    });

    it('should handle empty string timestamp', () => {
      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const result = formatUnixTimestamp('');

      expect(result).toBe('');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to convert timestamp :'),
      );

      consoleSpy.mockRestore();
    });

    it('should handle NaN number timestamp', () => {
      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const result = formatUnixTimestamp(NaN);

      expect(result).toBe('NaN');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to convert timestamp NaN:'),
      );

      consoleSpy.mockRestore();
    });

    it('should handle negative timestamp', () => {
      const result = formatUnixTimestamp(-1000);

      expect(typeof result).toBe('string');
      // Negative timestamps should still format (dates before 1970)
      expect(result).toMatch(/\d{4}/);
    });

    it('should handle very large timestamp', () => {
      const largeTimestamp = 9999999999; // Far future timestamp
      const result = formatUnixTimestamp(largeTimestamp);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/\d{4}/);
    });

    it('should handle fractional timestamp string', () => {
      const fractionalTimestamp = '1754844300.123';
      const result = formatUnixTimestamp(fractionalTimestamp);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/\d{4}/);
    });

    it('should format timestamp using Indian locale', () => {
      const timestamp = 1691539200; // August 9, 2023
      const result = formatUnixTimestamp(timestamp);

      expect(typeof result).toBe('string');
      // Should use Indian date format (en-IN locale)
      expect(result).toMatch(/\d{4}/);
      // The format should include time component
      expect(result.toLowerCase()).toMatch(/(am|pm)/);
    });

    it('should handle undefined input by throwing error', () => {
      expect(() => {
        formatUnixTimestamp(undefined as any);
      }).toThrow();
    });

    it('should handle null input as zero timestamp', () => {
      // null gets converted to 0 by parseFloat, which is a valid timestamp (Jan 1, 1970)
      const result = formatUnixTimestamp(null as any);

      expect(typeof result).toBe('string');
      expect(result).toContain('1970');
    });
  });
});
