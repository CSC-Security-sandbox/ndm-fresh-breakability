import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class RoleService {
  private readonly logger: LoggerService;
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(RoleService.name);
  }

  async create(
    createRoleDto: CreateRoleDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<Role> {
    try {
      this.logger.log('Creating new role', {
        userId: userPermissionResponse.user.id,
        roleData: createRoleDto
      });

      const role = this.roleRepository.create({
        ...createRoleDto,
        role_status: 'active',
      });
      role.populateWhoColumns(userPermissionResponse.user.id);
      const savedRole = await this.roleRepository.save(role);

      this.logger.log('Role created successfully', {
        roleId: savedRole.id,
        userId: userPermissionResponse.user.id
      });

      return savedRole;
    } catch (error) {
      this.logger.error('Failed to create role for user', error);
      throw error;
    }
  }

  async findAll(): Promise<Role[]> {
    try {
      this.logger.log('Retrieving active roles list');

      const roles = await this.roleRepository.find({
        where: {
          role_status: 'active',
        },
        relations: { role_permissions: true },
      });

      this.logger.log('Successfully retrieved roles', {
        count: roles.length
      });
      return roles;
    } catch (error) {
      this.logger.error('Failed to retrieve roles list', error);
      throw error;
    }
  }

  async findOne(id: string): Promise<Role> {
    try {
      this.logger.log(`Retrieving role by ID: ${id}`);

      const role = await this.roleRepository.findOneBy({ id: id });

      if (!role) {
        this.logger.warn('Role not found', { roleId: id });
        throw new NotFoundException(`Role with ID ${id} not found`);
      }

      this.logger.log('Successfully retrieved role', { roleId: id });
      return role;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to retrieve role', error);
      throw error;
    }
  }

  async update(
    id: string,
    updateRoleDto: UpdateRoleDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<void> {
    try {
      this.logger.log('Updating role', {
        roleId: id,
        userId: userPermissionResponse.user.id
      });

      // Check if role exists first
      const existingRole = await this.roleRepository.findOneBy({ id });
      if (!existingRole) {
        this.logger.warn('Role not found for update', { roleId: id });
        throw new NotFoundException(`Role with ID ${id} not found`);
      }

      await this.roleRepository.update(id, {
        ...updateRoleDto,
        updated_by: userPermissionResponse.user.id,
      });

      this.logger.log('Successfully updated role', { roleId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update role', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.logger.log('Deleting role', { roleId: id });

      // Check if role exists first
      const existingRole = await this.roleRepository.findOneBy({ id });
      if (!existingRole) {
        this.logger.warn('Role not found for deletion', { roleId: id });
        throw new NotFoundException(`Role with ID ${id} not found`);
      }

      await this.roleRepository.delete(id);

      this.logger.log('Successfully deleted role', { roleId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete role', error);
      throw error;
    }
  }

  async inactivate(id: string): Promise<void> {
    try {
      this.logger.log('Inactivating role', { roleId: id });

      // Check if role exists first
      const existingRole = await this.roleRepository.findOneBy({ id });
      if (!existingRole) {
        this.logger.warn('Role not found for inactivation', { roleId: id });
        throw new NotFoundException(`Role with ID ${id} not found`);
      }

      await this.roleRepository.update(id, {
        role_status: 'inactive',
      });

      this.logger.log('Successfully inactivated role', { roleId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to inactivate role', error);
      throw error;
    }
  }
}
