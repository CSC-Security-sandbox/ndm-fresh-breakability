import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, FindOptionsWhere, In } from 'typeorm';
import { CreateUserRoleDto } from './dto/create-user-role.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { UserRole } from '../entities/user-role.entity';
import { randomUUID } from 'crypto';
import { UserRoleMappingDto, UserRoleMappingResponseDto, UserRoleRelationDto } from './dto/user-role.dto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';

@Injectable()
export class UserRoleService {
 
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}


  async batchCreate(userRoleRelationDto: UserRoleRelationDto) {
    //  --------------- validate Details -------------/
    const project = await this.projectRepository.findOne({
      where: {id: userRoleRelationDto.project_id}
    })
    if(!project) 
    throw new NotFoundException(
      `project with ID ${userRoleRelationDto.project_id} not found`,
    );

    const account = await this.accountRepository.findOne({
      where: {id: userRoleRelationDto.account_id}
    })
    if(!account) 
    throw new NotFoundException(
      `Account with ID ${userRoleRelationDto.account_id} not found`,
    );

    const users = new Map<string, number>(), roles = new Map<string, number>();

    userRoleRelationDto.users.forEach(userMap=>{
      users.set(userMap.user_id, 1), roles.set(userMap.role_id, 1)
    })

    const usersStoreList = await this.userRepository.find({
      where: {id: In(userRoleRelationDto.users.map(user=> user.user_id))},
      select: {id: true}
    })

    if(usersStoreList.length !== users.size) {
      usersStoreList.forEach(user=> [
        users.set(user.id, users.get(user.id)+1)
      ])
      const invalidUsers: string[] = []
      users.forEach((v, k)=>{if(v===1) invalidUsers.push(k)})
      throw new NotFoundException(
        `User with ID ${invalidUsers.join(', ')} not found`,
      );
    }

    const roleStoreList = await this.roleRepository.find({
      where: {id: In(userRoleRelationDto.users.map(user=> user.role_id))},
      select: {id: true}
    })

    if(roleStoreList.length !== roles.size) {
      roleStoreList.forEach(user=> [
        roles.set(user.id, roles.get(user.id)+1)
      ])
      const invalidRoles: string[] = []
      roles.forEach((v, k)=>{if(v===1) invalidRoles.push(k)})
      throw new NotFoundException(
        `Role with ID ${invalidRoles.join(', ')} not found`,
      );
    }

    await this.userRoleRepository.delete({
      projectId: project.id, accountId: account.id
    })

    const update: UserRole[] = userRoleRelationDto.users.map(userMap=>
      this.userRoleRepository.create({
      projectId: project.id,
      accountId: account.id,
      roleId: userMap.role_id,
      userId: userMap.user_id,
    }))
    return await this.userRoleRepository.save(update)
  } 


  async create(createUserRoleDto: CreateUserRoleDto, userPermissionResponse:UserPermissionResponse): Promise<UserRole> {
    const user = await this.userRepository.findOneBy({
      id: createUserRoleDto.user_id,
    });
    if (!user) {
      throw new NotFoundException(
        `User with ID ${createUserRoleDto.user_id} not found`,
      );
    }

    const role = await this.roleRepository.findOneBy({
      id: createUserRoleDto.role_id,
    });
    if (!role) {
      throw new NotFoundException(
        `Role with ID ${createUserRoleDto.role_id} not found`,
      );
    }

    const project = createUserRoleDto.project_id
      ? await this.projectRepository.findOneBy({
          id: createUserRoleDto.project_id,
        })
      : null;

    const account = await this.accountRepository.findOneBy({
      id: createUserRoleDto.account_id,
    });
    if (!account) {
      throw new NotFoundException(
        `Account with ID ${createUserRoleDto.account_id} not found`,
      );
    }

    const userRole = this.userRoleRepository.create({
      id: randomUUID(),
      user,
      role,
      project,
      account,
    });

    userRole.populateWhoColumns(userPermissionResponse.user.id);

    return this.userRoleRepository.save(userRole);
  }

  async update(
    id: string,
    updateUserRoleDto: UpdateUserRoleDto,
    userPermissionResponse:UserPermissionResponse
  ): Promise<void> {
    const userRole = await this.userRoleRepository.findOneBy({ id });

    if (!userRole) {
      throw new NotFoundException(`UserRole with ID ${id} not found`);
    }

    const user = await this.userRepository.findOneBy({
      id: updateUserRoleDto.user_id,
    });
    if (!user) {
      throw new NotFoundException(
        `User with ID ${updateUserRoleDto.user_id} not found`,
      );
    }

    const role = await this.roleRepository.findOneBy({
      id: updateUserRoleDto.role_id,
    });
    if (!role) {
      throw new NotFoundException(
        `Role with ID ${updateUserRoleDto.role_id} not found`,
      );
    }

    const project = updateUserRoleDto.project_id
      ? await this.projectRepository.findOneBy({
          id: updateUserRoleDto.project_id,
        })
      : null;

    const account = await this.accountRepository.findOneBy({
      id: updateUserRoleDto.account_id,
    });
    if (!account) {
      throw new NotFoundException(
        `Account with ID ${updateUserRoleDto.account_id} not found`,
      );
    }

    userRole.user = user;
    userRole.role = role;
    userRole.project = project;
    userRole.account = account;

    userRole.populateWhoColumns(userPermissionResponse.user.id); // Fake user

    await this.userRoleRepository.save(userRole);
  }

  async delete(id: string): Promise<void> {
    const result = await this.userRoleRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`UserRole with ID ${id} not found`);
    }
  }

  async findOne(id: string): Promise<UserRole> {
    const userRole = await this.userRoleRepository.findOne({
      where: { id },
      relations: ['user', 'role', 'project', 'account'],
    });

    if (!userRole) {
      throw new NotFoundException(`UserRole with ID ${id} not found`);
    }

    return userRole;
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateUserRoleDto> = {},
  ): Promise<UserRole[]> {
    const where: FindOptionsWhere<UserRole> = {};
 
    if (filter.user_id) {
      where.user = { id: filter.user_id };
    }
    if (filter.role_id) {
      where.role = { id: filter.role_id };
    }
    if (filter.project_id) {
      where.project = { id: filter.project_id };
    }
    if (filter.account_id) {
      where.account = { id: filter.account_id };
    }

    const options: FindManyOptions<UserRole> = {
      skip: (page - 1) * limit,
      take: limit,
      order: {
        [sortField]: sortOrder,
      },
      where,
      relations: ['user', 'role', 'project', 'account'],
    };

    return this.userRoleRepository.find(options);
  }

 async fetchUsersAndRoles(page: number, limit: number, sortField: string, sortOrder: string, filter: Partial<CreateUserRoleDto>={}): Promise<UserRoleMappingResponseDto> {
    const where: FindOptionsWhere<UserRole> = {};
    if (filter.user_id) {
      where.user = { id: filter.user_id };
    }
    const options: FindManyOptions<User> = {
      skip: (page - 1) * limit,
      take: limit,
      order: {
        [sortField]: sortOrder,
      },
      relations: ['user_roles', 'user_roles.role'],
    };
    const [users,total] =  await this.userRepository.findAndCount(options);

    const userRoleMapping = users.map((user) => ({
      userId: user.id,
      userName: user.name,
      userStatus: user.user_status,
      roles: user.user_roles.map((userRole) => ({
        roleId: userRole.role.id,
        roleName: userRole.role.role_name,
        projectId: userRole.project?.id || null,
      })),
    }));

    return {total,page,limit,data:userRoleMapping};
}
}
