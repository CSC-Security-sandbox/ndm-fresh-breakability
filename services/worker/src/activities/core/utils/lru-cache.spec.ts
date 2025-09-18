import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  describe('Constructor', () => {
    it('should create cache with specified capacity', () => {
      const cache = new LRUCache(3);

      expect(cache).toBeDefined();
      expect(cache).toBeInstanceOf(LRUCache);
    });

    it('should create cache with capacity of 1', () => {
      const cache = new LRUCache(1);

      expect(cache).toBeDefined();
      expect(cache).toBeInstanceOf(LRUCache);
    });

    it('should create cache with large capacity', () => {
      const cache = new LRUCache(1000);

      expect(cache).toBeDefined();
      expect(cache).toBeInstanceOf(LRUCache);
    });

    it('should create cache with capacity of 0', () => {
      const cache = new LRUCache(0);

      expect(cache).toBeDefined();
      expect(cache).toBeInstanceOf(LRUCache);
    });
  });

  describe('get method', () => {
    let cache: LRUCache;

    beforeEach(() => {
      cache = new LRUCache(3);
    });

    it('should return null for non-existent key', () => {
      const result = cache.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for empty cache', () => {
      const result = cache.get('key1');

      expect(result).toBeNull();
    });

    it('should return value for existing key', () => {
      cache.put('key1', 'value1');

      const result = cache.get('key1');

      expect(result).toBe('value1');
    });

    it('should move accessed item to end (most recently used)', () => {
      cache.put('key1', 'value1');
      cache.put('key2', 'value2');
      cache.put('key3', 'value3');

      // Access key1 to move it to end
      cache.get('key1');

      // Add key4 which should evict key2 (since key1 was moved to end)
      cache.put('key4', 'value4');

      expect(cache.get('key1')).toBe('value1'); // Still exists
      expect(cache.get('key2')).toBeNull(); // Evicted
      expect(cache.get('key3')).toBe('value3'); // Still exists
      expect(cache.get('key4')).toBe('value4'); // Newly added
    });

    it('should handle accessing same key multiple times', () => {
      cache.put('key1', 'value1');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined value correctly', () => {
      cache.put('key1', 'undefined');

      const result = cache.get('key1');

      expect(result).toBe('undefined');
    });

    it('should handle empty string keys', () => {
      cache.put('', 'empty-key-value');

      const result = cache.get('');

      expect(result).toBe('empty-key-value');
    });

    it('should handle empty string values', () => {
      cache.put('key1', '');

      const result = cache.get('key1');

      expect(result).toBe('');
    });

    it('should handle special character keys', () => {
      const specialKey = 'key-with-special-chars: àáâãäåæç 中文 🚀 \n\t\r';
      cache.put(specialKey, 'special-value');

      const result = cache.get(specialKey);

      expect(result).toBe('special-value');
    });
  });

  describe('put method', () => {
    let cache: LRUCache;

    beforeEach(() => {
      cache = new LRUCache(3);
    });

    it('should add new key-value pair', () => {
      cache.put('key1', 'value1');

      expect(cache.get('key1')).toBe('value1');
    });

    it('should update existing key with new value', () => {
      cache.put('key1', 'value1');
      cache.put('key1', 'updated-value');

      expect(cache.get('key1')).toBe('updated-value');
    });

    it('should update existing key and move to end', () => {
      cache.put('key1', 'value1');
      cache.put('key2', 'value2');
      cache.put('key3', 'value3');

      // Update key1 (should move to end)
      cache.put('key1', 'updated-value1');

      // Add key4 which should evict key2 (since key1 was moved to end)
      cache.put('key4', 'value4');

      expect(cache.get('key1')).toBe('updated-value1'); // Updated and still exists
      expect(cache.get('key2')).toBeNull(); // Evicted
      expect(cache.get('key3')).toBe('value3'); // Still exists
      expect(cache.get('key4')).toBe('value4'); // Newly added
    });

    it('should evict oldest item when capacity is exceeded', () => {
      cache.put('key1', 'value1');
      cache.put('key2', 'value2');
      cache.put('key3', 'value3');

      // This should evict key1 (oldest)
      cache.put('key4', 'value4');

      expect(cache.get('key1')).toBeNull(); // Evicted
      expect(cache.get('key2')).toBe('value2'); // Still exists
      expect(cache.get('key3')).toBe('value3'); // Still exists
      expect(cache.get('key4')).toBe('value4'); // Newly added
    });

    it('should handle multiple evictions correctly', () => {
      cache.put('key1', 'value1');
      cache.put('key2', 'value2');
      cache.put('key3', 'value3');
      cache.put('key4', 'value4'); // Evicts key1
      cache.put('key5', 'value5'); // Evicts key2

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
      expect(cache.get('key5')).toBe('value5');
    });

    it('should handle capacity of 1', () => {
      const smallCache = new LRUCache(1);

      smallCache.put('key1', 'value1');
      expect(smallCache.get('key1')).toBe('value1');

      smallCache.put('key2', 'value2'); // Should evict key1
      expect(smallCache.get('key1')).toBeNull();
      expect(smallCache.get('key2')).toBe('value2');
    });

    it('should handle capacity of 0', () => {
      const zeroCache = new LRUCache(0);

      zeroCache.put('key1', 'value1');

      // With capacity 0, the item is stored but immediately becomes evictable
      // The current implementation allows storage but next put will evict
      expect(zeroCache.get('key1')).toBe('value1');

      // Adding another item should evict the first
      zeroCache.put('key2', 'value2');
      expect(zeroCache.get('key1')).toBeNull();
      expect(zeroCache.get('key2')).toBe('value2');
    });

    it('should handle empty string keys and values', () => {
      cache.put('', '');

      expect(cache.get('')).toBe('');
    });

    it('should handle numeric-like string values', () => {
      cache.put('key1', '123');
      cache.put('key2', '0');
      cache.put('key3', '-456');

      expect(cache.get('key1')).toBe('123');
      expect(cache.get('key2')).toBe('0');
      expect(cache.get('key3')).toBe('-456');
    });

    it('should handle long strings', () => {
      const longKey = 'a'.repeat(1000);
      const longValue = 'b'.repeat(2000);

      cache.put(longKey, longValue);

      expect(cache.get(longKey)).toBe(longValue);
    });
  });

  describe('Integration scenarios', () => {
    it('should maintain LRU order with mixed operations', () => {
      const cache = new LRUCache(3);

      // Fill cache
      cache.put('a', '1');
      cache.put('b', '2');
      cache.put('c', '3');

      // Access 'a' to make it most recent
      expect(cache.get('a')).toBe('1');

      // Update 'b' to make it most recent
      cache.put('b', '2-updated');

      // Add new item, should evict 'c' (least recent)
      cache.put('d', '4');

      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBe('2-updated');
      expect(cache.get('c')).toBeNull(); // Evicted
      expect(cache.get('d')).toBe('4');
    });

    it('should handle alternating get and put operations', () => {
      const cache = new LRUCache(2);

      cache.put('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');

      cache.put('key2', 'value2');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key1')).toBe('value1'); // Move key1 to end

      cache.put('key3', 'value3'); // Should evict key2
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key3')).toBe('value3');
    });

    it('should handle updating all keys in cache', () => {
      const cache = new LRUCache(3);

      cache.put('a', '1');
      cache.put('b', '2');
      cache.put('c', '3');

      // Update all keys
      cache.put('a', 'updated-1');
      cache.put('b', 'updated-2');
      cache.put('c', 'updated-3');

      expect(cache.get('a')).toBe('updated-1');
      expect(cache.get('b')).toBe('updated-2');
      expect(cache.get('c')).toBe('updated-3');
    });

    it('should handle accessing non-existent keys between operations', () => {
      const cache = new LRUCache(2);

      cache.put('key1', 'value1');
      expect(cache.get('nonexistent')).toBeNull();

      cache.put('key2', 'value2');
      expect(cache.get('another-nonexistent')).toBeNull();

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
    });
  });

  describe('Edge cases and stress testing', () => {
    it('should handle rapid successive operations', () => {
      const cache = new LRUCache(5);

      // Rapid puts
      for (let i = 0; i < 10; i++) {
        cache.put(`key${i}`, `value${i}`);
      }

      // Should only have last 5 items
      for (let i = 0; i < 5; i++) {
        expect(cache.get(`key${i}`)).toBeNull();
      }
      for (let i = 5; i < 10; i++) {
        expect(cache.get(`key${i}`)).toBe(`value${i}`);
      }
    });

    it('should handle same key operations repeatedly', () => {
      const cache = new LRUCache(3);

      // Multiple operations on same key
      cache.put('key', 'value1');
      cache.put('key', 'value2');
      expect(cache.get('key')).toBe('value2');
      cache.put('key', 'value3');
      expect(cache.get('key')).toBe('value3');
    });

    it('should maintain integrity with complex access patterns', () => {
      const cache = new LRUCache(4);

      // Complex pattern: put, get, update, evict
      cache.put('a', '1');
      cache.put('b', '2');
      cache.put('c', '3');
      cache.put('d', '4');

      // Access pattern that changes LRU order
      cache.get('a'); // a becomes most recent
      cache.get('c'); // c becomes most recent
      cache.put('b', '2-updated'); // b becomes most recent

      // Add new item - should evict 'd' (least recent)
      cache.put('e', '5');

      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBe('2-updated');
      expect(cache.get('c')).toBe('3');
      expect(cache.get('d')).toBeNull(); // Evicted
      expect(cache.get('e')).toBe('5');
    });

    it('should handle cache with very large strings', () => {
      const cache = new LRUCache(2);
      const largeValue = 'x'.repeat(10000);

      cache.put('large1', largeValue);
      cache.put('large2', largeValue);

      expect(cache.get('large1')).toBe(largeValue);
      expect(cache.get('large2')).toBe(largeValue);

      // Add third item to test eviction with large strings
      cache.put('large3', largeValue);

      expect(cache.get('large1')).toBeNull(); // Evicted
      expect(cache.get('large2')).toBe(largeValue);
      expect(cache.get('large3')).toBe(largeValue);
    });

    it('should handle keys with unusual characters', () => {
      const cache = new LRUCache(3);

      const keys = [
        'key with spaces',
        'key\nwith\nnewlines',
        'key\twith\ttabs',
        'key"with"quotes',
        "key'with'apostrophes",
        'key\\with\\backslashes',
        'key/with/slashes',
        'key.with.dots',
        'key,with,commas',
        'key;with;semicolons',
      ];

      keys.forEach((key, index) => {
        cache.put(key, `value${index}`);
        expect(cache.get(key)).toBe(`value${index}`);
      });
    });
  });

  describe('Capacity boundary testing', () => {
    it('should work correctly at exact capacity', () => {
      const cache = new LRUCache(3);

      cache.put('a', '1');
      cache.put('b', '2');
      cache.put('c', '3');

      // All should be accessible
      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBe('2');
      expect(cache.get('c')).toBe('3');
    });

    it('should evict correctly when exceeding capacity by one', () => {
      const cache = new LRUCache(3);

      cache.put('a', '1');
      cache.put('b', '2');
      cache.put('c', '3');
      cache.put('d', '4'); // Should evict 'a'

      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBe('2');
      expect(cache.get('c')).toBe('3');
      expect(cache.get('d')).toBe('4');
    });

    it('should handle negative capacity gracefully', () => {
      const cache = new LRUCache(-1);

      cache.put('key', 'value');

      // With negative capacity, the size >= capacity check is always true
      // The implementation still allows storage
      expect(cache.get('key')).toBe('value');

      // Adding another item should evict previous ones
      cache.put('key2', 'value2');
      expect(cache.get('key')).toBeNull(); // Evicted due to negative capacity
      expect(cache.get('key2')).toBe('value2');
    });
  });
});
