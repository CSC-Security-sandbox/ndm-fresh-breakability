import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RolePermissionController } from './role-permission.controller';
import { RolePermissionService } from './role-permission.service';
import { Role } from '../entities/role.entity';
import { Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { User } from '../entities/user.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { UserRole } from '../entities/user-role.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';

describe('RolePermissionController', () => {
  let controller: RolePermissionController;
  let service: RolePermissionService;

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
      controllers: [RolePermissionController],
      providers: [
        RolePermissionService,
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
          provide: getRepositoryToken(RolePermission),
          useClass: Repository,
        },
        { provide: getRepositoryToken(User), useClass: Repository },
        { provide: getRepositoryToken(Role), useClass: Repository },
        { provide: getRepositoryToken(Project), useClass: Repository },
        { provide: getRepositoryToken(Account), useClass: Repository },
        { provide: getRepositoryToken(UserRole), useClass: Repository },
      ],
    }).compile();

    controller = module.get<RolePermissionController>(RolePermissionController);
    service = module.get<RolePermissionService>(RolePermissionService);
  });

  const userPermissionResponseMock = {
    user: {
      roles: [
        {
          role_name: "",
          projects: [],
          permissions: []
        }
      ],
      id: "6d4657c8-b19a-47b4-bb2e-bcef5865d4ca" // can be replaced with any string
    }
  } as UserPermissionResponse

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should be defined', async () => {
    expect(service).toBeDefined();
  });

  it('should create a role-permission', async () => {
    const rolePermission = {
      role_id: '1',
      permission_id: '1',
    };
    jest
      .spyOn(service, 'create')
      .mockImplementation(async () => rolePermission as any);
    expect(await controller.create(rolePermission, userPermissionResponseMock)).toBe(rolePermission);
  });

  it('should find all role-permissions with pagination', async () => {
    const rolePermission = {
      role_id: '1',
      permission_id: '1',
    };
    jest
      .spyOn(service, 'findAll')
      .mockImplementation(async () => [rolePermission] as any);
    expect(
      await controller.findAll(2, 20, 'role_id', 'DESC', '{}'),
    ).toStrictEqual([rolePermission]);
  });

  it('should find all role-permissions with default pagination', async () => {
    const rolePermission = {
      role_id: '1',
      permission_id: '1',
    };
    jest
      .spyOn(service, 'findAll')
      .mockImplementation(async () => [rolePermission] as any);
    expect(await controller.findAll(undefined, undefined, undefined, undefined, '{}')).toStrictEqual([rolePermission]);
  });

  it('should find a role-permission by ID', async () => {
    const rolePermission = {
      role_id: '1',
      permission_id: '1',
    };
    jest
      .spyOn(service, 'findOne')
      .mockImplementation(async () => rolePermission as any);
    expect(await controller.findOne('1')).toBe(rolePermission);
  });

  // it('should return 404 if role-permission not found', async () => {
  //   jest.spyOn(service, 'findOne').mockImplementation(async () => null);
  //   await expect(controller.findOne('999')).rejects.toThrow();
  // });

  it('should update a role-permission', async () => {
    const rolePermission = {
      role_id: '1',
      permission_id: '1',
    };
    jest.spyOn(service, 'update').mockImplementation(async () => undefined);
    expect(await controller.update('1', rolePermission)).toBeUndefined();
  });

  it('should handle error during update role-permission', async () => {
    const rolePermission = {
      role_id: '1',
      permission_id: '1',
    };
    jest.spyOn(service, 'update').mockRejectedValue(new Error('Update failed'));
    await expect(controller.update('1', rolePermission)).rejects.toThrow('Update failed');
  });

  it('should delete a role-permission', async () => {
    jest.spyOn(service, 'delete').mockImplementation(async () => undefined);
    expect(await controller.delete('1')).toBeUndefined();
  });

  it('should handle error during delete role-permission', async () => {
    jest.spyOn(service, 'delete').mockRejectedValue(new Error('Delete failed'));
    await expect(controller.delete('1')).rejects.toThrow('Delete failed');
  });

  it('should return 404 when deleting a non-existent role-permission', async () => {
    jest.spyOn(service, 'delete').mockRejectedValue(new Error('Role permission not found'));
    await expect(controller.delete('999')).rejects.toThrow('Role permission not found');
  });
});