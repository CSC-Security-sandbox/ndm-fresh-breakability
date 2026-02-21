import { UpgradeBundle } from './upgrade-bundle.entity';

describe('UpgradeBundle Entity', () => {
  let bundle: UpgradeBundle;

  beforeEach(() => {
    bundle = new UpgradeBundle();
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
});
