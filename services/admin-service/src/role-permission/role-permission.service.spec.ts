import { Test, TestingModule } from '@nestjs/testing';
import { RolePermissionService } from './role-permission.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory, resetLoggerMocks } from '../test-utils/logger-mocks';

describe('RolePermissionService', () => {
  let service: RolePermissionService;
  let roleRepository: Repository<Role>;
  let permissionRepository: Repository<Permission>;
  let rolePermissionRepository: Repository<RolePermission>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolePermissionService,
        {
          provide: getRepositoryToken(Role),
          useClass: Repository,
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
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    service = module.get<RolePermissionService>(RolePermissionService);
    roleRepository = module.get<Repository<Role>>(getRepositoryToken(Role));
    permissionRepository = module.get<Repository<Permission>>(
      getRepositoryToken(Permission),
    );
    rolePermissionRepository = module.get<Repository<RolePermission>>(
      getRepositoryToken(RolePermission),
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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of role permissions', async () => {
      const mockRolePermissions = [
        {
          id: '1',
          role: { id: 'role-id-1' },
          permission: { id: 'permission-id-1' },
        } as RolePermission,
        {
          id: '2',
          role: { id: 'role-id-2' },
          permission: { id: 'permission-id-2' },
        } as RolePermission,
      ];

      jest
        .spyOn(rolePermissionRepository, 'find')
        .mockResolvedValue(mockRolePermissions);

      const result = await service.findAll(1, 1, '', 'ASC', undefined);

      expect(result).toEqual(mockRolePermissions);
      expect(rolePermissionRepository.find).toHaveBeenCalledWith({
        order: { '': 'ASC' },
        relations: { role: true, permission: true },
        skip: 0,
        take: 1,
        where: {},
      });
    });

    it('should return an empty array if no role permissions are found', async () => {
      jest.spyOn(rolePermissionRepository, 'find').mockResolvedValue([]);

      const result = await service.findAll(1, 1, '', 'ASC', undefined);

      expect(result).toEqual([]);
      expect(rolePermissionRepository.find).toHaveBeenCalledWith({
        where: {},
        take: 1,
        skip: 0,
        order: { '': 'ASC' },
        relations: { role: true, permission: true },
      });
    });

    it('should filter by role_id when provided', async () => {
      const mockFilter = { role_id: '1' };
      const findSpy = jest
        .spyOn(rolePermissionRepository, 'find')
        .mockResolvedValue([]);

      await service.findAll(1, 10, 'id', 'ASC', mockFilter);

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            role: { id: mockFilter.role_id },
          },
        }),
      );
    });

    it('should filter by permission_id when provided', async () => {
      const mockFilter = { permission_id: '2' };
      const findSpy = jest
        .spyOn(rolePermissionRepository, 'find')
        .mockResolvedValue([]);

      await service.findAll(1, 10, 'id', 'ASC', mockFilter);

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            permission: { id: mockFilter.permission_id },
          },
        }),
      );
    });

    it('should filter by both role_id and permission_id when both are provided', async () => {
      const mockFilter = { role_id: '1', permission_id: '2' };
      const findSpy = jest
        .spyOn(rolePermissionRepository, 'find')
        .mockResolvedValue([]);

      await service.findAll(1, 10, 'id', 'ASC', mockFilter);

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            role: { id: mockFilter.role_id },
            permission: { id: mockFilter.permission_id },
          },
        }),
      );
    });

    it('should not filter when no filter is provided', async () => {
      const findSpy = jest
        .spyOn(rolePermissionRepository, 'find')
        .mockResolvedValue([]);

      await service.findAll(1, 10);

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });
  });

  describe('create', () => {
    it('should create a new role permission', async () => {
      const roleId = 'role-id';
      const createRolePermissionDto = {
        role_id: roleId,
        permission_id: 'permission-id',
      };
      const role = { id: roleId } as Role;
      const rolePermission = {
        id: 'role-permission-id',
        role,
      } as RolePermission;

      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest
        .spyOn(rolePermissionRepository, 'create')
        .mockReturnValue(rolePermission);
      jest
        .spyOn(rolePermissionRepository, 'save')
        .mockResolvedValue(rolePermission);

      const result = await service.create(
        roleId,
        createRolePermissionDto,
        userPermissionResponseMock,
      );

      expect(result).toEqual(rolePermission);
      expect(roleRepository.findOneBy).toHaveBeenCalledWith({ id: roleId });
      expect(rolePermissionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ role }),
      );
      expect(rolePermissionRepository.save).toHaveBeenCalledWith(
        rolePermission,
      );
    });

    it('should throw NotFoundException if role not found', async () => {
      const roleId = 'role-id';
      const createRolePermissionDto = {
        role_id: roleId,
        permission_id: 'permission-id',
      };

      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(null);

      await expect(
        service.create(
          roleId,
          createRolePermissionDto,
          userPermissionResponseMock,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw TypeError if the role permission already exists', async () => {
      const roleId = 'role-id';
      const createRolePermissionDto = {
        role_id: roleId,
        permission_id: 'permission-id',
      };
      const role = { id: roleId } as Role;
      const existingRolePermission = {
        id: 'existing-role-permission-id',
        role,
      } as RolePermission;

      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest
        .spyOn(rolePermissionRepository, 'findOne')
        .mockResolvedValue(existingRolePermission);

      await expect(
        service.create(
          roleId,
          createRolePermissionDto,
          userPermissionResponseMock,
        ),
      ).rejects.toThrow(TypeError);
    });

    it('should throw BadRequestException if permission_id is missing', async () => {
      const roleId = 'role-id';
      const createRolePermissionDto = {
        permission_id: '',
        role_id: roleId,
      };

      await expect(
        service.create(
          roleId,
          createRolePermissionDto,
          userPermissionResponseMock,
        ),
      ).rejects.toThrow(TypeError);
    });

    it('should throw NotFoundException if permission not found', async () => {
      const roleId = 'role-id';
      const createRolePermissionDto = {
        role_id: roleId,
        permission_id: 'permission-id',
      };
      const role = { id: roleId } as Role;

      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(permissionRepository, 'findOneBy').mockResolvedValue(null);

      await expect(
        service.create(
          roleId,
          createRolePermissionDto,
          userPermissionResponseMock,
        ),
      ).rejects.toThrow(TypeError);
    });
  });

  describe('update', () => {
    it('should update an existing role permission', async () => {
      const id = 'role-permission-id';
      const updateRolePermissionDto = {
        role_id: 'role-id',
        permission_id: 'permission-id',
      };
      const rolePermission = {
        id,
        role: {} as Role,
        permission: {} as Permission,
      } as RolePermission;
      const role = { id: updateRolePermissionDto.role_id } as Role;
      const permission = {
        id: updateRolePermissionDto.permission_id,
      } as Permission;

      jest
        .spyOn(rolePermissionRepository, 'findOneBy')
        .mockResolvedValue(rolePermission);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest
        .spyOn(permissionRepository, 'findOneBy')
        .mockResolvedValue(permission);
      jest
        .spyOn(rolePermissionRepository, 'save')
        .mockResolvedValue(rolePermission);

      await service.update(id, updateRolePermissionDto);

      expect(rolePermissionRepository.findOneBy).toHaveBeenCalledWith({ id });
      expect(roleRepository.findOneBy).toHaveBeenCalledWith({
        id: updateRolePermissionDto.role_id,
      });
      expect(permissionRepository.findOneBy).toHaveBeenCalledWith({
        id: updateRolePermissionDto.permission_id,
      });
      expect(rolePermissionRepository.save).toHaveBeenCalledWith(
        rolePermission,
      );
    });

    it('should throw NotFoundException if role permission not found', async () => {
      const id = 'role-permission-id';
      const updateRolePermissionDto = {
        role_id: 'role-id',
        permission_id: 'permission-id',
      };

      jest.spyOn(rolePermissionRepository, 'findOneBy').mockResolvedValue(null);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue({ id: 'role-id' } as Role);
      jest.spyOn(permissionRepository, 'findOneBy').mockResolvedValue({ id: 'permission-id' } as Permission);

      await expect(service.update(id, updateRolePermissionDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if role not found', async () => {
      const id = 'role-permission-id';
      const updateRolePermissionDto = {
        role_id: 'role-id',
        permission_id: 'permission-id',
      };
      const rolePermission = { id } as RolePermission;

      jest
        .spyOn(rolePermissionRepository, 'findOneBy')
        .mockResolvedValue(rolePermission);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(null);
      jest.spyOn(permissionRepository, 'findOneBy').mockResolvedValue({ id: 'permission-id' } as Permission);

      await expect(service.update(id, updateRolePermissionDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if permission not found', async () => {
      const id = 'role-permission-id';
      const updateRolePermissionDto = {
        role_id: 'role-id',
        permission_id: 'permission-id',
      };
      const rolePermission = { id } as RolePermission;
      const role = { id: updateRolePermissionDto.role_id } as Role;

      jest
        .spyOn(rolePermissionRepository, 'findOneBy')
        .mockResolvedValue(rolePermission);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(permissionRepository, 'findOneBy').mockResolvedValue(null);

      await expect(service.update(id, updateRolePermissionDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('should delete a role permission', async () => {
      const id = 'role-permission-id';
      const mockRolePermission = { id, role: { id: 'role-1' }, permission: { id: 'permission-1' } };

      jest.spyOn(rolePermissionRepository, 'findOneBy').mockResolvedValue(mockRolePermission as any);
      jest
        .spyOn(rolePermissionRepository, 'delete')
        .mockResolvedValue({ affected: 1 } as any);

      await service.delete(id);

      expect(rolePermissionRepository.findOneBy).toHaveBeenCalledWith({ id });
      expect(rolePermissionRepository.delete).toHaveBeenCalledWith(id);
    });

    it('should throw NotFoundException if role permission not found', async () => {
      const id = 'role-permission-id';

      jest.spyOn(rolePermissionRepository, 'findOneBy').mockResolvedValue(null);

      await expect(service.delete(id)).rejects.toThrow(NotFoundException);
    });

    it('should handle errors in delete operation', async () => {
      const id = 'role-permission-id';
      const mockRolePermission = { id, role: { id: 'role-1' }, permission: { id: 'permission-1' } };

      jest.spyOn(rolePermissionRepository, 'findOneBy').mockResolvedValue(mockRolePermission as any);
      jest
        .spyOn(rolePermissionRepository, 'delete')
        .mockRejectedValue(new Error('Database error'));

      await expect(service.delete(id)).rejects.toThrow('Database error');
    });
  });

  describe('findOne', () => {
    it('should find a role permission by id', async () => {
      const id = 'role-permission-id';
      const rolePermission = { id } as RolePermission;

      jest
        .spyOn(rolePermissionRepository, 'findOne')
        .mockResolvedValue(rolePermission);

      const result = await service.findOne(id);

      expect(result).toEqual(rolePermission);
      expect(rolePermissionRepository.findOne).toHaveBeenCalledWith({
        where: { id },
        relations: { role: true },
      });
    });

    it('should throw NotFoundException if role permission not found', async () => {
      const id = 'role-permission-id';

      jest.spyOn(rolePermissionRepository, 'findOne').mockResolvedValue(null);

      await expect(service.findOne(id)).rejects.toThrow(NotFoundException);
    });
  });

  // Database error handling tests
  describe('Database Error Handling', () => {
    const createRolePermissionDto = {
      role_id: 'role-1',
      permission_id: 'permission-1',
    };

    const updateRolePermissionDto = {
      permission_id: 'permission-2',
    };

    const mockRolePermission = {
      id: '1',
      role_id: 'role-1',
      permission_id: 'permission-1',
      role: { id: 'role-1' } as any,
      permission: { id: 'permission-1' } as any,
      created_at: new Date(),
      created_by: 'user-id',
      updated_at: new Date(),
      updated_by: 'user-id',
      populateWhoColumns: jest.fn(),
    };

    beforeEach(() => {
      resetLoggerMocks();
    });

    it('should handle database errors in create and log them', async () => {
      const dbError = new Error('Database connection failed');
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue({ id: 'role-1' } as any);
      jest.spyOn(permissionRepository, 'findOneBy').mockResolvedValue({ id: 'permission-1' } as any);
      jest.spyOn(rolePermissionRepository, 'create').mockReturnValue(mockRolePermission as any);
      jest.spyOn(rolePermissionRepository, 'save').mockRejectedValue(dbError);

      await expect(service.create('role-1', createRolePermissionDto, userPermissionResponseMock))
        .rejects.toThrow('Database connection failed');

      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to create role permission',
        dbError
      );
    });

    it('should handle database errors in findAll and log them', async () => {
      const dbError = new Error('Database query failed');
      jest.spyOn(rolePermissionRepository, 'find').mockRejectedValue(dbError);

      await expect(service.findAll()).rejects.toThrow('Database query failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to retrieve role permissions list',
        dbError
      );
    });

    it('should handle database errors in findOne and log them', async () => {
      const dbError = new Error('Database connection failed');
      jest.spyOn(rolePermissionRepository, 'findOne').mockRejectedValue(dbError);

      await expect(service.findOne('1')).rejects.toThrow('Database connection failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to retrieve role permission',
        dbError
      );
    });

    it('should handle database errors in update and log them', async () => {
      const dbError = new Error('Database update failed');
      jest.spyOn(rolePermissionRepository, 'findOneBy').mockRejectedValue(dbError);

      await expect(service.update('1', updateRolePermissionDto))
        .rejects.toThrow('Database update failed');

      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to update role permission',
        dbError
      );
    });

    it('should handle database errors in delete and log them', async () => {
      const dbError = new Error('Database delete failed');
      jest.spyOn(rolePermissionRepository, 'findOneBy').mockRejectedValue(dbError);

      await expect(service.delete('1')).rejects.toThrow('Database delete failed');
      expect(mockLoggerFactory.create().error).toHaveBeenCalledWith(
        'Failed to delete role permission',
        dbError
      );
    });
  });
});
