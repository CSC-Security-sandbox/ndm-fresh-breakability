import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { randomUUID } from 'crypto';
import { PermissionService } from './permission.service';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../test-utils/logger-mocks';

describe('PermissionService', () => {
  let service: PermissionService;
  let repository: Repository<Permission>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        {
          provide: getRepositoryToken(Permission),
          useClass: Repository,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory
        },
      ],
    }).compile();

    service = module.get<PermissionService>(PermissionService);
    repository = module.get<Repository<Permission>>(
      getRepositoryToken(Permission),
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
      id: '6d4657c8-b19a-47b4-bb2e-bcef5865d4ca', // can be replaced with any string
    },
  } as UserPermissionResponse;

  it('should create an permission', async () => {
    const createPermissionDto: CreatePermissionDto = {
      permission_name: 'test',
    };
    const permission = {
      id: '1',
      ...createPermissionDto,
      permission_status: 'active',
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      projects: [],
      role_permissions: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(repository, 'create').mockReturnValue(permission);
    jest.spyOn(repository, 'save').mockResolvedValue(permission);

    expect(
      await service.create(createPermissionDto, userPermissionResponseMock),
    ).toEqual(permission);
    expect(repository.create).toHaveBeenCalledWith({
      ...createPermissionDto,
      permission_status: 'active',
    });
    expect(repository.save).toHaveBeenCalledWith(permission);
  });

  it('should find all permissions', async () => {
    const permissions = [
      {
        id: '1',
        permission_name: 'test',
        permission_status: 'testActive',
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        projects: [],
        role_permissions: [],
        populateWhoColumns: jest.fn(),
      },
      {
        id: '2',
        permission_name: 'test',
        permission_status: 'testActive',
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        projects: [],
        role_permissions: [],
        populateWhoColumns: jest.fn(),
      },
    ];

    jest.spyOn(repository, 'find').mockResolvedValue(permissions);

    expect(await service.findAll()).toEqual(permissions);
    expect(repository.find).toHaveBeenCalled();
  });

  it('should find one permission by id', async () => {
    const permission = {
      id: '1',
      permission_name: 'test',
      permission_status: 'testActive',
      created_at: new Date(),
      created_by: randomUUID(),
      updated_at: new Date(),
      updated_by: randomUUID(),
      projects: [],
      role_permissions: [],
      populateWhoColumns: jest.fn(),
    };

    jest.spyOn(repository, 'findOneBy').mockResolvedValue(permission);

    expect(await service.findOne('1')).toEqual(permission);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
  });

  it('should update an permission', async () => {
    const updatePermissionDto: UpdatePermissionDto = {
      permission_name: 'test',
    };

    jest.spyOn(repository, 'update').mockResolvedValue(undefined);

    await service.update('1', updatePermissionDto, userPermissionResponseMock);
    expect(repository.update).toHaveBeenCalledWith('1', {
      ...updatePermissionDto,
      updated_by: expect.any(String),
    });
  });

  it('should delete an permission', async () => {
    jest.spyOn(repository, 'delete').mockResolvedValue(undefined);

    await service.delete('1');
    expect(repository.delete).toHaveBeenCalledWith('1');
  });

  it('should inactivate a permission', async () => {
    jest.spyOn(repository, 'update').mockResolvedValue(undefined);

    await service.inactivate('1');
    expect(repository.update).toHaveBeenCalledWith('1', {
      permission_status: 'inactive',
    });
  });
});
