import { Permission } from './permission.entity';
import { RolePermission } from './role-permission.entity';

describe('Permission Entity', () => {
  let permission: Permission;

  beforeEach(() => {
    permission = new Permission();
  });

  it('should set created_by and updated_by when created_by is not set', () => {
    const userId = 'test-user-id';
    permission.populateWhoColumns(userId);

    expect(permission.created_by).toBe(userId);
    expect(permission.updated_by).toBe(userId);
  });

  it('should only set updated_by when created_by is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    permission.created_by = initialUserId;

    permission.populateWhoColumns(newUserId);

    expect(permission.created_by).toBe(initialUserId);
    expect(permission.updated_by).toBe(newUserId);
  });

  it('should not change created_by if it is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    permission.created_by = initialUserId;

    permission.populateWhoColumns(newUserId);

    expect(permission.created_by).toBe(initialUserId);
  });

  it('should allow setting permission_name', () => {
    const permissionName = 'Test Permission';
    permission.permission_name = permissionName;

    expect(permission.permission_name).toBe(permissionName);
  });

  it('should allow setting permission_status', () => {
    const permissionStatus = 'ACTIVE';
    permission.permission_status = permissionStatus;

    expect(permission.permission_status).toBe(permissionStatus);
  });

  it('should allow adding role_permissions', () => {
    const rolePermission = new RolePermission();
    permission.role_permissions = [rolePermission];

    expect(permission.role_permissions).toContain(rolePermission);
  });
});
