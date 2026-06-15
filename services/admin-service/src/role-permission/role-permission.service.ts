import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';
import { CreateRolePermissionDto } from './dto/create-role-permission.dto';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class RolePermissionService {
  private readonly logger: LoggerService;
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(RolePermissionService.name);
  }

  async create(
    roleId: string,
    createRolePermissionDto: CreateRolePermissionDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<RolePermission> {
    try {
      this.logger.log('Creating new role permission', {
        roleId,
        userId: userPermissionResponse.user.id,
        rolePermissionData: createRolePermissionDto
      });

      const role = await this.roleRepository.findOneBy({ id: roleId });
      if (!role) {
        this.logger.warn('Role not found for role permission creation', { roleId });
        throw new NotFoundException(`Role with ID ${roleId} not found`);
      }

      const rolePermission = this.rolePermissionRepository.create({
        ...createRolePermissionDto,
        id: userPermissionResponse.user.id,
        role,
      });

      const savedRolePermission = await this.rolePermissionRepository.save(rolePermission);

      this.logger.log('Role permission created successfully', {
        rolePermissionId: savedRolePermission.id,
        roleId,
        userId: userPermissionResponse.user.id
      });

      return savedRolePermission;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to create role permission', error);
      throw error;
    }
  }

  async update(
    id: string,
    updateRolePermissionDto: UpdateRolePermissionDto,
  ): Promise<void> {
    try {
      this.logger.log('Updating role permission', {
        rolePermissionId: id
      });

      const [rolePermission, role, permission] = await Promise.all([
        this.rolePermissionRepository.findOneBy({ id }),
        this.roleRepository.findOneBy({ id: updateRolePermissionDto.role_id }),
        this.permissionRepository.findOneBy({ id: updateRolePermissionDto.permission_id }),
      ]);

      if (!rolePermission) {
        this.logger.warn('Role permission not found for update', { rolePermissionId: id });
        throw new NotFoundException(`RolePermission with ID ${id} not found`);
      }

      if (!role) {
        this.logger.warn('Role not found for role permission update', {
          roleId: updateRolePermissionDto.role_id
        });
        throw new NotFoundException(
          `Role with ID ${updateRolePermissionDto.role_id} not found`,
        );
      }

      if (!permission) {
        this.logger.warn('Permission not found for role permission update', {
          permissionId: updateRolePermissionDto.permission_id
        });
        throw new NotFoundException(
          `Permission with ID ${updateRolePermissionDto.permission_id} not found`,
        );
      }

      rolePermission.role = role;
      rolePermission.permission = permission;

      await this.rolePermissionRepository.save(rolePermission);

      this.logger.log('Successfully updated role permission', { rolePermissionId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update role permission', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.logger.log('Deleting role permission', { rolePermissionId: id });

      // Check if role permission exists first
      const existingRolePermission = await this.rolePermissionRepository.findOneBy({ id });
      if (!existingRolePermission) {
        this.logger.warn('Role permission not found for deletion', { rolePermissionId: id });
        throw new NotFoundException(`RolePermission with ID ${id} not found`);
      }

      const result = await this.rolePermissionRepository.delete(id);
      if (result.affected === 0) {
        this.logger.warn('Role permission deletion had no effect', { rolePermissionId: id });
        throw new NotFoundException(`RolePermission with ID ${id} not found`);
      }

      this.logger.log('Successfully deleted role permission', { rolePermissionId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete role permission', error);
      throw error;
    }
  }

  async findOne(id: string): Promise<RolePermission> {
    try {
      this.logger.log(`Retrieving role permission by ID: ${id}`);

      const rolePermission = await this.rolePermissionRepository.findOne({
        where: { id },
        relations: { role: true },
      });

      if (!rolePermission) {
        this.logger.warn('Role permission not found', { rolePermissionId: id });
        throw new NotFoundException(`RolePermission with ID ${id} not found`);
      }

      this.logger.log('Successfully retrieved role permission', { rolePermissionId: id });
      return rolePermission;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to retrieve role permission', error);
      throw error;
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateRolePermissionDto> = {},
  ): Promise<RolePermission[]> {
    try {
      this.logger.log('Retrieving role permissions list', {
        page,
        limit,
        sortField,
        sortOrder
      });

      const where: FindOptionsWhere<RolePermission> = {};

      if (filter.role_id) {
        where.role = { id: filter.role_id };
      }
      if (filter.permission_id) {
        where.permission = { id: filter.permission_id };
      }

      const options: FindManyOptions<RolePermission> = {
        skip: (page - 1) * limit,
        take: limit,
        order: {
          [sortField]: sortOrder,
        },
        where,
        relations: { role: true, permission: true },
      };

      const rolePermissions = await this.rolePermissionRepository.find(options);

      this.logger.log('Successfully retrieved role permissions', {
        count: rolePermissions.length,
        page,
        limit
      });
      return rolePermissions;
    } catch (error) {
      this.logger.error('Failed to retrieve role permissions list', error);
      throw error;
    }
  }
}
