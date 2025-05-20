import { RolePermission } from './role-permission.entity';
import { Role } from './role.entity';
import { Permission } from './permission.entity';

describe('RolePermission Entity', () => {
  let rolePermission: RolePermission;

  beforeEach(() => {
    rolePermission = new RolePermission();
  });

  it('should set created_by and updated_by when created_by is not set', () => {
    const userId = 'test-user-id';
    rolePermission.populateWhoColumns(userId);

    expect(rolePermission.created_by).toBe(userId);
    expect(rolePermission.updated_by).toBe(userId);
  });

  it('should only set updated_by when created_by is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    rolePermission.created_by = initialUserId;

    rolePermission.populateWhoColumns(newUserId);

    expect(rolePermission.created_by).toBe(initialUserId);
    expect(rolePermission.updated_by).toBe(newUserId);
  });

  it('should not change created_by if it is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    rolePermission.created_by = initialUserId;

    rolePermission.populateWhoColumns(newUserId);

    expect(rolePermission.created_by).toBe(initialUserId);
  });

  it('should allow setting the role relation', () => {
    const role = new Role();
    rolePermission.role = role;

    expect(rolePermission.role).toBe(role);
  });

  it('should allow setting the permission relation', () => {
    const permission = new Permission();
    rolePermission.permission = permission;

    expect(rolePermission.permission).toBe(permission);
  });
});
