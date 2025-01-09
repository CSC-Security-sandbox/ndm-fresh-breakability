import { Test, TestingModule } from '@nestjs/testing';
import { UserRoleController } from './user-role.controller';
import { UserRoleService } from './user-role.service';
import { Role } from '../entities/role.entity';
import { Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { UserRoleMappingDto } from './dto/user-role.dto';

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
      ],
    }).compile();

    controller = module.get<UserRoleController>(UserRoleController);
    service = module.get<UserRoleService>(UserRoleService);
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
    expect(await controller.create(userRole, userPermissionResponseMock)).toBe(userRole);
  });

  it('should find all user-roles', async () => {
    const userRole = {
      user_id: '1',
      role_id: '1',
      project_id: '1',
      account_id: '1',
    };
    jest
      .spyOn(service, 'findAll')
      .mockImplementation(async () => [userRole] as any);
    expect(await controller.findAll()).toStrictEqual([userRole]);
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
    expect(await controller.update('1', userRole, userPermissionResponseMock)).toBeUndefined();
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
    const userRole = [{
      user_id: '1',
    }];
    jest
      .spyOn(service, 'fetchUsersAndRoles')
      .mockImplementation(async () => [userRole] as any);
    expect(await controller.fetchUsersAndRoles()).toStrictEqual([userRole]);
  });
});
