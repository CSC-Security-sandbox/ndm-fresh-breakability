import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '@nestjs/cache-manager';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { PermissionController } from './permission.controller';
import { PermissionService } from './permission.service';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

describe('PermissionController', () => {
  let controller: PermissionController;
  let service: PermissionService;

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
      controllers: [PermissionController],
      providers: [
        PermissionService,
        {
          provide: getRepositoryToken(Permission),
          useClass: Repository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              log: jest.fn(),
              error: jest.fn(),
            }),
          },
        }
      ],
    }).compile();

    controller = module.get<PermissionController>(PermissionController);
    service = module.get<PermissionService>(PermissionService);
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

  it('should create an permission', async () => {
    const createPermissionDto = {
      permission_name: 'test',
    };
    const permission = {
      id: '1',
      ...createPermissionDto,
      permission_status: 'testActive',
      created_at: new Date(),
      created_by: '1',
      updated_at: new Date(),
      updated_by: '1',
      projects: [],
      role_permissions: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(service, 'create').mockResolvedValue(permission);

    expect(
      await controller.create(createPermissionDto, userPermissionResponseMock),
    ).toEqual(permission);
  });

  it('should find all permissions', async () => {
    const permission = [
      {
        id: '1',
        permission_name: 'test',
        permission_status: 'testActive',
        created_at: new Date(),
        created_by: '1',
        updated_at: new Date(),
        updated_by: '1',
        projects: [],
        role_permissions: [],
        populateWhoColumns: jest.fn(),
      },
      {
        id: '2',
        permission_name: 'test2',
        permission_status: 'testActive',
        created_at: new Date(),
        created_by: '1',
        updated_at: new Date(),
        updated_by: '1',
        projects: [],
        role_permissions: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    jest.spyOn(service, 'findAll').mockResolvedValue(permission);

    expect(await controller.findAll()).toEqual(permission);
  });

  it('should find one permission by id', async () => {
    const permission = {
      id: '1',
      permission_name: 'test',
      permission_status: 'testActive',
      created_at: new Date(),
      created_by: '1',
      updated_at: new Date(),
      updated_by: '1',
      projects: [],
      role_permissions: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(service, 'findOne').mockResolvedValue(permission);

    expect(await controller.findOne('1')).toEqual(permission);
  });

  it('should update an permission', async () => {
    const updatePermissionDto = {
      permission_name: 'test',
      permission_status: 'testActive',
    };

    jest.spyOn(service, 'update').mockResolvedValue();

    expect(
      await controller.update(
        '1',
        updatePermissionDto,
        userPermissionResponseMock,
      ),
    ).toBeUndefined();
  });

  it('should delete an permission', async () => {
    jest.spyOn(service, 'delete').mockResolvedValue();

    expect(await controller.delete('1')).toBeUndefined();
  });

  it('should call inactivate method of PermissionService with correct id', async () => {
    const id = '123';
    jest.spyOn(service, 'inactivate').mockResolvedValue();
    await controller.inactivate(id);
    expect(service.inactivate).toHaveBeenCalledWith(id);
  });
});
