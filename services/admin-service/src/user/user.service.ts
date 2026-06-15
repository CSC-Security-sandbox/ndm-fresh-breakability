import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, IsNull, Repository, In } from 'typeorm';
import { User } from '../entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '../entities/user-role.entity';
import { Account } from '../entities/account.entity';
import { Project } from '../entities/project.entity';
import { Role } from '../entities/role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';

/**
 * User enriched with role context for API responses.
 * - `isAppAdmin`: true when the user holds a global (projectId-null) role.
 * - `roleName`: the app-admin role name takes precedence; falls back to the
 *   project-scoped role name, or null when no role is found.
 * - `created_by` / `updated_by`: resolved to the full User object when the
 *   referenced user exists, otherwise null.
 */
export interface TransformedUser extends Omit<User, 'created_by' | 'updated_by' | 'populateWhoColumns' | 'name'> {
  isAppAdmin: boolean;
  roleName: string | null;
  created_by: User | null;
  updated_by: User | null;
}

@Injectable()
export class UserService {
  private readonly logger: LoggerService;
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

    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(UserService.name);
  }

  async create(
    createUserDto: CreateUserDto,
    userPermissions: UserPermissionResponse,
  ): Promise<User> {
    try {
      this.logger.log('Creating new user', {
        requestorUserId: userPermissions.user.id,
        userData: { ...createUserDto, password: '[REDACTED]' }
      });

      const user = this.userRepository.create({
        ...createUserDto,
        user_status: 'active',
      });
      user.populateWhoColumns(userPermissions.user.id);
      const savedUser = await this.userRepository.save(user);

      this.logger.log('User created successfully', {
        userId: savedUser.id,
        requestorUserId: userPermissions.user.id
      });

      return savedUser;
    } catch (error) {
      this.logger.error('Failed to create user', error);
      throw error;
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateUserDto> = {},
    projectId?: string,
  ): Promise<TransformedUser[]> {
    try {
      this.logger.log('Retrieving users list', {
        page,
        limit,
        sortField,
        sortOrder,
        projectId
      });

      let users: User[];

      if (projectId) {
        // When projectId is provided, get users associated with that project OR app admins
        // App admins have roles with projectId: null and should have access to all projects
        const userRoles = await this.userRoleRepository.find({
          where: [
            { projectId }, // Users with roles for the specific project
            { projectId: IsNull() } // App admins with global access (projectId is null)
          ],
          relations: { user: true },
          select: { userId: true }
        });

        if (userRoles.length === 0) {
          this.logger.log('No users found for project', { projectId });
          return [];
        }

        const userIds = userRoles.map(ur => ur.userId);
        
        const options: FindManyOptions<User> = {
          skip: (page - 1) * limit,
          take: limit,
          order: { [sortField]: sortOrder },
          where: { 
            id: In(userIds),
            ...filter 
          },
        };

        users = await this.userRepository.find(options);
      } else {
        // Original logic when no projectId is provided
        const options: FindManyOptions<User> = {
          skip: (page - 1) * limit,
          take: limit,
          order: { [sortField]: sortOrder },
          where: filter,
        };

        users = await this.userRepository.find(options);
      }

    if (users.length === 0) {
      return [];
    }

    // Bulk fetch created_by and updated_by users to avoid N+1 queries
    const createdByIds = [...new Set(users.map(u => u.created_by).filter(Boolean))];
    const updatedByIds = [...new Set(users.map(u => u.updated_by).filter(Boolean))];
    const userIds = users.map(u => u.id);

    const roleWhereConditions: Array<Record<string, any>> = [
      { userId: In(userIds), projectId: IsNull() },
    ];
    if (projectId) {
      roleWhereConditions.push({ userId: In(userIds), projectId });
    }

    const [createdByUsers, updatedByUsers, allRoles] = await Promise.all([
      createdByIds.length > 0 ? this.userRepository.find({
        where: { id: In(createdByIds) },
        select: { id: true, email: true, user_status: true },
      }) : [],
      updatedByIds.length > 0 ? this.userRepository.find({
        where: { id: In(updatedByIds) },
        select: { id: true, email: true, user_status: true },
      }) : [],
      this.userRoleRepository.find({
        where: roleWhereConditions,
        relations: { role: true },
        select: { userId: true, roleId: true, projectId: true },
      }),
    ]);

    const createdByMap = new Map<string, User>();
    createdByUsers.forEach(user => createdByMap.set(user.id, user));

    const updatedByMap = new Map<string, User>();
    updatedByUsers.forEach(user => updatedByMap.set(user.id, user));

    const appAdminRoleMap = new Map<string, string>();
    const projectRoleMap = new Map<string, string>();
    allRoles.forEach(ur => {
      if (!ur.role?.role_name) return;
      if (ur.projectId === null) {
        appAdminRoleMap.set(ur.userId, ur.role.role_name);
      } else {
        projectRoleMap.set(ur.userId, ur.role.role_name);
      }
    });

    const transformedUsers = users.map((user): TransformedUser => {
      const { created_by, updated_by, ...rest } = user;
      return {
        ...rest,
        isAppAdmin: appAdminRoleMap.has(user.id),
        roleName: appAdminRoleMap.get(user.id) ?? projectRoleMap.get(user.id) ?? null,
        created_by: createdByMap.get(created_by) ?? null,
        updated_by: updatedByMap.get(updated_by) ?? null,
      };
    });

    this.logger.log('Successfully retrieved users', {
      count: transformedUsers.length,
      page,
      limit,
      projectId: projectId || 'all'
    });
    return transformedUsers;
    } catch (error) {
      this.logger.error('Failed to retrieve users list', error);
      throw error;
    }
  }

  async findOne(id: string): Promise<User> {
    try {
      this.logger.log(`Retrieving user by ID: ${id}`);

      const user = await this.userRepository.findOneBy({ id: id });

      if (!user) {
        this.logger.warn('User not found', { userId: id });
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      this.logger.log('Successfully retrieved user', { userId: id });
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to retrieve user', error);
      throw error;
    }
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    userPermissions: UserPermissionResponse,
  ): Promise<void> {
    try {
      this.logger.log('Updating user', {
        userId: id,
        requestorUserId: userPermissions.user.id
      });

      // Check if user exists first
      const existingUser = await this.userRepository.findOneBy({ id });
      if (!existingUser) {
        this.logger.warn('User not found for update', { userId: id });
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      await this.userRepository.update(id, {
        ...updateUserDto,
        updated_by: userPermissions.user.id,
      });

      this.logger.log('Successfully updated user', { userId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update user', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.logger.log('Deleting user', { userId: id });

      const user = await this.userRepository.findOne({
        where: { id },
        relations: { user_roles: true },
      });

      if (!user) {
        this.logger.warn('User not found for deletion', { userId: id });
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      await this.userRepository.remove(user);

      this.logger.log('Successfully deleted user', { userId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete user', error);
      throw error;
    }
  }

  async inactivate(id: string): Promise<void> {
    try {
      this.logger.log('Inactivating user', { userId: id });

      // Check if user exists first
      const existingUser = await this.userRepository.findOneBy({ id });
      if (!existingUser) {
        this.logger.warn('User not found for inactivation', { userId: id });
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      await this.userRepository.update(id, {
        user_status: 'inactive',
      });

      this.logger.log('Successfully inactivated user', { userId: id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to inactivate user', error);
      throw error;
    }
  }

  async getUserProjectsAndPermissions(email: string, projectId?: string) {
    try {
      this.logger.log('Getting user projects and permissions', {
        email: email.substring(0, 3) + '***', // Partially redact email for privacy
        projectId
      });

      const user = await this.userRepository.findOne({
        where: { email },
        relations: { user_roles: { role: true, project: true } },
      });

      if (!user) {
        this.logger.warn('User not found for permissions retrieval', { email: email.substring(0, 3) + '***' });
        throw new NotFoundException(`User with email ${email} not found`);
      }

    if (projectId) {
      const userRolesInProject = user.user_roles.filter(
        (userRole) => userRole.project?.id === projectId,
      );
      if (userRolesInProject.length === 0) {
        this.logger.warn('User has no role in specified project', {
          email: email.substring(0, 3) + '***',
          projectId
        });
        throw new NotFoundException(
          `User has no role in project with ID ${projectId}`,
        );
      }

      const result = {
        projectId,
        projectName: userRolesInProject[0]?.project.project_name,
        role: userRolesInProject[0]?.role.role_name,
        permissionsOfProject: await this.getPermissionsByRoles(
          userRolesInProject[0]?.role.id,
        ),
      };

      this.logger.log('Successfully retrieved user project permissions', {
        email: email.substring(0, 3) + '***',
        projectId
      });
      return result;
    } else {
      // Bulk fetch all permissions for all roles to avoid N+1 queries
      const roleIds = [...new Set(user.user_roles.map(ur => ur.role.id))];
      const allRolePermissions = await this.rolePermissionRepository.find({
        where: { role: { id: In(roleIds) } },
        relations: { permission: true, role: true },
      });

      // Create a map of roleId -> permissions for efficient lookup
      const rolePermissionsMap = new Map<string, string[]>();
      allRolePermissions.forEach(rp => {
        const roleId = rp.role.id;
        if (!rolePermissionsMap.has(roleId)) {
          rolePermissionsMap.set(roleId, []);
        }
        rolePermissionsMap.get(roleId)!.push(rp.permission.permission_name);
      });

      // Transform user roles with pre-fetched permissions
      return user.user_roles.map(ur => ({
        projectId: ur.project?.id || null,
        projectName: ur.project?.project_name || null,
        role: ur.role.role_name,
        permissionsOfProject: rolePermissionsMap.get(ur.role.id) || [],
      }));
    }
  } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to get user projects and permissions', error);
      throw error;
    }
  }

  public async getPermissionsByRoles(roleId: string) {
    const rolePermissions = await this.rolePermissionRepository.find({
      where: { role: { id: roleId } },
      relations: { permission: true },
    });
    return rolePermissions.map((rp) => rp.permission.permission_name);
  }
}
