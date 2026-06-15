import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '@nestjs/cache-manager';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { Repository } from 'typeorm';
import { Role } from '../entities/role.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../test-utils/logger-mocks';

describe('RoleController', () => {
  let controller: RoleController;
  let service: RoleService;

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
      imports: [CacheModule.register()],
      controllers: [RoleController],
      providers: [
        RoleService,
        {
          provide: getRepositoryToken(Role),
          useClass: Repository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    controller = module.get<RoleController>(RoleController);
    service = module.get<RoleService>(RoleService);
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

  it('should create an role', async () => {
    const createRoleDto = {
      role_name: 'test',
    };
    const role = {
      id: '1',
      ...createRoleDto,
      role_status: 'active',
      created_at: new Date(),
      created_by: '1',
      updated_at: new Date(),
      updated_by: '1',
      projects: [],
      user_roles: [],
      role_permissions: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(service, 'create').mockResolvedValue(role);

    expect(
      await controller.create(createRoleDto, userPermissionResponseMock),
    ).toEqual(role);
  });

  it('should find all roles', async () => {
    const roles = [
      {
        id: '1',
        role_name: 'test',
        role_status: 'active',
        created_at: new Date(),
        created_by: '1',
        updated_at: new Date(),
        updated_by: '1',
        projects: [],
        user_roles: [],
        role_permissions: [],
        populateWhoColumns: jest.fn(),
      },
      {
        id: '2',
        role_name: 'test2',
        role_status: 'active',
        created_at: new Date(),
        created_by: '1',
        updated_at: new Date(),
        updated_by: '1',
        projects: [],
        user_roles: [],
        role_permissions: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    jest.spyOn(service, 'findAll').mockResolvedValue(roles);

    expect(await controller.findAll()).toEqual(roles);
  });

  it('should find one role by id', async () => {
    const role = {
      id: '1',
      role_name: 'test',
      role_status: 'active',
      created_at: new Date(),
      created_by: '1',
      updated_at: new Date(),
      updated_by: '1',
      projects: [],
      user_roles: [],
      role_permissions: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(service, 'findOne').mockResolvedValue(role);

    expect(await controller.findOne('1')).toEqual(role);
  });

  it('should update an role', async () => {
    const updateRoleDto = {
      role_name: 'test',
    };

    jest.spyOn(service, 'update').mockResolvedValue();

    expect(
      await controller.update('1', updateRoleDto, userPermissionResponseMock),
    ).toBeUndefined();
  });

  it('should delete an role', async () => {
    jest.spyOn(service, 'delete').mockResolvedValue();

    expect(await controller.delete('1')).toBeUndefined();
  });

  it('should inactivate an role', async () => {
    jest.spyOn(service, 'inactivate').mockResolvedValue();

    expect(await controller.inactivate('1')).toBeUndefined();
  });
});
