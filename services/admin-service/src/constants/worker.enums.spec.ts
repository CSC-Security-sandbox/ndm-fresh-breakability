import { UpgradeBundleStatus } from './worker.enums';

describe('UpgradeBundleStatus', () => {
  it('should have IDLE value', () => {
    expect(UpgradeBundleStatus.IDLE).toBe('IDLE');
  });

  it('should have IN_PROGRESS value', () => {
    expect(UpgradeBundleStatus.IN_PROGRESS).toBe('IN_PROGRESS');
  });

  it('should have COMPLETED value', () => {
    expect(UpgradeBundleStatus.COMPLETED).toBe('COMPLETED');
  });

  it('should have FAILED value', () => {
    expect(UpgradeBundleStatus.FAILED).toBe('FAILED');
  });

  it('should have exactly 4 values', () => {
    const values = Object.values(UpgradeBundleStatus);
    expect(values).toHaveLength(4);
    expect(values).toEqual(['IDLE', 'IN_PROGRESS', 'COMPLETED', 'FAILED']);
  });
});
