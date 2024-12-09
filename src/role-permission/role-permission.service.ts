import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, FindOptionsWhere, Repository } from 'typeorm';
import { CreateRolePermissionDto } from './dto/create-role-permission.dto';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserPermissionResponse } from 'src/auth/auth-user.type';

@Injectable()
export class RolePermissionService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
  ) {}

  async create(
    roleId: string,
    createRolePermissionDto: CreateRolePermissionDto,
    userPermissionResponse:UserPermissionResponse
  ): Promise<RolePermission> {
    const role = await this.roleRepository.findOneBy({ id: roleId });
    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    const rolePermission = this.rolePermissionRepository.create({
      ...createRolePermissionDto,
      id: userPermissionResponse.user.id,
      role,
    });

    return this.rolePermissionRepository.save(rolePermission);
  }

  async update(
    id: string,
    updateRolePermissionDto: UpdateRolePermissionDto,
  ): Promise<void> {
    const rolePermission = await this.rolePermissionRepository.findOneBy({
      id,
    });

    if (!rolePermission) {
      throw new NotFoundException(`RolePermission with ID ${id} not found`);
    }

    const role = await this.roleRepository.findOneBy({
      id: updateRolePermissionDto.role_id,
    });
    if (!role) {
      throw new NotFoundException(
        `Role with ID ${updateRolePermissionDto.role_id} not found`,
      );
    }

    const permission = await this.permissionRepository.findOneBy({
      id: updateRolePermissionDto.permission_id,
    });
    if (!permission) {
      throw new NotFoundException(
        `Permission with ID ${updateRolePermissionDto.permission_id} not found`,
      );
    }

    rolePermission.role = role;
    rolePermission.permission = permission;

    await this.rolePermissionRepository.save(rolePermission);
  }

  async delete(id: string): Promise<void> {
    const result = await this.rolePermissionRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`RolePermission with ID ${id} not found`);
    }
  }

  async findOne(id: string): Promise<RolePermission> {
    const rolePermission = await this.rolePermissionRepository.findOne({
      where: { id },
      relations: ['role'],
    });

    if (!rolePermission) {
      throw new NotFoundException(`RolePermission with ID ${id} not found`);
    }

    return rolePermission;
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateRolePermissionDto> = {},
  ): Promise<RolePermission[]> {
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
      relations: ['role', 'permission'],
    };

    return this.rolePermissionRepository.find(options);
  }
}
