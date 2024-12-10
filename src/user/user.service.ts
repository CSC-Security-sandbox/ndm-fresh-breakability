import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '../entities/user-role.entity';
import { Account } from '../entities/account.entity';
import { Project } from '../entities/project.entity';
import { Role } from '../entities/role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,

    @InjectRepository(UserRole)
    private userRoleRepository: Repository<UserRole>,

    @InjectRepository(Role)
    private roleRepository: Repository<Role>,

    @InjectRepository(RolePermission) 
    private rolePermissionRepository: Repository<RolePermission>,

    @InjectRepository(Project)
    private projectRepository: Repository<Project>,

    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
  ) {}

  create(createUserDto: CreateUserDto, userPermissions:UserPermissionResponse): Promise<User> {
    const user = this.userRepository.create({
      ...createUserDto,
      user_status: 'active',
    });
    user.populateWhoColumns(userPermissions.user.id);
    return this.userRepository.save(user);
  }


  async findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateUserDto> = {},
  ): Promise<User[]> {
    const options: FindManyOptions<User> = {
      skip: (page - 1) * limit,
      take: limit,
      order: {
        [sortField]: sortOrder,
      },
      where: filter
    };
   
    const users = await this.userRepository.find(options);
   
    const transformedUsers = await Promise.all(
      users.map(async (user) => {
        const createdByUser = await this.userRepository.findOne({
          where: { id: user.created_by },
          select: ['id', 'email', 'user_status'],
        });

        const updatedByUser = await this.userRepository.findOne({
          where: { id: user.updated_by },
          select: ['id', 'email', 'user_status'],
        });

        return {
          ...user,
          created_by: createdByUser,
          updated_by: updatedByUser,
        } as any;
      }),
    );
   
    return transformedUsers;
  }

  async findOne(id: string): Promise<User> {
    return await this.userRepository.findOneBy({ id: id });
  }

  async update(id: string, updateUserDto: UpdateUserDto, userPermissions:UserPermissionResponse): Promise<void> {
    await this.userRepository.update(id, {
      ...updateUserDto,
      updated_by: userPermissions.user.id,
    });
  }

  async delete(id: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['user_roles'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.userRepository.remove(user);
  }

  async inactivate(id: string): Promise<void> {
    await this.userRepository.update(id, {
      user_status: 'inactive',
    });
  }

  async getUserProjectsAndPermissions(email: string, projectId?: string) {
    const user = await this.userRepository.findOne({
      where: { email },
      relations: ['user_roles', 'user_roles.role', 'user_roles.project'],
    });

    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }

    if (projectId) {
      const userRolesInProject = user.user_roles.filter(
        (userRole) => userRole.project?.id === projectId,
      );
      if (userRolesInProject.length === 0) {
        throw new NotFoundException(`User has no role in project with ID ${projectId}`);
      }
      return {
        projectId,
        projectName: userRolesInProject[0]?.project.project_name,
        role: userRolesInProject[0]?.role.role_name,
        permissionsOfProject: await this.getPermissionsByRoles(userRolesInProject[0]?.role.id),
      };
    } else {
      return await Promise.all(
        user.user_roles.map(async (ur) => ({
          projectId: ur.project?.id || null,
          projectName: ur.project?.project_name || null,
          role: ur.role.role_name,
          permissionsOfProject: await this.getPermissionsByRoles(ur.role.id),
        }))
      );
    }
  }

  public async getPermissionsByRoles(roleId: string) {
    const rolePermissions = await this.rolePermissionRepository.find({
      where: { role: { id: roleId } },
      relations: ['permission'],
    });
    return rolePermissions.map((rp) => rp.permission.permission_name);
  }

}

