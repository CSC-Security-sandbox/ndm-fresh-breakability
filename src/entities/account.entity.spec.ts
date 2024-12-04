import { Account } from './account.entity';
import { Project } from './project.entity';
import { UserRole } from './user-role.entity';

describe('Account Entity', () => {
  let account: Account;

  beforeEach(() => {
    account = new Account();
  });

  it('should set created_by and updated_by when created_by is not set', () => {
    const userId = 'test-user-id';
    account.populateWhoColumns(userId);

    expect(account.created_by).toBe(userId);
    expect(account.updated_by).toBe(userId);
  });

  it('should only set updated_by when created_by is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    account.created_by = initialUserId;

    account.populateWhoColumns(newUserId);

    expect(account.created_by).toBe(initialUserId);
    expect(account.updated_by).toBe(newUserId);
  });

  it('should not change created_by if it is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    account.created_by = initialUserId;

    account.populateWhoColumns(newUserId);

    expect(account.created_by).toBe(initialUserId);
  });

  it('should allow setting account_name', () => {
    const accountName = 'Test Account';
    account.account_name = accountName;

    expect(account.account_name).toBe(accountName);
  });

  it('should allow adding user_roles', () => {
    const userRole = new UserRole();
    account.user_roles = [userRole];

    expect(account.user_roles).toContain(userRole);
  });

  it('should allow adding projects', () => {
    const project = new Project();
    account.projects = [project];

    expect(account.projects).toContain(project);
  });
});
