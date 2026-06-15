import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
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
import {
  UserRoleMappingResponseDto,
  UserRoleRelationDto,
} from './dto/user-role.dto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class UserRoleService {
  private readonly logger: LoggerService;
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
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(UserRoleService.name);
  }

  async batchCreate(userRoleRelationDto: UserRoleRelationDto) {
    this.logger.log("Starting batch create user roles", userRoleRelationDto);

    try {
      //  --------------- validate Details -------------/
      const project = await this.projectRepository.findOne({
        where: { id: userRoleRelationDto.project_id },
      });
      if (!project) {
        const error = new NotFoundException(
          `project with ID ${userRoleRelationDto.project_id} not found`,
        );
        this.logger.error("Project not found during batch create", error);
        throw error;
      }

      const account = await this.accountRepository.findOne({
        where: { id: userRoleRelationDto.account_id },
      });
      if (!account) {
        const error = new NotFoundException(
          `Account with ID ${userRoleRelationDto.account_id} not found`,
        );
        this.logger.error("Account not found during batch create", error);
        throw error;
      }

      const users = new Map<string, number>(),
        roles = new Map<string, number>();

      userRoleRelationDto.users.forEach((userMap) => {
        users.set(userMap.user_id, 1);
        roles.set(userMap.role_id, 1);
      });

      const usersStoreList = await this.userRepository.find({
        where: { id: In(userRoleRelationDto.users.map((user) => user.user_id)) },
        select: { id: true },
      });

      if (usersStoreList.length !== users.size) {
        usersStoreList.forEach((user) => [
          users.set(user.id, users.get(user.id) + 1),
        ]);
        const invalidUsers: string[] = [];
        users.forEach((v, k) => {
          if (v === 1) invalidUsers.push(k);
        });
        const error = new NotFoundException(
          `User with ID ${invalidUsers.join(', ')} not found`,
        );
        this.logger.error("Users not found during batch create", error);
        throw error;
      }

      const roleStoreList = await this.roleRepository.find({
        where: { id: In(userRoleRelationDto.users.map((user) => user.role_id)) },
        select: { id: true },
      });

      if (roleStoreList.length !== roles.size) {
        roleStoreList.forEach((user) => [
          roles.set(user.id, roles.get(user.id) + 1),
        ]);
        const invalidRoles: string[] = [];
        roles.forEach((v, k) => {
          if (v === 1) invalidRoles.push(k);
        });
        const error = new NotFoundException(
          `Role with ID ${invalidRoles.join(', ')} not found`,
        );
        this.logger.error("Roles not found during batch create", error);
        throw error;
      }

      await this.userRoleRepository.delete({
        projectId: project.id,
        accountId: account.id,
      });

      const update: UserRole[] = userRoleRelationDto.users.map((userMap) =>
        this.userRoleRepository.create({
          projectId: project.id,
          accountId: account.id,
          roleId: userMap.role_id,
          userId: userMap.user_id,
        }),
      );

      const result = await this.userRoleRepository.save(update);
      this.logger.log("Successfully completed batch create user roles", { count: result.length });
      return result;
    } catch (error) {
      this.logger.error("Error in batch create user roles", error);
      throw error;
    }
  }

  async create(
    createUserRoleDto: CreateUserRoleDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<UserRole> {
    this.logger.log("Creating user role", createUserRoleDto);

    try {
      const user = await this.userRepository.findOneBy({
        id: createUserRoleDto.user_id,
      });
      if (!user) {
        const error = new NotFoundException(
          `User with ID ${createUserRoleDto.user_id} not found`,
        );
        this.logger.error("User not found during user role creation", error);
        throw error;
      }

      const role = await this.roleRepository.findOneBy({
        id: createUserRoleDto.role_id,
      });
      if (!role) {
        const error = new NotFoundException(
          `Role with ID ${createUserRoleDto.role_id} not found`,
        );
        this.logger.error("Role not found during user role creation", error);
        throw error;
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
        const error = new NotFoundException(
          `Account with ID ${createUserRoleDto.account_id} not found`,
        );
        this.logger.error("Account not found during user role creation", error);
        throw error;
      }

      const userRole = this.userRoleRepository.create({
        id: randomUUID(),
        user,
        role,
        project,
        account,
      });

      userRole.populateWhoColumns(userPermissionResponse.user.id);

      const result = await this.userRoleRepository.save(userRole);
      this.logger.log("Successfully created user role", { userRoleId: result.id });
      return result;
    } catch (error) {
      this.logger.error("Error creating user role", error);
      throw error;
    }
  }

  async update(
    id: string,
    updateUserRoleDto: UpdateUserRoleDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<void> {
    this.logger.log("Updating user role", { id, updateData: updateUserRoleDto });

    try {
      const userRole = await this.userRoleRepository.findOneBy({ id });

      if (!userRole) {
        const error = new NotFoundException(`UserRole with ID ${id} not found`);
        this.logger.error("UserRole not found during update", error);
        throw error;
      }

      const user = await this.userRepository.findOneBy({
        id: updateUserRoleDto.user_id,
      });
      if (!user) {
        const error = new NotFoundException(
          `User with ID ${updateUserRoleDto.user_id} not found`,
        );
        this.logger.error("User not found during user role update", error);
        throw error;
      }

      const role = await this.roleRepository.findOneBy({
        id: updateUserRoleDto.role_id,
      });
      if (!role) {
        const error = new NotFoundException(
          `Role with ID ${updateUserRoleDto.role_id} not found`,
        );
        this.logger.error("Role not found during user role update", error);
        throw error;
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
        const error = new NotFoundException(
          `Account with ID ${updateUserRoleDto.account_id} not found`,
        );
        this.logger.error("Account not found during user role update", error);
        throw error;
      }

      userRole.user = user;
      userRole.role = role;
      userRole.project = project;
      userRole.account = account;

      userRole.populateWhoColumns(userPermissionResponse.user.id); // Fake user

      await this.userRoleRepository.save(userRole);
      this.logger.log("Successfully updated user role", { id });
    } catch (error) {
      this.logger.error("Error updating user role", error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    this.logger.log("Deleting user role", { id });

    try {
      const result = await this.userRoleRepository.delete(id);
      if (result.affected === 0) {
        const error = new NotFoundException(`UserRole with ID ${id} not found`);
        this.logger.error("UserRole not found during delete", error);
        throw error;
      }
      this.logger.log("Successfully deleted user role", { id });
    } catch (error) {
      this.logger.error("Error deleting user role", error);
      throw error;
    }
  }

  async findOne(id: string): Promise<UserRole> {
    this.logger.log("Finding user role by id", { id });

    try {
      const userRole = await this.userRoleRepository.findOne({
        where: { id },
        relations: { user: true, role: true, project: true, account: true },
      });

      if (!userRole) {
        const error = new NotFoundException(`UserRole with ID ${id} not found`);
        this.logger.error("UserRole not found", error);
        throw error;
      }

      this.logger.log("Successfully found user role", { id });
      return userRole;
    } catch (error) {
      this.logger.error("Error finding user role", error);
      throw error;
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateUserRoleDto> = {},
  ): Promise<UserRole[]> {
    this.logger.log("Finding all user roles", { page, limit, sortField, sortOrder, filter });

    try {
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
        relations: { user: true, role: true, project: true, account: true },
      };

      const result = await this.userRoleRepository.find(options);
      this.logger.log("Successfully found user roles", { count: result.length });
      return result;
    } catch (error) {
      this.logger.error("Error finding user roles", error);
      throw error;
    }
  }

  async fetchUsersAndRoles(
    page: number,
    limit: number,
    sortField: string,
    sortOrder: string,
    filter: Partial<CreateUserRoleDto> = {},
  ): Promise<UserRoleMappingResponseDto> {
    this.logger.log("Fetching users and roles", { page, limit, sortField, sortOrder, filter });

    try {
      const where: FindOptionsWhere<UserRole> = {};
      if (filter.user_id) {
        where.id = filter.user_id;
      }
      const options: FindManyOptions<User> = {
        skip: (page - 1) * limit,
        take: limit,
        order: {
          [sortField]: sortOrder,
        },
        where,
        relations: { user_roles: { role: true } },
      };
      const [users, total] = await this.userRepository.findAndCount(options);

      const userRoleMapping = users.map((user) => ({
        userId: user.id,
        userName: user.name,
        email: user.email,
        userStatus: user.user_status,
        roles: user.user_roles.map((userRole) => ({
          roleId: userRole.role.id,
          roleName: userRole.role.role_name,
          projectId: userRole.project?.id || null,
        })),
      }));

      const result = { total, page, limit, data: userRoleMapping };
      this.logger.log("Successfully fetched users and roles", { totalUsers: total });
      return result;
    } catch (error) {
      this.logger.error("Error fetching users and roles", error);
      throw error;
    }
  }
}
