import { UserRole } from './user-role.entity';
import { User } from './user.entity';
import { Role } from './role.entity';
import { Project } from './project.entity';
import { Account } from './account.entity';

describe('UserRole Entity', () => {
  let userRole: UserRole;

  beforeEach(() => {
    userRole = new UserRole();
  });

  it('should set created_by and updated_by when created_by is not set', () => {
    const userId = 'test-user-id';
    userRole.populateWhoColumns(userId);

    expect(userRole.created_by).toBe(userId);
    expect(userRole.updated_by).toBe(userId);
  });

  it('should only set updated_by when created_by is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    userRole.created_by = initialUserId;

    userRole.populateWhoColumns(newUserId);

    expect(userRole.created_by).toBe(initialUserId);
    expect(userRole.updated_by).toBe(newUserId);
  });

  it('should not change created_by if it is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    userRole.created_by = initialUserId;

    userRole.populateWhoColumns(newUserId);

    expect(userRole.created_by).toBe(initialUserId);
  });

  it('should allow setting the user relation', () => {
    const user = new User();
    userRole.user = user;

    expect(userRole.user).toBe(user);
  });

  it('should allow setting the role relation', () => {
    const role = new Role();
    userRole.role = role;

    expect(userRole.role).toBe(role);
  });

  it('should allow setting the project relation', () => {
    const project = new Project();
    userRole.project = project;

    expect(userRole.project).toBe(project);
  });

  it('should allow setting the account relation', () => {
    const account = new Account();
    userRole.account = account;

    expect(userRole.account).toBe(account);
  });

  it('should allow setting project as null', () => {
    userRole.project = null;

    expect(userRole.project).toBeNull();
  });
});
