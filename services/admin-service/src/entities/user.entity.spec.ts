import { User } from './user.entity';
import { UserRole } from './user-role.entity';

describe('User Entity', () => {
  let user: User;

  beforeEach(() => {
    user = new User();
  });

  it('should set created_by and updated_by when created_by is not set', () => {
    const userId = 'test-user-id';
    user.populateWhoColumns(userId);

    expect(user.created_by).toBe(userId);
    expect(user.updated_by).toBe(userId);
  });

  it('should only set updated_by when created_by is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    user.created_by = initialUserId;

    user.populateWhoColumns(newUserId);

    expect(user.created_by).toBe(initialUserId);
    expect(user.updated_by).toBe(newUserId);
  });

  it('should not change created_by if it is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    user.created_by = initialUserId;

    user.populateWhoColumns(newUserId);

    expect(user.created_by).toBe(initialUserId);
  });

  it('should allow setting email', () => {
    const email = 'test@example.com';
    user.email = email;

    expect(user.email).toBe(email);
  });

  it('should allow setting first_name', () => {
    const firstName = 'John';
    user.first_name = firstName;

    expect(user.first_name).toBe(firstName);
  });

  it('should allow setting last_name', () => {
    const lastName = 'Doe';
    user.last_name = lastName;

    expect(user.last_name).toBe(lastName);
  });

  it('should allow setting user_status', () => {
    const userStatus = 'active';
    user.user_status = userStatus;

    expect(user.user_status).toBe(userStatus);
  });

  it('should compute full name from first_name and last_name', () => {
    user.first_name = 'John';
    user.last_name = 'Doe';

    expect(user.name).toBe('John Doe');
  });

  it('should allow adding user_roles', () => {
    const userRole = new UserRole();
    user.user_roles = [userRole];

    expect(user.user_roles).toContain(userRole);
  });

  it('should handle empty name gracefully', () => {
    user.first_name = '';
    user.last_name = '';

    expect(user.name).toBe('');
  });

  it('should handle undefined name fields gracefully', () => {
    user.first_name = undefined;
    user.last_name = undefined;

    expect(user.name).toBe('');
  });
});
