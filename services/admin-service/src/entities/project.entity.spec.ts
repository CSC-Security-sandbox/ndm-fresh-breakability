import { Project } from './project.entity';
import { Account } from './account.entity';
import { UserRole } from './user-role.entity';

describe('Project Entity', () => {
  let project: Project;

  beforeEach(() => {
    project = new Project();
  });

  it('should set created_by and updated_by when created_by is not set', () => {
    const userId = 'test-user-id';
    project.populateWhoColumns(userId);

    expect(project.created_by).toBe(userId);
    expect(project.updated_by).toBe(userId);
  });

  it('should only set updated_by when created_by is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    project.created_by = initialUserId;

    project.populateWhoColumns(newUserId);

    expect(project.created_by).toBe(initialUserId);
    expect(project.updated_by).toBe(newUserId);
  });

  it('should not change created_by if it is already set', () => {
    const initialUserId = 'initial-user-id';
    const newUserId = 'new-user-id';
    project.created_by = initialUserId;

    project.populateWhoColumns(newUserId);

    expect(project.created_by).toBe(initialUserId);
  });

  it('should allow setting project_name', () => {
    const projectName = 'Test Project';
    project.project_name = projectName;

    expect(project.project_name).toBe(projectName);
  });

  it('should allow setting start_date', () => {
    const startDate = new Date('2024-09-15');
    project.start_date = startDate;

    expect(project.start_date).toBe(startDate);
  });

  it('should allow setting account relation', () => {
    const account = new Account();
    project.account = account;

    expect(project.account).toBe(account);
  });

  it('should allow adding user_roles', () => {
    const userRole = new UserRole();
    project.user_roles = [userRole];

    expect(project.user_roles).toContain(userRole);
  });
});
