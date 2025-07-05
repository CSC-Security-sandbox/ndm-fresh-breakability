import {
  Inject,
  Injectable
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class RoleService {
  private readonly logger : LoggerService;
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @Inject(LoggerFactory) private loggerFactory: LoggerFactory,
  ) {
    this.logger = this.loggerFactory.create(RoleService.name);
  }

  test() {
    this.logger.log('This is a test log message from RoleService');
    this.logger.error('This is a test error message from RoleService');
    this.logger.warn('This is a test warning message from RoleService');
    this.logger.debug('This is a test debug message from RoleService');
  }

  create(
    createRoleDto: CreateRoleDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<Role> {
    const role = this.roleRepository.create({
      ...createRoleDto,
      role_status: 'active',
    });
    role.populateWhoColumns(userPermissionResponse.user.id);
    return this.roleRepository.save(role);
  }

  findAll(): Promise<Role[]> {
    return this.roleRepository.find({
      where: {
        role_status: 'active',
      },
      relations: ['role_permissions'],
    });
  }

  async findOne(id: string): Promise<Role> {
    return await this.roleRepository.findOneBy({ id: id });
  }

  async update(
    id: string,
    updateRoleDto: UpdateRoleDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<void> {
    await this.roleRepository.update(id, {
      ...updateRoleDto,
      updated_by: userPermissionResponse.user.id,
    });
  }

  async delete(id: string): Promise<void> {
    await this.roleRepository.delete(id);
  }

  async inactivate(id: string): Promise<void> {
    await this.roleRepository.update(id, {
      role_status: 'inactive',
    });
  }
}
