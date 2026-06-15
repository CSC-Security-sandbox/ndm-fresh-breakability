import { Test, TestingModule } from '@nestjs/testing';
import { UserRoleController } from './user-role.controller';
import { UserRoleService } from './user-role.service';
import { Role } from '../entities/role.entity';
import { DataSource, Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../test-utils/logger-mocks';
import { BadRequestException } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';

describe('UserRoleController', () => {
  let controller: UserRoleController;
  let service: UserRoleService;

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
      controllers: [UserRoleController],
      providers: [
        UserRoleService,
        {
          provide: getRepositoryToken(Role),
          useClass: Repository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: getRepositoryToken(Permission),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(User),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(UserRole),
          useClass: Repository,
        },
        { provide: getRepositoryToken(Project), useClass: Repository },
        { provide: getRepositoryToken(Account), useClass: Repository },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb) => cb({
              delete: jest.fn(),
              save: jest.fn(),
            })),
          },
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    controller = module.get<UserRoleController>(UserRoleController);
    service = module.get<UserRoleService>(UserRoleService);
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

  it('should create an user-role', async () => {
    const userRole = {
      user_id: '1',
      role_id: '1',
      project_id: '1',
      account_id: '1',
    };
    jest
      .spyOn(service, 'create')
      .mockImplementation(async () => userRole as any);
    expect(await controller.create(userRole, userPermissionResponseMock)).toBe(
      userRole,
    );
  });

  it('should find all user-roles', async () => {
    const userRole = {
      user_id: '1',
      role_id: '1',
      project_id: '1',
      account_id: '1',
    };
    const mockRequest = { query: {} } as ExpressRequest;
    jest
      .spyOn(service, 'findAll')
      .mockImplementation(async () => [userRole] as any);
    expect(await controller.findAll(mockRequest)).toStrictEqual([userRole]);
  });

  it('should find all user-roles with query parameters', async () => {
    const userRole = {
      user_id: '1',
      role_id: '1',
      project_id: '1',
      account_id: '1',
    };
    const mockRequest = { 
      query: { 
        page: '2',
        limit: '20',
        sortField: 'user_id',
        sortOrder: 'DESC',
        user_id: '1',
        role_id: '1',
        project_id: '1',
        account_id: '1'
      } 
    } as any;
    jest
      .spyOn(service, 'findAll')
      .mockImplementation(async () => [userRole] as any);
    expect(await controller.findAll(mockRequest, 2, 20, 'user_id', 'DESC', '1', '1', '1', '1')).toStrictEqual([userRole]);
    expect(service.findAll).toHaveBeenCalledWith(2, 20, 'user_id', 'DESC', {
      user_id: '1',
      role_id: '1',
      project_id: '1',
      account_id: '1',
    });
  });

  it('should throw BadRequestException for unexpected query parameters', async () => {
    const mockRequest = { 
      query: { 
        unexpectedParam: 'value',
        anotherUnexpected: 'test'
      } 
    } as any;
    
    await expect(controller.findAll(mockRequest)).rejects.toThrow(
      new BadRequestException('Unexpected query parameters: unexpectedParam, anotherUnexpected')
    );
  });

  it('should find all user-roles with default pagination values', async () => {
    const userRole = {
      user_id: '1',
      role_id: '1',
      project_id: '1',
      account_id: '1',
    };
    const mockRequest = { query: {} } as ExpressRequest;
    jest
      .spyOn(service, 'findAll')
      .mockImplementation(async () => [userRole] as any);
    
    await controller.findAll(mockRequest);
    
    expect(service.findAll).toHaveBeenCalledWith(1, 10, 'id', 'ASC', {
      user_id: undefined,
      role_id: undefined,
      project_id: undefined,
      account_id: undefined,
    });
  });

  it('should find an user-role', async () => {
    const userRole = {
      user_id: '1',
      role_id: '1',
      project_id: '1',
      account_id: '1',
    };
    jest
      .spyOn(service, 'findOne')
      .mockImplementation(async () => userRole as any);
    expect(await controller.findOne('1')).toBe(userRole);
  });

  it('should update an user-role', async () => {
    const userRole = {
      user_id: '1',
      role_id: '1',
      project_id: '1',
      account_id: '1',
    };
    jest
      .spyOn(service, 'update')
      .mockImplementation(async () => userRole as any);
    expect(
      await controller.update('1', userRole, userPermissionResponseMock),
    ).toBeUndefined();
  });

  it('should delete an user-role', async () => {
    const userRole = {
      user_id: '1',
      role_id: '1',
      project_id: '1',
      account_id: '1',
    };
    jest
      .spyOn(service, 'delete')
      .mockImplementation(async () => userRole as any);
    expect(await controller.delete('1')).toBeUndefined();
  });
  it('should find all user and their roles', async () => {
    const userRole = [
      {
        user_id: '1',
      },
    ];
    jest
      .spyOn(service, 'fetchUsersAndRoles')
      .mockImplementation(async () => [userRole] as any);
    expect(await controller.fetchUsersAndRoles()).toStrictEqual([userRole]);
  });
});
