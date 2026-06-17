import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { DeleteResult, FindOperator, Repository } from 'typeorm';
import { Project } from '../entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { Account } from '../entities/account.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { User } from '../entities/user.entity';
import { randomUUID } from 'crypto';
import { UserRole } from '../entities/user-role.entity';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import {
  mockLoggerService,
  resetLoggerMocks,
} from '../test-utils/logger-mocks';

class MockRepository<T> extends Repository<T> {
  async save(e: any): Promise<any> {
    return e;
  }
  async findOne(e: any): Promise<any> {
    return e;
  }
}

describe('ProjectService', () => {
  let service: ProjectService;
  let projectRepository: Repository<Project>;
  let accountRepository: MockRepository<Account>;
  let userRepository: MockRepository<User>;
  let userRoleRepository: MockRepository<UserRole>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        {
          provide: getRepositoryToken(Project),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
            findOne: jest.fn(),
            findOneBy: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserRole),
          useClass: Repository,
          useValue: {
            findOne: jest.fn(),
            query: jest.fn(),
          },
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLoggerService),
          },
        },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
    projectRepository = module.get<Repository<Project>>(
      getRepositoryToken(Project),
    );
    accountRepository = module.get<MockRepository<Account>>(
      getRepositoryToken(Account),
    );
    userRepository = module.get<MockRepository<User>>(getRepositoryToken(User));
    userRoleRepository = module.get<Repository<UserRole>>(
      getRepositoryToken(UserRole),
    );

    // Reset logger mocks after each test setup
    resetLoggerMocks();
  });

  const userPermissionResponseMock = {
    user: {
      roles: [
        {
          role_name: '',
          projects: [],
          permissions: [],
        },
      ],
      id: '6d4657c8-b19a-47b4-bb2e-bcef5865d4ca', // can be replaced with any string
    },
  } as UserPermissionResponse;

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('create', () => {
    it('should create a new project', async () => {
      const accountId = '123';
      const createProjectDto: CreateProjectDto = {
        account_id: accountId,
        project_name: 'Test Project',
        project_description: 'Optional description',
        start_date: new Date(),
      };

      const createdProject: Project = {
        id: '456',
        project_name: 'Test Project',
        project_description: '',
        start_date: new Date(),
        account: { id: accountId } as Account,
        created_by: '789',
        created_at: new Date(),
        updated_by: '789',
        updated_at: new Date(),
        user_roles: [],
        populateWhoColumns: jest.fn(),
      };

      jest
        .spyOn(accountRepository, 'findOneBy')
        .mockResolvedValueOnce({ id: accountId } as Account);

      jest
        .spyOn(projectRepository, 'findOneBy')
        .mockResolvedValueOnce(null as Project);

      jest
        .spyOn(userRepository, 'findOne')
        .mockResolvedValue({ id: '789' } as User);

      jest
        .spyOn(projectRepository, 'create')
        .mockReturnValueOnce(createdProject);

      jest
        .spyOn(projectRepository, 'save')
        .mockResolvedValueOnce(createdProject);

      const result = await service.create(
        accountId,
        createProjectDto,
        userPermissionResponseMock,
      );

      expect(accountRepository.findOneBy).toHaveBeenCalledWith({
        id: accountId,
      });
      await expect(
        service.create(accountId, createProjectDto, userPermissionResponseMock),
      ).rejects.toThrow(
        new NotFoundException(`Account with ${accountId} not found`),
      );

      expect(accountRepository.findOneBy).toHaveBeenCalledWith({
        id: accountId,
      });
      expect(projectRepository.create).toHaveBeenCalledWith({
        ...createProjectDto,
        account: { id: accountId } as Account,
      });
      expect(projectRepository.save).toHaveBeenCalledWith(createdProject);
      expect(result).toEqual(createdProject);
    });
  });

  describe('projectNameConflict', () => {
    it('should throw a Conflict Exception if a project with the same name already exists', async () => {
      const accountId = '12345';
      const account = {
        id: '12345',
        account_name: '',
        created_at: new Date(),
        created_by: '1',
        updated_at: new Date(),
        updated_by: '1',
        user_roles: [],
        projects: [],
        populateWhoColumns: jest.fn(),
      } as Account;

      const createProjectDto: CreateProjectDto = {
        account_id: accountId,
        project_name: 'Test Project',
        project_description: 'Optional description',
        start_date: new Date(),
      };

      const existingProject: Project = {
        id: '456',
        project_name: 'Test Project',
        project_description: '',
        start_date: new Date(),
        account: { id: accountId } as Account,
        created_by: '789',
        created_at: new Date(),
        updated_by: '789',
        updated_at: new Date(),
        user_roles: [],
        populateWhoColumns: jest.fn(),
      };

      // Mock repository methods
      jest.spyOn(accountRepository, 'findOneBy').mockResolvedValueOnce(account);
      jest
        .spyOn(projectRepository, 'findOneBy')
        .mockResolvedValueOnce(existingProject);
      jest.spyOn(accountRepository, 'create').mockReturnValueOnce(account);
      jest.spyOn(accountRepository, 'save').mockResolvedValueOnce(account);

      // Run the service method and assert that it throws a ConflictException
      await expect(
        service.create(accountId, createProjectDto, userPermissionResponseMock),
      ).rejects.toThrow(
        new ConflictException(
          `A project with the name ${createProjectDto.project_name} already exists for this account.`,
        ),
      );
    });
  });

  describe('accountNotFound', () => {
    it('should throw a Not Found Exception if a account with the id doest not exists', async () => {
      const accountId = '12345';

      const createProjectDto: CreateProjectDto = {
        account_id: accountId,
        project_name: 'Test Project',
        project_description: 'Optional description',
        start_date: new Date(),
      };

      await expect(
        service.create(accountId, createProjectDto, userPermissionResponseMock),
      ).rejects.toThrow(
        new NotFoundException(`Account with ${accountId} not found`),
      );
    });
  });

  describe('update', () => {
    it('should update a project', async () => {
      const projectId = '123';
      const updateProjectDto = {
        project_description: 'Updated Project desc',
      } as any;
      const existingProject: Project = {
        id: projectId,
        project_name: 'Test Project',
        start_date: new Date(),
        project_description: '',
        account: { id: '456' } as Account,
        user_roles: [],
        created_by: '789',
        created_at: new Date(),
        updated_by: '789',
        updated_at: new Date(),
        populateWhoColumns: jest.fn(),
      };

      jest.spyOn(projectRepository, 'update').mockResolvedValue(undefined);
      jest
        .spyOn(projectRepository, 'findOneBy')
        .mockResolvedValueOnce(existingProject);

      await service.update(
        projectId,
        updateProjectDto,
        userPermissionResponseMock,
      );
      expect(projectRepository.update).toHaveBeenCalledWith(projectId, {
        ...updateProjectDto,
        updated_by: expect.any(String),
      });
    });
  });

  describe('delete', () => {
    it('should delete an existing project', async () => {
      const projectId = '123';

      jest
        .spyOn(projectRepository, 'delete')
        .mockResolvedValueOnce({ affected: 1 } as DeleteResult);

      await service.delete(projectId);

      expect(projectRepository.delete).toHaveBeenCalledWith(projectId);
    });

    it('should throw NotFoundException if project does not exist', async () => {
      const projectId = '123';

      jest
        .spyOn(projectRepository, 'delete')
        .mockResolvedValueOnce({ affected: 0 } as DeleteResult);

      await expect(service.delete(projectId)).rejects.toThrow(
        NotFoundException,
      );
      expect(projectRepository.delete).toHaveBeenCalledWith(projectId);
    });
  });

  describe('findOne', () => {
    it('should return the project with the specified id', async () => {
      const projectId = '123';
      const project: Project = {
        id: projectId,
        project_name: 'Test Project',
        project_description: '',
        start_date: new Date(),
        user_roles: [],
        account: { id: '456' } as Account,
        created_by: '789',
        created_at: new Date(),
        updated_by: '789',
        updated_at: new Date(),
        populateWhoColumns: jest.fn(),
      };

      jest.spyOn(projectRepository, 'findOneBy').mockResolvedValueOnce(project);

      const result = await service.findOne(projectId);

      expect(projectRepository.findOneBy).toHaveBeenCalledWith({
        id: projectId,
      });
      expect(result).toEqual(project);
    });

    it('should throw NotFoundException if project does not exist', async () => {
      const projectId = '123';

      jest
        .spyOn(projectRepository, 'findOneBy')
        .mockResolvedValueOnce(undefined);

      await expect(service.findOne(projectId)).rejects.toThrow(
        NotFoundException,
      );
      expect(projectRepository.findOneBy).toHaveBeenCalledWith({
        id: projectId,
      });
    });
  });

  describe('findAll', () => {
    it('should return all projects', async () => {
      const baseAtts = {
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        user_roles: [],
        projects: [],
        populateWhoColumns: jest.fn(),
      };
      const projects: Project[] = [
        {
          id: '123',
          project_name: 'Project 1',
          project_description: '',
          start_date: new Date(),
          account: { id: '456' } as Account,
          created_by: 'user1',
          updated_by: 'user2',
          created_at: new Date(),
          updated_at: new Date(),
          user_roles: [],
          populateWhoColumns: jest.fn(),
        },
        {
          id: '789',
          project_name: 'Project 2',
          project_description: '',
          start_date: new Date(),
          account: { id: '456' } as Account,
          created_by: 'user1',
          updated_by: 'user2',
          created_at: new Date(),
          updated_at: new Date(),
          user_roles: [],
          populateWhoColumns: jest.fn(),
        },
      ];

      jest.spyOn(projectRepository, 'find').mockResolvedValueOnce(projects);

      const mockUser = {
        id: 'user1',
        email: 'user1@example.com',
        name: '',
        first_name: 'userOne',
        last_name: 'tpdm',
        user_status: 'active',
        ...baseAtts,
      };
      jest.spyOn(userRepository, 'find').mockResolvedValue([mockUser] as any);

      const result = await service.findAll();

      expect(projectRepository.find).toHaveBeenCalled();
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: '123',
            project_name: 'Project 1',
            created_by: mockUser,
          }),
        ]),
      );
    });
  });

  describe('findByAccount', () => {
    it('should return all projects associated with the specified account', async () => {
      const accountId = '123';

      const projects: Project[] = [
        {
          id: '456',
          project_name: 'Project 1',
          project_description: '',
          start_date: new Date(),
          created_by: 'DataMigrateAdmin',
          updated_by: 'DataMigrateAdmin',
          created_at: new Date(),
          updated_at: new Date(),
          user_roles: [],
          account: { id: accountId } as Account,
          populateWhoColumns: jest.fn(),
        } as Project,
        {
          id: '789',
          project_name: 'Project 2',
          project_description: '',
          start_date: new Date(),
          created_by: 'DataMigrateAdmin',
          updated_by: 'DataMigrateAdmin',
          created_at: new Date(),
          updated_at: new Date(),
          user_roles: [],
          account: { id: accountId } as Account,
          populateWhoColumns: jest.fn(),
        } as Project,
      ];

      const userRoles = [{ projectId: '789' } as UserRole];

      jest.spyOn(accountRepository, 'findOne').mockResolvedValueOnce({
        id: accountId,
        projects: projects,
      } as Account);

      const createdBy = 'DataMigrateAdmin';

      jest
        .spyOn(projectRepository, 'find')
        .mockResolvedValueOnce([projects[1]]);

      jest.spyOn(userRoleRepository, 'find').mockResolvedValueOnce(userRoles);

      jest.spyOn(userRepository, 'find').mockResolvedValue([{
        id: 'DataMigrateAdmin',
        email: 'admin@example.com',
        user_status: 'active',
      }] as any);

      const userMock = {
        user: {
          roles: [
            {
              permissions: ['permission1', 'permission2'],
              projects: ['789'],
              role_name: 'Some Role',
            },
          ],
          id: '123-abc-456-def',
        },
      };

      const result = await service.findByAccount(
        accountId,
        1,
        1,
        'created_at',
        'ASC',
        {},
        userMock,
      );

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: accountId },
        relations: { projects: true },
      });

      expect(userRoleRepository.find).toHaveBeenCalledWith({
        where: {
          userId: userMock.user.id,
          accountId: accountId,
        },
        select: { projectId: true },
      });

      expect(projectRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: expect.any(FindOperator),
          },
          skip: 0,
          take: 1,
          order: {
            created_at: 'ASC',
          },
          relations: { account: true },
        }),
      );

      expect(result).toEqual([
        {
          ...projects[1],
          created_by: {
            id: 'DataMigrateAdmin',
            email: 'admin@example.com',
            user_status: 'active',
          },
          updated_by: {
            id: 'DataMigrateAdmin',
            email: 'admin@example.com',
            user_status: 'active',
          },
        },
      ]);
    });

    it('should return all projects associated with the specified account for app admin', async () => {
      const accountId = '123';

      const projects: Project[] = [
        {
          id: '456',
          project_name: 'Project 1',
          project_description: '',
          start_date: new Date(),
          created_by: 'DataMigrateAdmin',
          updated_by: 'DataMigrateAdmin',
          created_at: new Date(),
          updated_at: new Date(),
          user_roles: [],
          account: { id: accountId } as Account,
          populateWhoColumns: jest.fn(),
        } as Project,
        {
          id: '789',
          project_name: 'Project 2',
          project_description: '',
          start_date: new Date(),
          created_by: 'DataMigrateAdmin',
          updated_by: 'DataMigrateAdmin',
          created_at: new Date(),
          updated_at: new Date(),
          user_roles: [],
          account: { id: accountId } as Account,
          populateWhoColumns: jest.fn(),
        } as Project,
      ];

      jest.spyOn(accountRepository, 'findOne').mockResolvedValueOnce({
        id: accountId,
        projects: projects,
      } as Account);
      const createdBy = 'DataMigrateAdmin';

      jest.spyOn(accountRepository, 'findOne').mockResolvedValueOnce({
        id: accountId,
        projects: projects,
      } as Account);
      jest
        .spyOn(userRoleRepository, 'query')
        .mockResolvedValueOnce([{ project_id: '1' }]);
      jest.spyOn(projectRepository, 'find').mockResolvedValue(projects);
      jest.spyOn(userRepository, 'find').mockResolvedValue([
        { id: 'DataMigrateAdmin', email: 'admin@example.com', user_status: 'active' },
      ] as any);
      jest.spyOn(userRoleRepository, 'query').mockResolvedValueOnce(projects);

      const userMock = {
        user: {
          roles: [
            {
              permissions: ['permission1', 'permission2'],
              projects: [],
              role_name: 'Some Role',
            },
          ],
          id: '123-abc-456-def',
        },
      };

      const result = await service.findByAccount(
        accountId,
        1,
        1,
        '',
        'ASC',
        {},
        userMock,
      );
      const result2 = await service.findByAccount(
        accountId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        userMock,
      );
      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: accountId },
        relations: { projects: true },
      });
      expect(result2.length).toBeGreaterThan(0);
      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: accountId },
        relations: { projects: true },
      });
      expect(result.length).toBeGreaterThan(0);
    });

    it('should throw NotFoundException if account does not exist', async () => {
      const accountId = '121';

      jest.spyOn(accountRepository, 'findOne').mockResolvedValueOnce(undefined);

      await expect(
        service.findByAccount(accountId, 1, 1, '', 'ASC', {}, undefined),
      ).rejects.toThrow(NotFoundException);
      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: '121' },
        relations: { projects: true },
      });
    });
  });
});
