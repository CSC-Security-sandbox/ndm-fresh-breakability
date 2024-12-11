import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';
import { Project } from '../entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Account } from '../entities/account.entity';
import { User } from '../entities/user.entity';
import { UserPermissionResponse } from '../auth/user-permission-response-type';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(
    accountId: string,
    createProjectDto: CreateProjectDto,
    userPermissionResponse:UserPermissionResponse
  ): Promise<Project> {
    const account = await this.accountRepository.findOneBy({ id: accountId });
    if (!account) {
      throw new NotFoundException(`Account with ${accountId} not found`);
    }

    const existingProject = await this.projectRepository.findOneBy({
      project_name: createProjectDto.project_name,
    });
 
    if (existingProject) {
      throw new ConflictException(
        `A project with the name "${createProjectDto.project_name}" already exists for this account.`,
      );
    }

    const project = this.projectRepository.create({
      ...createProjectDto,
      account,
    });
    project.created_by = userPermissionResponse.user.id
    return this.projectRepository.save(project);
  }

  async update(id: string, updateProjectDto: UpdateProjectDto, userPermissionResponse:UserPermissionResponse): Promise<void> {
    await this.projectRepository.update(id, {
      ...updateProjectDto,
      updated_by: userPermissionResponse.user.id,
    });
  }

  async delete(id: string): Promise<void> {
    const result = await this.projectRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Project with ${id} not found`);
    }
  }

  async findOne(id: string): Promise<Project> {
    const project = await this.projectRepository.findOneBy({
      id: id,
    });

    if (!project) {
      throw new NotFoundException(`Project with ${id} not found`);
    }

    return project;
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateProjectDto> = {},
  ): Promise<Project[]> {
    const options: FindManyOptions<Project> = {
      skip: (page - 1) * limit,
      take: limit,
      order: {
        [sortField]: sortOrder,
      },
      where: filter,
      relations: ['account'],
    };

    const projects = await this.projectRepository.find(options);

    const transformedProjects = await Promise.all(
      projects.map(async (project) => {
        const createdByUser = await this.userRepository.findOne({
          where: { id: project.created_by },
          select: ['id', 'email', 'user_status'],
        });

        const updatedByUser = await this.userRepository.findOne({
          where: { id: project.updated_by },
          select: ['id', 'email', 'user_status'],
        });

        return {
          ...project,
          created_by: createdByUser,
          updated_by: updatedByUser,
        } as any;
      }),
    );

    return transformedProjects;
  }

  async findByAccount(
    account_id: string,
    page: number = 1,
    limit: number = 10,
    sortField: string = 'id',
    sortOrder: 'ASC' | 'DESC' = 'ASC',
    filter: Partial<CreateProjectDto> = {},
  ): Promise<Project[]> {
    const options: FindManyOptions<Project> = {
      skip: (page - 1) * limit,
      take: limit,
      order: {
        [sortField]: sortOrder,
      },
      where: {
        ...filter,
        account: {
          id: account_id,
        },
      },
      relations: ['account'],
    };

    const account = await this.accountRepository.findOne({
      where: { id: account_id },
      relations: ['projects'],
    });

    if (!account) {
      throw new NotFoundException(`Account with ${account_id} not found`);
    }

    const projects = await this.projectRepository.find(options);

    const transformedProjects = await Promise.all(
      projects.map(async (project) => {
        const createdByUser = await this.userRepository.findOne({
          where: { id: project.created_by },
          select: ['id', 'email', 'user_status'],
        });

        const updatedByUser = await this.userRepository.findOne({
          where: { id: project.updated_by },
          select: ['id', 'email', 'user_status'],
        });

        return {
          ...project,
          created_by: createdByUser,
          updated_by: updatedByUser,
        } as any;
      }),
    );

    return transformedProjects;
  }
}
