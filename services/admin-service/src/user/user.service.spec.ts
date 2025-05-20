import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Project } from '../entities/project.entity';
import { UserService } from './user.service';
import { User } from '../entities/user.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { Account } from '../entities/account.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';

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
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(UserRole),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Project),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Role),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(RolePermission),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Account),
          useClass: Repository,
        },
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

  it('should find all users', async () => {
    const users = [
      {
        id: '1',
        email: 'test',
        user_status: 'active',
        first_name: '',
        last_name: '',
        name: '',
        isAppAdmin: false,
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
        isAppAdmin: true,
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        projects: [],
        user_roles: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    jest.spyOn(userRepository, 'find').mockResolvedValue(users);

    jest.spyOn(userRepository, 'findOne').mockResolvedValue(users[0]);

    jest
      .spyOn(userRoleRepository, 'findOne')
      .mockResolvedValue({ roleId: '1' } as UserRole);

    jest
      .spyOn(roleRepository, 'findOne')
      .mockResolvedValue({ role_name: 'App Admin' } as Role);

    const result = await service.findAll();
    expect(userRepository.find).toHaveBeenCalled();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '1',
          email: 'test',
          user_status: 'active',
        }),
        expect.objectContaining({
          id: '2',
          email: 'test2',
          user_status: 'active',
        }),
      ]),
    );
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
    jest
      .spyOn(service, 'getPermissionsByRoles')
      .mockImplementation((roleId: string) => {
        if (roleId === 'role-id-1') return Promise.resolve(permissions1);
        if (roleId === 'role-id-2') return Promise.resolve(permissions2);
        return Promise.resolve([]);
      });

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

    jest.spyOn(userRepository, 'update').mockResolvedValue({
      generatedMaps: [],
      raw: [],
      affected: 1,
    });

    await service.update('1', updateUserDto, userPermissionResponseMock);
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
      relations: ['user_roles'],
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
    jest.spyOn(userRepository, 'update').mockResolvedValue({
      generatedMaps: [],
      raw: [],
      affected: 1,
    });

    await service.inactivate('1');
    expect(userRepository.update).toHaveBeenCalledWith('1', {
      user_status: 'inactive',
    });
  });
});
