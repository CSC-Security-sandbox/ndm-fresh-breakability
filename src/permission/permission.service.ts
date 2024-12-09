import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { UserPermissionResponse } from 'src/auth/auth-user.type';

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
  ) {}

  create(createPermissionDto: CreatePermissionDto, userPermissionResponse:UserPermissionResponse): Promise<Permission> {
    const permission = this.permissionRepository.create({
      ...createPermissionDto,
      permission_status: 'active',
    });
    permission.populateWhoColumns(userPermissionResponse.user.id);
    return this.permissionRepository.save(permission);
  }

  findAll(): Promise<Permission[]> {
    return this.permissionRepository.find({
      where: {
        permission_status: 'active',
      },
    });
  }

  async findOne(id: string): Promise<Permission> {
    return await this.permissionRepository.findOneBy({ id: id });
  }

  async update(
    id: string,
    updatePermissionDto: UpdatePermissionDto,
    userPermissionResponse:UserPermissionResponse
  ): Promise<void> {
    await this.permissionRepository.update(id, {
      ...updatePermissionDto,
      updated_by: userPermissionResponse.user.id,
    });
  }

  async delete(id: string): Promise<void> {
    await this.permissionRepository.delete(id);
  }

  async inactivate(id: string): Promise<void> {
    await this.permissionRepository.update(id, {
      permission_status: 'inactive',
    });
  }
}
