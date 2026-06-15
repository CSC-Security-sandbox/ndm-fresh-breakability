import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository, IsNull } from 'typeorm';
import { randomUUID } from 'crypto';
import { Project } from '../entities/project.entity';
import { UserService } from './user.service';
import { User } from '../entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Account } from '../entities/account.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory, resetLoggerMocks } from '../test-utils/logger-mocks';

function buildUserRoleMock(
  overrides: Omit<Partial<UserRole>, 'role'> & { role?: Partial<Role> } = {},
): UserRole {
  const { role: roleOverrides, ...rest } = overrides;
  const role = {
    role_name: '',
    ...roleOverrides,
  } as Role;
  return {
    userId: '',
    roleId: '',
    projectId: null,
    role,
    ...rest,
  } as UserRole;
}

describe('UserService', () => {
  let service: UserService;
  let userRepository: Repository<User>;
  let roleRepository: Repository<Role>;
  let userRoleRepository: Repository<UserRole>;
  let rolePermissionRepository: Repository<RolePermission>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findOneBy: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            remove: jest.fn(),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserRole),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Project),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Role),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RolePermission),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Account),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    roleRepository = module.get<Repository<Role>>(getRepositoryToken(Role));
    rolePermissionRepository = module.get<Repository<RolePermission>>(
      getRepositoryToken(RolePermission),
    );
    userRoleRepository = module.get<Repository<UserRole>>(
      getRepositoryToken(UserRole),
    );
  });

  const userPermissionResponseMock = {
    user: {
      roles: [
        {
          role_name: '',
          projects: [],
          permissions: [],
        },
      ],
      id: '6d4657c8-b19a-47b4-bb2e-bcef5865d4ca',
    },
  } as UserPermissionResponse;

  it('should create a user', async () => {
    const createUserDto = {
      email: 'test@example.com',
      first_name: '',
      last_name: '',
      user_status: 'active',
      password: 'password123',
      populateWhoColumns: jest.fn(),
    };

    const mockUser = {
      ...createUserDto,
      user_status: 'active',
      id: 'generated-user-id',
    };

    jest.spyOn(userRepository, 'create').mockReturnValue(mockUser as any);
    jest.spyOn(userRepository, 'save').mockResolvedValue(mockUser as any);

    const user = await service.create(
      createUserDto,
      userPermissionResponseMock,
    );

    expect(user).toEqual(mockUser);
    expect(userRepository.create).toHaveBeenCalledWith({
      ...createUserDto,
      user_status: 'active',
    });
    expect(userRepository.save).toHaveBeenCalledWith(mockUser);
  });

  it('should throw NotFoundException when finding user by id that does not exist', async () => {
    const userId = 'non-existent-id';
    jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(null);

    await expect(service.findOne(userId)).rejects.toThrow(
      new NotFoundException(`User with ID ${userId} not found`),
    );
  });

  it('should throw NotFoundException when updating user that does not exist', async () => {
    const userId = 'non-existent-id';
    const updateUserDto: UpdateUserDto = {
      email: 'updated@example.com',
    };

    jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(null);

    await expect(service.update(userId, updateUserDto, userPermissionResponseMock)).rejects.toThrow(
      new NotFoundException(`User with ID ${userId} not found`),
    );
  });

  it('should throw NotFoundException when deleting user that does not exist', async () => {
    const userId = 'non-existent-id';
    jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

    await expect(service.delete(userId)).rejects.toThrow(
      new NotFoundException(`User with ID ${userId} not found`),
    );
  });

  it('should find all users without projectId', async () => {
    const users = [
      {
        id: '1',
        email: 'test',
        user_status: 'active',
        first_name: '',
        last_name: '',
        name: '',
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        projects: [],
        user_roles: [],
        populateWhoColumns: jest.fn(),
      },
      {
        id: '2',
        email: 'test2',
        user_status: 'active',
        first_name: '',
        last_name: '',
        name: '',
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        projects: [],
        user_roles: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    jest.spyOn(userRepository, 'find')
      .mockResolvedValueOnce(users) // First call - main query
      .mockResolvedValueOnce([]) // Second call - createdByUsers
      .mockResolvedValueOnce([]); // Third call - updatedByUsers

    jest.spyOn(userRoleRepository, 'find')
      .mockResolvedValueOnce([
        buildUserRoleMock({ userId: '2', roleId: '2', role: { role_name: 'App Admin' } }),
      ]);

    const result = await service.findAll();
    expect(userRepository.find).toHaveBeenCalled();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '1',
          email: 'test',
          user_status: 'active',
          isAppAdmin: false,
          roleName: null,
        }),
        expect.objectContaining({
          id: '2',
          email: 'test2',
          user_status: 'active',
          isAppAdmin: true,
          roleName: 'App Admin',
        }),
      ]),
    );
  });

  it('should find users by projectId including app admins', async () => {
    const projectId = 'project-123';
    const initialUserRoles = [
      { userId: '1', projectId } as UserRole,
      { userId: '2', projectId } as UserRole,
      { userId: '3', projectId: null } as UserRole,
    ];

    const users = [
      {
        id: '1',
        email: 'user1@test.com',
        user_status: 'active',
        first_name: 'User',
        last_name: 'One',
        name: 'User One',
        created_at: new Date(),
        created_by: '3',
        updated_at: new Date(),
        updated_by: '4',
        projects: [],
        user_roles: [],
        populateWhoColumns: jest.fn(),
      },
      {
        id: '2',
        email: 'user2@test.com',
        user_status: 'active',
        first_name: 'User',
        last_name: 'Two',
        name: 'User Two',
        created_at: new Date(),
        created_by: '3',
        updated_at: new Date(),
        updated_by: '4',
        projects: [],
        user_roles: [],
        populateWhoColumns: jest.fn(),
      },
      {
        id: '3',
        email: 'admin@test.com',
        user_status: 'active',
        first_name: 'App',
        last_name: 'Admin',
        name: 'App Admin',
        created_at: new Date(),
        created_by: '3',
        updated_at: new Date(),
        updated_by: '4',
        projects: [],
        user_roles: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    const createdByUsers = [
      { id: '3', email: 'creator@test.com', user_status: 'active' } as User,
    ];

    const updatedByUsers = [
      { id: '4', email: 'updater@test.com', user_status: 'active' } as User,
    ];

    jest.spyOn(userRoleRepository, 'find')
      .mockResolvedValueOnce(initialUserRoles)
      .mockResolvedValueOnce([
        buildUserRoleMock({ userId: '3', roleId: 'app-admin-role', role: { role_name: 'App Admin' } }),
        buildUserRoleMock({ userId: '1', roleId: 'role-1', projectId, role: { role_name: 'Project Admin' } }),
        buildUserRoleMock({ userId: '2', roleId: 'role-2', projectId, role: { role_name: 'Project Viewer' } }),
      ]);

    jest.spyOn(userRepository, 'find')
      .mockResolvedValueOnce(users)
      .mockResolvedValueOnce(createdByUsers)
      .mockResolvedValueOnce(updatedByUsers);

    const result = await service.findAll(1, 10, 'id', 'ASC', {}, projectId);

    expect(userRoleRepository.find).toHaveBeenCalledWith({
      where: [
        { projectId },
        { projectId: IsNull() }
      ],
      relations: { user: true },
      select: { userId: true }
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(expect.objectContaining({
      id: '1',
      email: 'user1@test.com',
      isAppAdmin: false,
      roleName: 'Project Admin',
      created_by: createdByUsers[0],
      updated_by: updatedByUsers[0],
    }));
    expect(result[1]).toEqual(expect.objectContaining({
      id: '2',
      email: 'user2@test.com',
      isAppAdmin: false,
      roleName: 'Project Viewer',
      created_by: createdByUsers[0],
      updated_by: updatedByUsers[0],
    }));
    expect(result[2]).toEqual(expect.objectContaining({
      id: '3',
      email: 'admin@test.com',
      isAppAdmin: true,
      roleName: 'App Admin',
      created_by: createdByUsers[0],
      updated_by: updatedByUsers[0],
    }));
  });

  it('should return empty array when no users found for project', async () => {
    const projectId = 'non-existent-project';

    jest.spyOn(userRoleRepository, 'find').mockResolvedValue([]);

    const result = await service.findAll(1, 10, 'id', 'ASC', {}, projectId);

    expect(userRoleRepository.find).toHaveBeenCalledWith({
      where: [
        { projectId },
        { projectId: IsNull() }
      ],
      relations: { user: true },
      select: { userId: true }
    });

    expect(result).toEqual([]);
    expect(userRepository.find).not.toHaveBeenCalled();
  });

  it('should return empty array when users query returns no results', async () => {
    jest.spyOn(userRepository, 'find').mockResolvedValue([]);

    const result = await service.findAll();

    expect(userRepository.find).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('should handle users with no created_by or updated_by values', async () => {
    const users = [
      {
        id: '1',
        email: 'test@example.com',
        user_status: 'active',
        first_name: 'Test',
        last_name: 'User',
        name: 'Test User',
        created_at: new Date(),
        created_by: null,
        updated_at: new Date(),
        updated_by: null,
        projects: [],
        user_roles: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    jest.spyOn(userRepository, 'find')
      .mockResolvedValueOnce(users)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    jest.spyOn(userRoleRepository, 'find')
      .mockResolvedValueOnce([]);

    const result = await service.findAll();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: '1',
      email: 'test@example.com',
      isAppAdmin: false,
      roleName: null,
      created_by: null,
      updated_by: null,
    }));
  });

  it('should handle findAll with custom pagination and sorting', async () => {
    const users = [
      {
        id: '1',
        email: 'test@example.com',
        user_status: 'active',
        first_name: 'Test',
        last_name: 'User',
        name: 'Test User',
        created_at: new Date(),
        created_by: '2',
        updated_at: new Date(),
        updated_by: '2',
        projects: [],
        user_roles: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    jest.spyOn(userRepository, 'find')
      .mockResolvedValueOnce(users)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    jest.spyOn(userRoleRepository, 'find')
      .mockResolvedValueOnce([]);

    const filter = { user_status: 'active' };
    const result = await service.findAll(2, 5, 'email', 'DESC', filter);

    expect(userRepository.find).toHaveBeenCalledWith({
      skip: 5,
      take: 5,
      order: { email: 'DESC' },
      where: filter,
    });

    expect(result).toHaveLength(1);
  });

  describe('roleName assignment in findAll', () => {
    const makeUser = (id: string, email: string) => ({
      id,
      email,
      user_status: 'active',
      first_name: 'Test',
      last_name: 'User',
      name: 'Test User',
      created_at: new Date(),
      created_by: null,
      updated_at: new Date(),
      updated_by: null,
      projects: [],
      user_roles: [],
      populateWhoColumns: jest.fn(),
    });

    it('should set roleName to "App Admin" for app admins even when projectId is provided', async () => {
      const projectId = 'project-123';
      const users = [makeUser('1', 'admin@test.com')];

      jest.spyOn(userRoleRepository, 'find')
        .mockResolvedValueOnce([{ userId: '1', projectId: null } as UserRole])
        .mockResolvedValueOnce([
          buildUserRoleMock({ userId: '1', roleId: 'r1', role: { role_name: 'App Admin' } }),
        ]);

      jest.spyOn(userRepository, 'find')
        .mockResolvedValueOnce(users)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.findAll(1, 10, 'id', 'ASC', {}, projectId);

      expect(result[0]).toEqual(expect.objectContaining({
        isAppAdmin: true,
        roleName: 'App Admin',
      }));
    });

    it('should set roleName to project role name for non-admin users', async () => {
      const projectId = 'project-123';
      const users = [makeUser('1', 'viewer@test.com')];

      jest.spyOn(userRoleRepository, 'find')
        .mockResolvedValueOnce([{ userId: '1', projectId } as UserRole])
        .mockResolvedValueOnce([
          buildUserRoleMock({ userId: '1', roleId: 'r1', projectId, role: { role_name: 'Project Viewer' } }),
        ]);

      jest.spyOn(userRepository, 'find')
        .mockResolvedValueOnce(users)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.findAll(1, 10, 'id', 'ASC', {}, projectId);

      expect(result[0]).toEqual(expect.objectContaining({
        isAppAdmin: false,
        roleName: 'Project Viewer',
      }));
    });

    it('should set roleName to null for users with no matching role', async () => {
      const users = [makeUser('1', 'norole@test.com')];

      jest.spyOn(userRepository, 'find')
        .mockResolvedValueOnce(users)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      jest.spyOn(userRoleRepository, 'find')
        .mockResolvedValueOnce([]);

      const result = await service.findAll();

      expect(result[0]).toEqual(expect.objectContaining({
        isAppAdmin: false,
        roleName: null,
      }));
    });

    it('should prioritize App Admin roleName over project role when user has both', async () => {
      const projectId = 'project-123';
      const users = [makeUser('1', 'superuser@test.com')];

      jest.spyOn(userRoleRepository, 'find')
        .mockResolvedValueOnce([
          { userId: '1', projectId: null } as UserRole,
          { userId: '1', projectId } as UserRole,
        ])
        .mockResolvedValueOnce([
          buildUserRoleMock({ userId: '1', roleId: 'r1', role: { role_name: 'App Admin' } }),
          buildUserRoleMock({ userId: '1', roleId: 'r2', projectId, role: { role_name: 'Project Admin' } }),
        ]);

      jest.spyOn(userRepository, 'find')
        .mockResolvedValueOnce(users)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.findAll(1, 10, 'id', 'ASC', {}, projectId);

      expect(result[0]).toEqual(expect.objectContaining({
        isAppAdmin: true,
        roleName: 'App Admin',
      }));
    });
  });

  it('should throw NotFoundException if user is not found', async () => {
    const email = 'test@example.com';
    jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

    await expect(service.getUserProjectsAndPermissions(email)).rejects.toThrow(
      new NotFoundException(`User with email ${email} not found`),
    );
  });

  it('should throw NotFoundException if user has no role in the project with the provided projectId', async () => {
    const email = 'test@example.com';
    const projectId = 'project-id-123';
    const user = new User();
    user.user_roles = [];

    jest.spyOn(userRepository, 'findOne').mockResolvedValue(user);

    await expect(
      service.getUserProjectsAndPermissions(email, projectId),
    ).rejects.toThrow(
      new NotFoundException(`User has no role in project with ID ${projectId}`),
    );
  });

  it('should return user role and permissions for the specific project', async () => {
    const email = 'test@example.com';
    const projectId = 'project-id-123';
    const userRole = new UserRole();
    userRole.project = { id: projectId, project_name: 'Test Project' } as any;
    userRole.role = { id: 'role-id-123', role_name: 'Admin' } as any;
    const user = new User();
    user.user_roles = [userRole];

    const permissions = ['read', 'write'];

    jest.spyOn(userRepository, 'findOne').mockResolvedValue(user);
    jest.spyOn(service, 'getPermissionsByRoles').mockResolvedValue(permissions);

    const result = await service.getUserProjectsAndPermissions(
      email,
      projectId,
    );

    expect(result).toEqual({
      projectId: 'project-id-123',
      projectName: 'Test Project',
      role: 'Admin',
      permissionsOfProject: permissions,
    });
  });

  it('should return all projects and permissions for the user', async () => {
    const email = 'test@example.com';
    const userRole1 = new UserRole();
    userRole1.project = {
      id: 'project-id-1',
      project_name: 'Project 1',
    } as any;
    userRole1.role = { id: 'role-id-1', role_name: 'Admin' } as any;

    const userRole2 = new UserRole();
    userRole2.project = {
      id: 'project-id-2',
      project_name: 'Project 2',
    } as any;
    userRole2.role = { id: 'role-id-2', role_name: 'Editor' } as any;

    const user = new User();
    user.user_roles = [userRole1, userRole2];

    const permissions1 = ['read', 'write'];
    const permissions2 = ['read'];

    jest.spyOn(userRepository, 'findOne').mockResolvedValue(user);

    // Mock the rolePermissionRepository.find method for allRolePermissions
    jest.spyOn(rolePermissionRepository, 'find').mockResolvedValue([
      {
        role: { id: 'role-id-1' },
        permission: { permission_name: 'read' },
      } as any,
      {
        role: { id: 'role-id-1' },
        permission: { permission_name: 'write' },
      } as any,
      {
        role: { id: 'role-id-2' },
        permission: { permission_name: 'read' },
      } as any,
    ]);

    const result = await service.getUserProjectsAndPermissions(email);

    expect(result).toEqual([
      {
        projectId: 'project-id-1',
        projectName: 'Project 1',
        role: 'Admin',
        permissionsOfProject: permissions1,
      },
      {
        projectId: 'project-id-2',
        projectName: 'Project 2',
        role: 'Editor',
        permissionsOfProject: permissions2,
      },
    ]);
  });

  it('should handle user roles with null projects (app admin roles)', async () => {
    const email = 'test@example.com';
    const userRole = new UserRole();
    userRole.project = null; // App admin role has null project
    userRole.role = { id: 'app-admin-role-id', role_name: 'App Admin' } as any;

    const user = new User();
    user.user_roles = [userRole];

    jest.spyOn(userRepository, 'findOne').mockResolvedValue(user);

    // Mock the rolePermissionRepository.find method for allRolePermissions
    jest.spyOn(rolePermissionRepository, 'find').mockResolvedValue([
      {
        role: { id: 'app-admin-role-id' },
        permission: { permission_name: 'admin' },
      } as any,
    ]);

    const result = await service.getUserProjectsAndPermissions(email);

    expect(result).toEqual([
      {
        projectId: null,
        projectName: null,
        role: 'App Admin',
        permissionsOfProject: ['admin'],
      },
    ]);
  });

  it('should return permissions associated with the role', async () => {
    const roleId = 'role-id-123';
    const rolePermissions = [
      { permission: { permission_name: 'read' } },
      { permission: { permission_name: 'write' } },
    ];

    jest
      .spyOn(rolePermissionRepository, 'find')
      .mockResolvedValue(rolePermissions as any);

    const result = await service.getPermissionsByRoles(roleId);

    expect(result).toEqual(['read', 'write']);
  });

  it('should find one user by id', async () => {
    const user = {
      id: '1',
      email: 'test',
      first_name: '',
      name: '',
      last_name: '',
      user_status: 'active',
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      projects: [],
      user_roles: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(user);

    expect(await service.findOne('1')).toEqual(user);
    expect(userRepository.findOneBy).toHaveBeenCalledWith({ id: '1' });
  });

  it('should update a user', async () => {
    const updateUserDto: UpdateUserDto = {
      email: 'test',
    };

    const mockUser = { id: '1', email: 'existing@example.com' };
    jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(mockUser as any);
    jest.spyOn(userRepository, 'update').mockResolvedValue({
      generatedMaps: [],
      raw: [],
      affected: 1,
    });

    await service.update('1', updateUserDto, userPermissionResponseMock);
    expect(userRepository.findOneBy).toHaveBeenCalledWith({ id: '1' });
    expect(userRepository.update).toHaveBeenCalledWith('1', {
      ...updateUserDto,
      updated_by: expect.any(String),
    });
  });

  it('should delete a user successfully', async () => {
    const user = {
      id: '1',
      email: 'test@example.com',
      first_name: '',
      name: '',
      last_name: '',
      user_status: 'active',
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      projects: [],
      user_roles: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(userRepository, 'findOne').mockResolvedValue(user);

    jest.spyOn(userRepository, 'remove').mockResolvedValue(user);

    await service.delete('1');

    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: '1' },
      relations: { user_roles: true },
    });

    expect(userRepository.remove).toHaveBeenCalledWith(user);
  });

  it('should throw NotFoundException if user is not found', async () => {
    jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

    await expect(service.delete('1')).rejects.toThrow(
      new NotFoundException('User with ID 1 not found'),
    );
  });

  it('should inactivate a user', async () => {
    const mockUser = { id: '1', user_status: 'active' };
    jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(mockUser as any);
    jest.spyOn(userRepository, 'update').mockResolvedValue({
      generatedMaps: [],
      raw: [],
      affected: 1,
    });

    await service.inactivate('1');
    expect(userRepository.findOneBy).toHaveBeenCalledWith({ id: '1' });
    expect(userRepository.update).toHaveBeenCalledWith('1', {
      user_status: 'inactive',
    });
  });

  it('should throw NotFoundException when inactivating user that does not exist', async () => {
    const userId = 'non-existent-id';
    jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(null);

    await expect(service.inactivate(userId)).rejects.toThrow(
      new NotFoundException(`User with ID ${userId} not found`),
    );
  });

  // Database error handling tests
  describe('Database Error Handling', () => {
    const createUserDto = {
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      user_status: 'active',
      password: 'password123',
    };

    const updateUserDto: UpdateUserDto = {
      first_name: 'Jane',
      last_name: 'Doe',
    };

    const mockUser = {
      id: '1',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      user_status: 'active',
      created_at: new Date(),
      created_by: 'user-id',
      updated_at: new Date(),
      updated_by: 'user-id',
      user_roles: [],
      name: 'John Doe',
      populateWhoColumns: jest.fn(),
    };

    beforeEach(() => {
      resetLoggerMocks();
    });

    it('should handle database errors in create and log them', async () => {
      const dbError = new Error('Database connection failed');
      jest.spyOn(userRepository, 'create').mockReturnValue(mockUser as any);
      jest.spyOn(userRepository, 'save').mockRejectedValue(dbError);

      await expect(service.create(createUserDto, userPermissionResponseMock))
        .rejects.toThrow('Database connection failed');

      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to create user',
        dbError
      );
    });

    it('should handle database errors in findAll and log them', async () => {
      const dbError = new Error('Database query failed');
      jest.spyOn(userRepository, 'find').mockRejectedValue(dbError);

      await expect(service.findAll()).rejects.toThrow('Database query failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to retrieve users list',
        dbError
      );
    });

    it('should handle database errors in findOne and log them', async () => {
      const dbError = new Error('Database connection failed');
      jest.spyOn(userRepository, 'findOneBy').mockRejectedValue(dbError);

      await expect(service.findOne('1')).rejects.toThrow('Database connection failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to retrieve user',
        dbError
      );
    });

    it('should handle database errors in update and log them', async () => {
      const dbError = new Error('Database update failed');
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(mockUser as any);
      jest.spyOn(userRepository, 'update').mockRejectedValue(dbError);

      await expect(service.update('1', updateUserDto, userPermissionResponseMock))
        .rejects.toThrow('Database update failed');

      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to update user',
        dbError
      );
    });

    it('should handle database errors in delete and log them', async () => {
      const dbError = new Error('Database delete failed');
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser as any);
      jest.spyOn(userRepository, 'remove').mockRejectedValue(dbError);

      await expect(service.delete('1')).rejects.toThrow('Database delete failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to delete user',
        dbError
      );
    });

    it('should handle database errors in inactivate and log them', async () => {
      const dbError = new Error('Database update failed');
      jest.spyOn(userRepository, 'findOneBy').mockResolvedValue(mockUser as any);
      jest.spyOn(userRepository, 'update').mockRejectedValue(dbError);

      await expect(service.inactivate('1')).rejects.toThrow('Database update failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to inactivate user',
        dbError
      );
    });

    it('should handle database errors in getUserProjectsAndPermissions and log them', async () => {
      const dbError = new Error('Database query failed');
      jest.spyOn(userRepository, 'findOne').mockRejectedValue(dbError);

      await expect(service.getUserProjectsAndPermissions('test@example.com'))
        .rejects.toThrow('Database query failed');

      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to get user projects and permissions',
        dbError
      );
    });
  });
});
