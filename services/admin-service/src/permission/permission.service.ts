import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class PermissionService {
  private readonly logger: LoggerService;
  constructor(
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(PermissionService.name);
  }

  async create(
    createPermissionDto: CreatePermissionDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<Permission> {
    try {
      this.logger.log('Creating new permission', {
        userId: userPermissionResponse.user.id,
        permissionData: createPermissionDto
      });

      const permission = this.permissionRepository.create({
        ...createPermissionDto,
        permission_status: 'active',
      });
      permission.populateWhoColumns(userPermissionResponse.user.id);
      const savedPermission = await this.permissionRepository.save(permission);

      this.logger.log('Permission created successfully', {
        permissionId: savedPermission.id,
        userId: userPermissionResponse.user.id
      });

      return savedPermission;
    } catch (error) {
      this.logger.error('Failed to create permission for user', error);
      throw error;
    }
  }

  async findAll(): Promise<Permission[]> {
    try {
      this.logger.log('Retrieving active permissions list');

      const permissions = await this.permissionRepository.find({
        where: {
          permission_status: 'active',
        },
        take: 1000,
      });

      this.logger.log('Successfully retrieved permissions', {
        count: permissions.length
      });
      return permissions;
    } catch (error) {
      this.logger.error('Failed to retrieve permissions list', error);
      throw error;
    }
  }

  async findOne(id: string): Promise<Permission> {
    try {
      this.logger.log(`Retrieving permission by ID: ${id}`);

      const permission = await this.permissionRepository.findOneBy({ id: id });

      if (!permission) {
        this.logger.warn('Permission not found', { permissionId: id });
        throw new NotFoundException(`Permission with ID ${id} not found`);
      }

      this.logger.log('Successfully retrieved permission', { permissionId: id });
      return permission;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to retrieve permission', error);
      throw error;
    }
  }

  async update(
    id: string,
    updatePermissionDto: UpdatePermissionDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<void> {
    try {
      this.logger.log('Updating permission', {
        permissionId: id,
        userId: userPermissionResponse.user.id
      });

      const existingPermission = await this.permissionRepository.findOneBy({ id });
      if (!existingPermission) {
        this.logger.warn('Permission not found for update', { permissionId: id });
        throw new NotFoundException(`Permission with ID ${id} not found`);
      }

      await this.permissionRepository.update(id, {
        ...updatePermissionDto,
        updated_by: userPermissionResponse.user.id,
      });

      this.logger.log('Successfully updated permission', { permissionId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update permission', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.logger.log('Deleting permission', { permissionId: id });

      const existingPermission = await this.permissionRepository.findOneBy({ id });
      if (!existingPermission) {
        this.logger.warn('Permission not found for deletion', { permissionId: id });
        throw new NotFoundException(`Permission with ID ${id} not found`);
      }

      await this.permissionRepository.delete(id);

      this.logger.log('Successfully deleted permission', { permissionId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete permission', error);
      throw error;
    }
  }

  async inactivate(id: string): Promise<void> {
    try {
      this.logger.log('Inactivating permission', { permissionId: id });

      const existingPermission = await this.permissionRepository.findOneBy({ id });
      if (!existingPermission) {
        this.logger.warn('Permission not found for inactivation', { permissionId: id });
        throw new NotFoundException(`Permission with ID ${id} not found`);
      }

      await this.permissionRepository.update(id, {
        permission_status: 'inactive',
      });

      this.logger.log('Successfully inactivated permission', { permissionId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to inactivate permission', error);
      throw error;
    }
  }
}
