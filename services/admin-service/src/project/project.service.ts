import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, In, Repository } from 'typeorm';
import { Project } from '../entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Account } from '../entities/account.entity';
import { User } from '../entities/user.entity';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { UserRole } from '../entities/user-role.entity';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class ProjectService {
  private readonly logger: LoggerService;
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(ProjectService.name);
  }

  async create(
    accountId: string,
    createProjectDto: CreateProjectDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<Project> {
    try {
      this.logger.log(`starting to create project for account ${accountId}`);
      const account = await this.accountRepository.findOneBy({ id: accountId });
      if (!account) {
        this.logger.error(`Account with ${accountId} not found`);
        throw new NotFoundException(`Account with ${accountId} not found`);
      }

      this.logger.log(
        `starting to find "${createProjectDto.project_name}" project for account ${accountId}`,
      );
      const existingProject = await this.projectRepository.findOneBy({
        project_name: createProjectDto.project_name,
        account: { id: accountId },
      });

      if (existingProject) {
        this.logger.error(
          `A project with the name "${createProjectDto.project_name}" already exists for this account.`,
        );
        throw new ConflictException(
          `A project with the name ${createProjectDto.project_name} already exists for this account.`,
        );
      }

      const project = this.projectRepository.create({
        ...createProjectDto,
        account,
      });
      project.created_by = userPermissionResponse.user.id;
      return await this.projectRepository.save(project);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      if (error?.code === '23505' || error?.driverError?.code === '23505') {
        throw new ConflictException(
          `A project with the name ${createProjectDto.project_name} already exists for this account.`,
        );
      }
      this.logger.error('Failed to create project', error);
      throw error;
    }
  }

  async update(
    id: string,
    updateProjectDto: UpdateProjectDto,
    userPermissionResponse: UserPermissionResponse,
  ): Promise<{ message: string }> {
    try {
      const existingProject = await this.projectRepository.findOneBy({ id });
      if (!existingProject) {
        this.logger.error(`Project with ${id} not found`);
        throw new NotFoundException(`Project with ${id} not found`);
      }

      await this.projectRepository.update(id, {
        ...updateProjectDto,
        updated_by: userPermissionResponse.user.id,
      });
      this.logger.log(
        `Done updating the project ${id} with update data ${JSON.stringify(updateProjectDto)}`,
      );
      return { message: `Project updated successfully` };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update project', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const result = await this.projectRepository.delete(id);
      if (result.affected === 0) {
        this.logger.error(`Project with ${id} not found`);
        throw new NotFoundException(`Project with ${id} not found`);
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete project', error);
      throw error;
    }
  }

  async findOne(id: string): Promise<Project> {
    try {
      const project = await this.projectRepository.findOneBy({
        id: id,
      });

      if (!project) {
        this.logger.error(`Project with ${id} not found`);
        throw new NotFoundException(`Project with ${id} not found`);
      }

      return project;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to retrieve project', error);
      throw error;
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateProjectDto> = {},
  ): Promise<{ data: Project[]; total: number; page: number; limit: number }> {
    try {
      const options: FindManyOptions<Project> = {
        skip: (page - 1) * limit,
        take: limit,
        order: {
          [sortField]: sortOrder,
        },
        where: filter,
        relations: { account: true },
      };

      const [projects, total] = await this.projectRepository.findAndCount(options);

      const userIds = [
        ...new Set(
          projects
            .flatMap((p) => [p.created_by, p.updated_by])
            .filter((id): id is string => !!id),
        ),
      ];

      const users =
        userIds.length > 0
          ? await this.userRepository.find({
              where: { id: In(userIds) },
              select: { id: true, email: true, user_status: true },
            })
          : [];

      const userMap = new Map(users.map((u) => [u.id, u]));

      const transformedProjects = projects.map((project) => ({
        ...project,
        created_by: userMap.get(project.created_by),
        updated_by: userMap.get(project.updated_by),
      } as any));

      return { data: transformedProjects, total, page, limit };
    } catch (error) {
      this.logger.error('Failed to retrieve projects', error);
      throw error;
    }
  }

  async findByAccount(
    account_id: string,
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateProjectDto> = {},
    userPermissionResponse: UserPermissionResponse,
  ): Promise<{ data: Project[]; total: number; page: number; limit: number }> {
    try {
      const options: FindManyOptions<Project> = {
        skip: (page - 1) * limit,
        take: limit,
        order: {
          [sortField]: sortOrder,
        },
        relations: { account: true },
      };

      const account = await this.accountRepository.findOne({
        where: { id: account_id },
      });

      if (!account) {
        this.logger.error(`Account with ${account_id} not found`);
        throw new NotFoundException(`Account with ${account_id} not found`);
      }

      if (userPermissionResponse.user.roles[0].projects.length > 0) {
        const userId = userPermissionResponse.user.id;

        const userRoles = await this.userRoleRepository.find({
          where: {
            userId: userId,
            accountId: account_id,
          },
          select: { projectId: true },
        });

        const allowedProjectIds = userRoles.map((ur) => ur.projectId);

        options.where = {
          id: In(allowedProjectIds),
          ...filter,
        };
      } else {
        options.where = {
          account: { id: account_id },
          ...filter,
        };
      }

      const [projects, total] = await this.projectRepository.findAndCount(options);

      const userIds = [
        ...new Set(
          projects
            .flatMap((p) => [p.created_by, p.updated_by])
            .filter((id): id is string => !!id),
        ),
      ];

      const users =
        userIds.length > 0
          ? await this.userRepository.find({
              where: { id: In(userIds) },
              select: { id: true, email: true, user_status: true },
            })
          : [];

      const userMap = new Map(users.map((u) => [u.id, u]));

      const transformedProjects = projects.map((project) => ({
        ...project,
        created_by: userMap.get(project.created_by),
        updated_by: userMap.get(project.updated_by),
      } as any));

      return { data: transformedProjects, total, page, limit };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to retrieve projects by account', error);
      throw error;
    }
  }
}
