import { Serializable } from './serializable';

class TestSerializable implements Serializable {
  serialize(): string {
    return 'test';
  }
}

describe('Serializable Interface', () => {
  it('should serialize correctly', () => {
    const instance = new TestSerializable();
    expect(instance.serialize()).toBe('test');
  });
});
