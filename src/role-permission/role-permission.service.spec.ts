import { Test, TestingModule } from '@nestjs/testing';
import { RolePermissionService } from './role-permission.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
 
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
      ],
    }).compile();
 
    service = module.get<RolePermissionService>(RolePermissionService);
    roleRepository = module.get<Repository<Role>>(getRepositoryToken(Role));
    permissionRepository = module.get<Repository<Permission>>(getRepositoryToken(Permission));
    rolePermissionRepository = module.get<Repository<RolePermission>>(getRepositoryToken(RolePermission));
  });
 
  it('should be defined', () => {
    expect(service).toBeDefined();
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
      jest.spyOn(rolePermissionRepository, 'create').mockReturnValue(rolePermission);
      jest.spyOn(rolePermissionRepository, 'save').mockResolvedValue(rolePermission);
 
      const result = await service.create(roleId, createRolePermissionDto);
 
      expect(result).toEqual(rolePermission);
      expect(roleRepository.findOneBy).toHaveBeenCalledWith({ id: roleId });
      expect(rolePermissionRepository.create).toHaveBeenCalledWith(expect.objectContaining({ role }));
      expect(rolePermissionRepository.save).toHaveBeenCalledWith(rolePermission);
    });
 
    it('should throw NotFoundException if role not found', async () => {
      const roleId = 'role-id';
      const createRolePermissionDto = {
        role_id: roleId,
        permission_id: 'permission-id',
      };
 
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(null);
 
      await expect(service.create(roleId, createRolePermissionDto)).rejects.toThrow(NotFoundException);
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
      jest.spyOn(rolePermissionRepository, 'findOne').mockResolvedValue(existingRolePermission);
 
      await expect(service.create(roleId, createRolePermissionDto)).rejects.toThrow(TypeError);
    });
 
    it('should throw BadRequestException if permission_id is missing', async () => {
      const roleId = 'role-id';
      const createRolePermissionDto = {
        permission_id:'',
        role_id: roleId,
      };
 
      await expect(service.create(roleId, createRolePermissionDto)).rejects.toThrow(TypeError);
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
 
      await expect(service.create(roleId, createRolePermissionDto)).rejects.toThrow(TypeError);
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
      const permission = { id: updateRolePermissionDto.permission_id } as Permission;
 
      jest.spyOn(rolePermissionRepository, 'findOneBy').mockResolvedValue(rolePermission);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(permissionRepository, 'findOneBy').mockResolvedValue(permission);
      jest.spyOn(rolePermissionRepository, 'save').mockResolvedValue(rolePermission);
 
      await service.update(id, updateRolePermissionDto);
 
      expect(rolePermissionRepository.findOneBy).toHaveBeenCalledWith({ id });
      expect(roleRepository.findOneBy).toHaveBeenCalledWith({ id: updateRolePermissionDto.role_id });
      expect(permissionRepository.findOneBy).toHaveBeenCalledWith({ id: updateRolePermissionDto.permission_id });
      expect(rolePermissionRepository.save).toHaveBeenCalledWith(rolePermission);
    });
 
    it('should throw NotFoundException if role permission not found', async () => {
      const id = 'role-permission-id';
      const updateRolePermissionDto = {
        role_id: 'role-id',
        permission_id: 'permission-id',
      };
 
      jest.spyOn(rolePermissionRepository, 'findOneBy').mockResolvedValue(null);
 
      await expect(service.update(id, updateRolePermissionDto)).rejects.toThrow(NotFoundException);
    });
 
    it('should throw NotFoundException if role not found', async () => {
      const id = 'role-permission-id';
      const updateRolePermissionDto = {
        role_id: 'role-id',
        permission_id: 'permission-id',
      };
      const rolePermission = { id } as RolePermission;
 
      jest.spyOn(rolePermissionRepository, 'findOneBy').mockResolvedValue(rolePermission);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(null);
 
      await expect(service.update(id, updateRolePermissionDto)).rejects.toThrow(NotFoundException);
    });
 
    it('should throw NotFoundException if permission not found', async () => {
      const id = 'role-permission-id';
      const updateRolePermissionDto = {
        role_id: 'role-id',
        permission_id: 'permission-id',
      };
      const rolePermission = { id } as RolePermission;
      const role = { id: updateRolePermissionDto.role_id } as Role;
 
      jest.spyOn(rolePermissionRepository, 'findOneBy').mockResolvedValue(rolePermission);
      jest.spyOn(roleRepository, 'findOneBy').mockResolvedValue(role);
      jest.spyOn(permissionRepository, 'findOneBy').mockResolvedValue(null);
 
      await expect(service.update(id, updateRolePermissionDto)).rejects.toThrow(NotFoundException);
    });
  });
 
  describe('delete', () => {
    it('should delete a role permission', async () => {
      const id = 'role-permission-id';

      jest
        .spyOn(rolePermissionRepository, 'delete')
        .mockResolvedValue({ affected: 1 } as any);

      await service.delete(id);

      expect(rolePermissionRepository.delete).toHaveBeenCalledWith(id);
    });

    it('should throw NotFoundException if role permission not found', async () => {
      const id = 'role-permission-id';

      jest
        .spyOn(rolePermissionRepository, 'delete')
        .mockResolvedValue({ affected: 0 } as any);

      await expect(service.delete(id)).rejects.toThrow(NotFoundException);
    });

    it('should handle errors in delete operation', async () => {
      const id = 'role-permission-id';

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
        relations: ['role'],
      });
    });

    it('should throw NotFoundException if role permission not found', async () => {
      const id = 'role-permission-id';

      jest
        .spyOn(rolePermissionRepository, 'findOne')
        .mockResolvedValue(null);

      await expect(service.findOne(id)).rejects.toThrow(NotFoundException);
    });
  });
});