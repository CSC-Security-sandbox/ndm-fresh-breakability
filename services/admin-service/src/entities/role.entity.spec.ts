import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';
import { UserRole } from './user-role.entity';

describe('Role Entity', () => {
  let role: Role;

  beforeEach(() => {
    role = new Role();
  });

  it('should set created_by and updated_by when created_by is not set', () => {
    const userId = 'test-user-id';
    role.populateWhoColumns(userId);

    expect(role.created_by).toBe(userId);
    expect(role.updated_by).toBe(userId);
  });

  it('should only set updated_by when created_by is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    role.created_by = initialUserId;

    role.populateWhoColumns(newUserId);

    expect(role.created_by).toBe(initialUserId);
    expect(role.updated_by).toBe(newUserId);
  });

  it('should not change created_by if it is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    role.created_by = initialUserId;

    role.populateWhoColumns(newUserId);

    expect(role.created_by).toBe(initialUserId);
  });

  it('should allow setting the role_name and role_status', () => {
    role.role_name = 'Admin';
    role.role_status = 'Active';

    expect(role.role_name).toBe('Admin');
    expect(role.role_status).toBe('Active');
  });

  it('should allow adding user_roles', () => {
    const userRole1 = new UserRole();
    const userRole2 = new UserRole();

    role.user_roles = [userRole1, userRole2];

    expect(role.user_roles.length).toBe(2);
    expect(role.user_roles).toContain(userRole1);
    expect(role.user_roles).toContain(userRole2);
  });

  it('should allow adding role_permissions', () => {
    const rolePermission1 = new RolePermission();
    const rolePermission2 = new RolePermission();

    role.role_permissions = [rolePermission1, rolePermission2];

    expect(role.role_permissions.length).toBe(2);
    expect(role.role_permissions).toContain(rolePermission1);
    expect(role.role_permissions).toContain(rolePermission2);
  });
});
