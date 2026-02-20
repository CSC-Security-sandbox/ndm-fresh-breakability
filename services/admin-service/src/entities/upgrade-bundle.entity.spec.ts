import { UpgradeBundle } from './upgrade-bundle.entity';
import { UploadStatus, UpgradeStatus } from '../upgrade/enums/upgrade.enums';

describe('UpgradeBundle Entity', () => {
  let bundle: UpgradeBundle;

  beforeEach(() => {
    bundle = new UpgradeBundle();
  });

  // ═══════════════════════════════════════════════════════════════
  // BASIC PROPERTY TESTS
  // ═══════════════════════════════════════════════════════════════
  describe('basic properties', () => {
    it('should allow setting id', () => {
      bundle.id = 'test-uuid-123';
      expect(bundle.id).toBe('test-uuid-123');
    });

    it('should allow setting fileName', () => {
      bundle.fileName = 'upgrade-v2.1.0.tar.gz';
      expect(bundle.fileName).toBe('upgrade-v2.1.0.tar.gz');
    });

    // Note: filePath property removed - deploy path is derived from version: /upload/upgrade-${version}

    it('should allow setting fileSize', () => {
      bundle.fileSize = 1024 * 1024 * 100;
      expect(bundle.fileSize).toBe(104857600);
    });

    it('should allow setting version', () => {
      bundle.version = 'v2.1.0';
      expect(bundle.version).toBe('v2.1.0');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // UPLOAD STATUS TESTS
  // ═══════════════════════════════════════════════════════════════
  describe('uploadStatus', () => {
    it('should allow setting uploadStatus to UPLOADING', () => {
      bundle.uploadStatus = UploadStatus.UPLOADING;
      expect(bundle.uploadStatus).toBe(UploadStatus.UPLOADING);
    });

    it('should allow setting uploadStatus to SUCCESS', () => {
      bundle.uploadStatus = UploadStatus.SUCCESS;
      expect(bundle.uploadStatus).toBe(UploadStatus.SUCCESS);
    });

    it('should allow setting uploadStatus to FAILED', () => {
      bundle.uploadStatus = UploadStatus.FAILED;
      expect(bundle.uploadStatus).toBe(UploadStatus.FAILED);
    });

    it('should allow setting uploadStatus to CANCELLED', () => {
      bundle.uploadStatus = UploadStatus.CANCELLED;
      expect(bundle.uploadStatus).toBe(UploadStatus.CANCELLED);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // UPGRADE STATUS TESTS
  // ═══════════════════════════════════════════════════════════════
  describe('upgradeStatus', () => {
    it('should allow setting upgradeStatus to PENDING', () => {
      bundle.upgradeStatus = UpgradeStatus.PENDING;
      expect(bundle.upgradeStatus).toBe(UpgradeStatus.PENDING);
    });

    it('should allow setting upgradeStatus to IN_PROGRESS', () => {
      bundle.upgradeStatus = UpgradeStatus.IN_PROGRESS;
      expect(bundle.upgradeStatus).toBe(UpgradeStatus.IN_PROGRESS);
    });

    it('should allow setting upgradeStatus to SUCCESS', () => {
      bundle.upgradeStatus = UpgradeStatus.SUCCESS;
      expect(bundle.upgradeStatus).toBe(UpgradeStatus.SUCCESS);
    });

    it('should allow setting upgradeStatus to FAILED', () => {
      bundle.upgradeStatus = UpgradeStatus.FAILED;
      expect(bundle.upgradeStatus).toBe(UpgradeStatus.FAILED);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TIMESTAMP TESTS
  // ═══════════════════════════════════════════════════════════════
  describe('timestamps', () => {
    it('should allow setting uploadStartedAt', () => {
      const date = new Date();
      bundle.uploadStartedAt = date;
      expect(bundle.uploadStartedAt).toBe(date);
    });

    it('should allow setting uploadCompletedAt', () => {
      const date = new Date();
      bundle.uploadCompletedAt = date;
      expect(bundle.uploadCompletedAt).toBe(date);
    });

    it('should allow setting upgradeCompletedAt', () => {
      const date = new Date();
      bundle.upgradeCompletedAt = date;
      expect(bundle.upgradeCompletedAt).toBe(date);
    });

    it('should handle null timestamps', () => {
      bundle.uploadCompletedAt = null;
      bundle.upgradeCompletedAt = null;
      expect(bundle.uploadCompletedAt).toBeNull();
      expect(bundle.upgradeCompletedAt).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // USER TRACKING TESTS
  // ═══════════════════════════════════════════════════════════════
  describe('user tracking', () => {
    it('should allow setting uploadedBy', () => {
      bundle.uploadedBy = 'user-uuid-123';
      expect(bundle.uploadedBy).toBe('user-uuid-123');
    });

    it('should allow setting upgradedBy', () => {
      bundle.upgradedBy = 'user-uuid-456';
      expect(bundle.upgradedBy).toBe('user-uuid-456');
    });

    it('should handle null user fields', () => {
      bundle.uploadedBy = null;
      bundle.upgradedBy = null;
      expect(bundle.uploadedBy).toBeNull();
      expect(bundle.upgradedBy).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // BASE ENTITY INHERITED TESTS
  // ═══════════════════════════════════════════════════════════════
  describe('base entity properties', () => {
    it('should inherit populateWhoColumns from Base', () => {
      expect(bundle.populateWhoColumns).toBeDefined();
      expect(typeof bundle.populateWhoColumns).toBe('function');
    });

    it('should set created_by and updated_by when created_by is not set', () => {
      const userId = 'test-user-id';
      bundle.populateWhoColumns(userId);

      expect(bundle.created_by).toBe(userId);
      expect(bundle.updated_by).toBe(userId);
    });

    it('should only set updated_by when created_by is already set', () => {
      const initialUserId = 'initial-user-id';
      const newUserId = 'new-user-id';
      bundle.created_by = initialUserId;

      bundle.populateWhoColumns(newUserId);

      expect(bundle.created_by).toBe(initialUserId);
      expect(bundle.updated_by).toBe(newUserId);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // COMPLETE BUNDLE STATE TESTS
  // ═══════════════════════════════════════════════════════════════
  describe('complete bundle states', () => {
    it('should represent an uploading bundle correctly', () => {
      bundle.id = 'bundle-123';
      bundle.fileName = 'upgrade-v2.1.0.tar.gz';
      bundle.fileSize = 1024 * 1024 * 100;
      bundle.uploadStatus = UploadStatus.UPLOADING;
      bundle.upgradeStatus = UpgradeStatus.PENDING;
      bundle.uploadStartedAt = new Date();
      bundle.uploadedBy = 'user-123';

      expect(bundle.uploadStatus).toBe(UploadStatus.UPLOADING);
      expect(bundle.upgradeStatus).toBe(UpgradeStatus.PENDING);
      expect(bundle.uploadCompletedAt).toBeUndefined();
    });

    it('should represent a successfully uploaded bundle ready for upgrade', () => {
      bundle.id = 'bundle-123';
      bundle.fileName = 'upgrade-v2.1.0.tar.gz';
      // Note: filePath removed - deploy path derived from version: /upload/upgrade-${version}
      bundle.fileSize = 1024 * 1024 * 100;
      bundle.version = 'v2.1.0';
      bundle.uploadStatus = UploadStatus.SUCCESS;
      bundle.upgradeStatus = UpgradeStatus.PENDING;
      bundle.uploadStartedAt = new Date('2024-01-01T10:00:00Z');
      bundle.uploadCompletedAt = new Date('2024-01-01T10:05:00Z');
      bundle.uploadedBy = 'user-123';

      expect(bundle.uploadStatus).toBe(UploadStatus.SUCCESS);
      expect(bundle.upgradeStatus).toBe(UpgradeStatus.PENDING);
      expect(bundle.uploadCompletedAt).toBeDefined();
    });

    it('should represent a fully completed upgrade bundle', () => {
      bundle.id = 'bundle-123';
      bundle.fileName = 'upgrade-v2.1.0.tar.gz';
      // Note: filePath removed - deploy path derived from version: /upload/upgrade-${version}
      bundle.fileSize = 1024 * 1024 * 100;
      bundle.version = 'v2.1.0';
      bundle.uploadStatus = UploadStatus.SUCCESS;
      bundle.upgradeStatus = UpgradeStatus.SUCCESS;
      bundle.uploadStartedAt = new Date('2024-01-01T10:00:00Z');
      bundle.uploadCompletedAt = new Date('2024-01-01T10:05:00Z');
      bundle.upgradeCompletedAt = new Date('2024-01-01T10:10:00Z');
      bundle.uploadedBy = 'user-123';
      bundle.upgradedBy = 'user-456';

      expect(bundle.uploadStatus).toBe(UploadStatus.SUCCESS);
      expect(bundle.upgradeStatus).toBe(UpgradeStatus.SUCCESS);
      expect(bundle.uploadedBy).not.toBe(bundle.upgradedBy);
    });

    it('should represent a failed upload bundle', () => {
      bundle.id = 'bundle-123';
      bundle.fileName = 'upgrade-v2.1.0.tar.gz';
      bundle.fileSize = 1024 * 1024 * 100;
      bundle.uploadStatus = UploadStatus.FAILED;
      bundle.upgradeStatus = UpgradeStatus.PENDING;
      bundle.uploadStartedAt = new Date('2024-01-01T10:00:00Z');
      bundle.uploadCompletedAt = new Date('2024-01-01T10:05:00Z');

      expect(bundle.uploadStatus).toBe(UploadStatus.FAILED);
      expect(bundle.version).toBeUndefined(); // Version not set on failure
      // Note: filePath property removed from entity
    });
  });
});
