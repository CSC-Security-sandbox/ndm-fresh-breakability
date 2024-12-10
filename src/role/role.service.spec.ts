import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleService } from './role.service';
import { Role } from '../entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { randomUUID } from 'crypto';
import { Project } from '../entities/project.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';

describe('RoleService', () => {
  let service: RoleService;
  let repository: Repository<Role>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        {
          provide: getRepositoryToken(Role),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Project),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<RoleService>(RoleService);
    repository = module.get<Repository<Role>>(getRepositoryToken(Role));
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

  it('should create an role', async () => {
    const createRoleDto: CreateRoleDto = {
      role_name: 'test',
    };
    const role = {
      id: '1',
      ...createRoleDto,
      role_status: 'active',
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      projects: [],
      user_roles: [],
      role_permissions: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(repository, 'create').mockReturnValue(role);
    jest.spyOn(repository, 'save').mockResolvedValue(role);

    expect(await service.create(createRoleDto, userPermissionResponseMock)).toEqual(role);
    expect(repository.create).toHaveBeenCalledWith({
      ...createRoleDto,
      role_status: 'active',
    });
    expect(repository.save).toHaveBeenCalledWith(role);
  });

  it('should find all roles', async () => {
    const roles = [
      {
        id: '1',
        role_name: 'test',
        role_status: 'testActive',
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        projects: [],
        user_roles: [],
        role_permissions: [],
        populateWhoColumns: jest.fn(),
      },
      {
        id: '2',
        role_name: 'test2',
        role_status: 'testActive',
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        projects: [],
        user_roles: [],
        role_permissions: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    jest.spyOn(repository, 'find').mockResolvedValue(roles);

    expect(await service.findAll()).toEqual(roles);
    expect(repository.find).toHaveBeenCalled();
  });

  it('should find one role by id', async () => {
    const role = {
      id: '1',
      role_name: 'test',
      role_status: 'testActive',
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      projects: [],
      user_roles: [],
      role_permissions: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(repository, 'findOneBy').mockResolvedValue(role);

    expect(await service.findOne('1')).toEqual(role);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
  });

  it('should update an role', async () => {
    const updateRoleDto: UpdateRoleDto = {
      role_name: 'test',
    };

    jest.spyOn(repository, 'update').mockResolvedValue(undefined);

    await service.update('1', updateRoleDto, userPermissionResponseMock);
    expect(repository.update).toHaveBeenCalledWith('1', {
      ...updateRoleDto,
      updated_by: expect.any(String),
    });
  });

  it('should delete an role', async () => {
    jest.spyOn(repository, 'delete').mockResolvedValue(undefined);

    await service.delete('1');
    expect(repository.delete).toHaveBeenCalledWith('1');
  });

  it('should inactivate an role', async () => {
    jest.spyOn(repository, 'update').mockResolvedValue(undefined);

    await service.inactivate('1');
    expect(repository.update).toHaveBeenCalledWith('1', {
      role_status: 'inactive',
    });
  });
});
