import { UploadStatus, UpgradeStatus } from './upgrade.enums';

describe('UploadStatus enum', () => {
  it('should have UPLOADING status', () => {
    expect(UploadStatus.UPLOADING).toBe('uploading');
  });

  it('should have PROCESSING status', () => {
    expect(UploadStatus.PROCESSING).toBe('processing');
  });

  it('should have SUCCESS status', () => {
    expect(UploadStatus.SUCCESS).toBe('success');
  });

  it('should have FAILED status', () => {
    expect(UploadStatus.FAILED).toBe('failed');
  });

  it('should have CANCELLED status', () => {
    expect(UploadStatus.CANCELLED).toBe('cancelled');
  });

  it('should have exactly 5 status values', () => {
    const statusValues = Object.values(UploadStatus);
    expect(statusValues.length).toBe(5);
  });
});

describe('UpgradeStatus enum', () => {
  it('should have PENDING status', () => {
    expect(UpgradeStatus.PENDING).toBe('pending');
  });

  it('should have IN_PROGRESS status', () => {
    expect(UpgradeStatus.IN_PROGRESS).toBe('in_progress');
  });

  it('should have SUCCESS status', () => {
    expect(UpgradeStatus.SUCCESS).toBe('success');
  });

  it('should have FAILED status', () => {
    expect(UpgradeStatus.FAILED).toBe('failed');
  });

  it('should have SKIPPED status', () => {
    expect(UpgradeStatus.SKIPPED).toBe('skipped');
  });

  it('should have exactly 5 status values', () => {
    const statusValues = Object.values(UpgradeStatus);
    expect(statusValues.length).toBe(5);
  });
});
