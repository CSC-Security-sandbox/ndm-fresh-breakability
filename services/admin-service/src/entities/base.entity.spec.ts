import { Base } from './base.entity';

describe('Base Entity', () => {
  let base: Base;

  beforeEach(() => {
    base = new Base();
  });

  it('should set created_by and updated_by when created_by is not set', () => {
    const userId = 'test-user-id';
    base.populateWhoColumns(userId);

    expect(base.created_by).toBe(userId);
    expect(base.updated_by).toBe(userId);
  });

  it('should only set updated_by when created_by is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    base.created_by = initialUserId;

    base.populateWhoColumns(newUserId);

    expect(base.created_by).toBe(initialUserId);
    expect(base.updated_by).toBe(newUserId);
  });

  it('should not change created_by if it is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    base.created_by = initialUserId;

    base.populateWhoColumns(newUserId);

    expect(base.created_by).toBe(initialUserId);
  });
});
