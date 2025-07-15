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
import { NotFoundException } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory, resetLoggerMocks } from '../test-utils/logger-mocks';

describe('RoleService', () => {
  let service: RoleService;
  let repository: Repository<Role>;
  let projectRepository: Repository<Project>;

  beforeEach(async () => {
    resetLoggerMocks();

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
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    service = module.get<RoleService>(RoleService);
    repository = module.get<Repository<Role>>(getRepositoryToken(Role));
    projectRepository = module.get<Repository<Project>>(
      getRepositoryToken(Project),
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

    expect(
      await service.create(createRoleDto, userPermissionResponseMock),
    ).toEqual(role);
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

  it('should throw NotFoundException when role not found in findOne', async () => {
    jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

    await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'nonexistent' });
  });

  it('should update an role', async () => {
    const updateRoleDto: UpdateRoleDto = {
      role_name: 'test',
    };

    const mockRole = { id: '1', role_name: 'existing' };
    jest.spyOn(repository, 'findOneBy').mockResolvedValue(mockRole as any);
    jest.spyOn(repository, 'update').mockResolvedValue(undefined as any);

    await service.update('1', updateRoleDto, userPermissionResponseMock);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
    expect(repository.update).toHaveBeenCalledWith('1', {
      ...updateRoleDto,
      updated_by: expect.any(String),
    });
  });

  it('should throw NotFoundException when updating non-existent role', async () => {
    const updateRoleDto: UpdateRoleDto = { role_name: 'test' };

    jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

    await expect(service.update('nonexistent', updateRoleDto, userPermissionResponseMock))
      .rejects.toThrow(NotFoundException);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'nonexistent' });
  });

  it('should delete an role', async () => {
    const mockRole = { id: '1', role_name: 'test' };
    jest.spyOn(repository, 'findOneBy').mockResolvedValue(mockRole as any);
    jest.spyOn(repository, 'delete').mockResolvedValue({ affected: 1 } as any);

    await service.delete('1');
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
    expect(repository.delete).toHaveBeenCalledWith('1');
  });

  it('should throw NotFoundException when deleting non-existent role', async () => {
    jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

    await expect(service.delete('nonexistent')).rejects.toThrow(NotFoundException);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'nonexistent' });
  });

  it('should inactivate an role', async () => {
    const mockRole = { id: '1', role_name: 'test' };
    jest.spyOn(repository, 'findOneBy').mockResolvedValue(mockRole as any);
    jest.spyOn(repository, 'update').mockResolvedValue(undefined as any);

    await service.inactivate('1');
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
    expect(repository.update).toHaveBeenCalledWith('1', {
      role_status: 'inactive',
    });
  });

  it('should log messages at different levels', () => {
    // Get the logger instance from the service
    const logger = (service as any).logger;

    // Call the test method
    service.test();

    // Verify that each logging method was called with the correct message
    expect(logger.log).toHaveBeenCalledWith('This is a test log message from RoleService');
    expect(logger.error).toHaveBeenCalledWith('This is a test error message from RoleService');
    expect(logger.warn).toHaveBeenCalledWith('This is a test warning message from RoleService');
    expect(logger.debug).toHaveBeenCalledWith('This is a test debug message from RoleService');
  });

  it('should throw NotFoundException when inactivating non-existent role', async () => {
    jest.spyOn(repository, 'findOneBy').mockResolvedValue(null);

    await expect(service.inactivate('nonexistent')).rejects.toThrow(NotFoundException);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'nonexistent' });
  });

  // Database error handling tests
  describe('Database Error Handling', () => {
    const createRoleDto: CreateRoleDto = {
      role_name: 'test',
    };

    const updateRoleDto: UpdateRoleDto = {
      role_name: 'updated test',
    };

    const mockRole = {
      id: '1',
      role_name: 'test',
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

    beforeEach(() => {
      resetLoggerMocks();
    });

    it('should handle database errors in create and log them', async () => {
      const dbError = new Error('Database connection failed');
      jest.spyOn(repository, 'create').mockReturnValue(mockRole as any);
      jest.spyOn(repository, 'save').mockRejectedValue(dbError);

      await expect(service.create(createRoleDto, userPermissionResponseMock))
        .rejects.toThrow('Database connection failed');

      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to create role for user',
        dbError
      );
    });

    it('should handle database errors in findAll and log them', async () => {
      const dbError = new Error('Database query failed');
      jest.spyOn(repository, 'find').mockRejectedValue(dbError);

      await expect(service.findAll()).rejects.toThrow('Database query failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to retrieve roles list',
        dbError
      );
    });

    it('should handle database errors in findOne and log them', async () => {
      const dbError = new Error('Database connection failed');
      jest.spyOn(repository, 'findOneBy').mockRejectedValue(dbError);

      await expect(service.findOne('1')).rejects.toThrow('Database connection failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to retrieve role',
        dbError
      );
    });

    it('should handle database errors in update and log them', async () => {
      const dbError = new Error('Database update failed');
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(mockRole);
      jest.spyOn(repository, 'update').mockRejectedValue(dbError);

      await expect(service.update('1', updateRoleDto, userPermissionResponseMock))
        .rejects.toThrow('Database update failed');

      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to update role',
        dbError
      );
    });

    it('should handle database errors in delete and log them', async () => {
      const dbError = new Error('Database delete failed');
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(mockRole);
      jest.spyOn(repository, 'delete').mockRejectedValue(dbError);

      await expect(service.delete('1')).rejects.toThrow('Database delete failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to delete role',
        dbError
      );
    });

    it('should handle database errors in inactivate and log them', async () => {
      const dbError = new Error('Database update failed');
      jest.spyOn(repository, 'findOneBy').mockResolvedValue(mockRole);
      jest.spyOn(repository, 'update').mockRejectedValue(dbError);

      await expect(service.inactivate('1')).rejects.toThrow('Database update failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to inactivate role',
        dbError
      );
    });
  });
});
