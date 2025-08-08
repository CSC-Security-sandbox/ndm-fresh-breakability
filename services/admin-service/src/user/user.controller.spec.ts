import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { Account } from '../entities/account.entity';
import { Project } from '../entities/project.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../test-utils/logger-mocks';

describe('UserController', () => {
  let controller: UserController;
  let service: UserService;

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ['permission1', 'permission2'],
            projects: ['project1'],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        {
          provide: UserService,
          useValue: {
            getUserProjectsAndPermissions: jest.fn(),
            create: jest.fn(),
            inactivate: jest.fn(),
            delete: jest.fn(),
            update: jest.fn(),
            findOne: jest.fn(),
            findAll: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(UserRole),
          useClass: Repository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: getRepositoryToken(Role),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Project),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Account),
          useClass: Repository,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    service = module.get<UserService>(UserService);
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
      id: '6d4657c8-b19a-47b4-bb2e-bcef5865d4ca', // can be replaced with any string
    },
  } as UserPermissionResponse;

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should be defined', async () => {
    expect(service).toBeDefined();
  });

  it('should create an user', async () => {
    const createUserDto = {
      email: 'test@test1.com',
      user_status: 'active',
      first_name: '',
      last_name: '',
    };
    const user = {
      id: '1',
      ...createUserDto,
      user_status: 'active',
      first_name: '',
      last_name: '',
      name: '',
      created_at: new Date(),
      created_by: '1',
      updated_at: new Date(),
      updated_by: '1',
      email: 'test@test1.com',
      projects: [],
      user_roles: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(service, 'create').mockResolvedValue(user);

    expect(
      await controller.create(createUserDto, userPermissionResponseMock),
    ).toEqual(user);
  });

  it('should find all users', async () => {
    const users = [
      {
        id: '1',
        first_name: '',
        last_name: '',
        name: '',
        email: 'test',
        user_status: 'active',
        created_at: new Date(),
        created_by: '1',
        updated_at: new Date(),
        updated_by: '1',
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
        created_by: '1',
        updated_at: new Date(),
        updated_by: '1',
        projects: [],
        user_roles: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    jest.spyOn(service, 'findAll').mockResolvedValue(users);

    expect(await controller.findAll(1, 1, 'id', 'ASC', '{}')).toEqual(users);
    expect(await controller.findAll()).toEqual(users);
  });

  it('should call service method getUserProjectsAndPermissions with email and projectId', async () => {
    const email = 'test@example.com';
    const projectId = 'project-id-123';
    const mockResponse = {
      projectId: 'project-id-123',
      projectName: 'Test Project',
      role: 'Admin',
      permissionsOfProject: ['read', 'write'],
    };

    jest
      .spyOn(service, 'getUserProjectsAndPermissions')
      .mockResolvedValue(mockResponse);

    const result = await controller.getUserPermissions(email, projectId);

    expect(service.getUserProjectsAndPermissions).toHaveBeenCalledWith(
      email,
      projectId,
    );
    expect(result).toEqual(mockResponse);
  });

  it('should call service method getUserProjectsAndPermissions with just email if projectId is not provided', async () => {
    const email = 'test@example.com';
    const mockResponse = [
      {
        projectId: 'project-id-1',
        projectName: 'Project 1',
        role: 'Admin',
        permissionsOfProject: ['read', 'write'],
      },
      {
        projectId: 'project-id-2',
        projectName: 'Project 2',
        role: 'Editor',
        permissionsOfProject: ['read'],
      },
    ];

    jest
      .spyOn(service, 'getUserProjectsAndPermissions')
      .mockResolvedValue(mockResponse);

    const result = await controller.getUserPermissions(email);

    expect(service.getUserProjectsAndPermissions).toHaveBeenCalledWith(
      email,
      undefined,
    );
    expect(result).toEqual(mockResponse);
  });

  it('should find one user by id', async () => {
    const user = {
      id: '1',
      email: 'test',
      user_status: 'active',
      first_name: '',
      last_name: '',
      name: '',
      created_at: new Date(),
      created_by: '1',
      updated_at: new Date(),
      updated_by: '1',
      projects: [],
      user_roles: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(service, 'findOne').mockResolvedValue(user);

    expect(await controller.findOne('1')).toEqual(user);
  });

  it('should update an user', async () => {
    const updateUserDto = {
      email: 'test',
    };

    jest.spyOn(service, 'update').mockResolvedValue();

    expect(
      await controller.update('1', updateUserDto, userPermissionResponseMock),
    ).toBeUndefined();
  });

  it('should delete an user', async () => {
    jest.spyOn(service, 'delete').mockResolvedValue();

    expect(await controller.delete('1')).toBeUndefined();
  });

  it('should inactivate an user', async () => {
    jest.spyOn(service, 'inactivate').mockResolvedValue();

    expect(await controller.inactivate('1')).toBeUndefined();
  });
});
