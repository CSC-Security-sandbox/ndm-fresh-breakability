import { calculateHash, calculateHashFast } from './checksum-utils';

describe('checksum-utils', () => {
  describe('calculateHash', () => {
    it('should calculate consistent hash for the same input', () => {
      const list = ['item1', 'item2', 'item3'];
      const hash1 = calculateHash(list);
      const hash2 = calculateHash(list);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 produces 64 hex characters
    });

    it('should produce the same hash regardless of input order', () => {
      const list1 = ['item1', 'item2', 'item3'];
      const list2 = ['item3', 'item1', 'item2'];
      const list3 = ['item2', 'item3', 'item1'];

      const hash1 = calculateHash(list1);
      const hash2 = calculateHash(list2);
      const hash3 = calculateHash(list3);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('should produce different hashes for different inputs', () => {
      const list1 = ['item1', 'item2', 'item3'];
      const list2 = ['item1', 'item2', 'item4'];

      const hash1 = calculateHash(list1);
      const hash2 = calculateHash(list2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty array', () => {
      const hash = calculateHash([]);

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle single item array', () => {
      const hash = calculateHash(['single-item']);

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle arrays with duplicate items', () => {
      const list1 = ['item1', 'item2', 'item2', 'item3'];
      const list2 = ['item2', 'item1', 'item3', 'item2'];

      const hash1 = calculateHash(list1);
      const hash2 = calculateHash(list2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('calculateHashFast', () => {
    it('should calculate hash for array of strings', () => {
      const list = ['item1', 'item2', 'item3'];
      const hash = calculateHashFast(list);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^-?[a-f0-9]+$/); // Hex string (may be negative)
    });

    it('should produce consistent results for same input', () => {
      const list = ['item1', 'item2', 'item3'];
      const hash1 = calculateHashFast(list);
      const hash2 = calculateHashFast(list);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const list1 = ['item1', 'item2', 'item3'];
      const list2 = ['item1', 'item2', 'item4'];

      const hash1 = calculateHashFast(list1);
      const hash2 = calculateHashFast(list2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty array', () => {
      const hash = calculateHashFast([]);

      expect(hash).toBeDefined();
      expect(hash).toBe('0'); // Empty array should result in hash of 0
    });

    it('should handle single item array', () => {
      const hash = calculateHashFast(['single-item']);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should handle arrays with special characters', () => {
      const list = ['item@1', 'item#2', 'item$3'];
      const hash = calculateHashFast(list);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should handle arrays with unicode characters', () => {
      const list = ['🚀', '💯', '🔥'];
      const hash = calculateHashFast(list);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should be different from calculateHash for same input', () => {
      const list = ['item1', 'item2', 'item3'];
      const hashSha = calculateHash(list);
      const hashFast = calculateHashFast(list);

      expect(hashSha).not.toBe(hashFast);
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      const list = [longString];
      const hash = calculateHashFast(list);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should handle large arrays', () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => `item${i}`);
      const hash = calculateHashFast(largeArray);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });
  });
});
