import { Test, TestingModule } from '@nestjs/testing';
import { UserRoleController } from './user-role.controller';
import { UserRoleService } from './user-role.service';
//import { CreateUserRoleDto } from './dto/create-user-role.dto';
//import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { Role } from '../entities/role.entity';
import { Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';

describe('UserRoleController', () => {
  let controller: UserRoleController;
  let service: UserRoleService;

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
    expect(await controller.create(userRole)).toBe(userRole);
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
    expect(await controller.update('1', userRole)).toBeUndefined();
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
});
