import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { randomUUID } from 'crypto';
import { Role } from '../entities/role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
  ) {}

  create(createRoleDto: CreateRoleDto): Promise<Role> {
    const role = this.roleRepository.create({
      ...createRoleDto,
      role_status: 'active',
    });
    //TODO: get user from bearer token
    role.populateWhoColumns(randomUUID()); // This is a fake user
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

  async update(id: string, updateRoleDto: UpdateRoleDto): Promise<void> {
    await this.roleRepository.update(id, {
      ...updateRoleDto,
      //TODO: get user from bearer token
      updated_by: randomUUID(), // This is a fake user
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
