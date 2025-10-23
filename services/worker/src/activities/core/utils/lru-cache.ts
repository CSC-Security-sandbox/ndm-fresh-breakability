export class LRUCache {
    private capacity: number;
    private cache: Map<string, string>;
  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map<string, string>();
  }

  get(key: string): string | null {
    if (!this.cache.has(key)) {
      return null; 
    }
    const value = this.cache.get(key);
    // move up
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  put(key: string, value: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }
}