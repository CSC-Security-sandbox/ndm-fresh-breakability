import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { Repository } from 'typeorm';
import { Project } from '../entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Account } from '../entities/account.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DeleteResult } from 'typeorm';
import { User } from '../entities/user.entity';
import { randomUUID } from 'crypto';
import { UserPermissionResponse } from 'src/auth/user-permission-response-type';

class MockRepository<T> extends Repository<T> {
  async save(e: any):Promise<any> {
      return e
  }
  async findOne(e: any):Promise<any> {
      return e
  }
}

describe('ProjectService', () => {
  let service: ProjectService;
  let projectRepository: Repository<Project>;
  let accountRepository:MockRepository<Account>
  let userRepository: MockRepository<User>;


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
            findOne: jest.fn(),
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
  });

  const userPermissionResponseMock = {
    user: {
      roles: [
        {
          role_name: "",
          projects: [],
          permissions: []
        }
      ],
      id: "6d4657c8-b19a-47b4-bb2e-bcef5865d4ca" // can be replaced with any string
    }
  } as UserPermissionResponse

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('create', () => {
    it('should create a new project', async () => {
      const accountId = '123';
      const createProjectDto: CreateProjectDto = {
        account_id: accountId,
        project_name: 'Test Project',
        project_description:"Optional description",
        start_date: new Date(),
      };

      const createdProject: Project = {
        id: '456',
        project_name: 'Test Project',
        project_description:'',
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

      const result = await service.create(accountId, createProjectDto, userPermissionResponseMock);

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

  describe('update', () => {
    it('should update a project', async () => {
      const projectId = '123';
      const updateProjectDto: UpdateProjectDto = {
        project_name: 'Updated Project',
      };
      const existingProject: Project = {
        id: projectId,
        project_name: 'Test Project',
        start_date: new Date(),
        project_description:'',
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

      await service.update(projectId, updateProjectDto,  userPermissionResponseMock);
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
        project_description:'',
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
          project_description:'',
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
          project_description:'',
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
        name:'',
        first_name:'userOne', 
        last_name:'tpdm',
        user_status: 'active',
        ...baseAtts,
      };
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser);

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
          project_description:'',
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
          project_description:'',
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
      //needs to be updar
      const createdBy="DataMigrateAdmin"

      jest.spyOn(projectRepository, 'find').mockResolvedValueOnce(projects);
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(createdBy);

      const result = await service.findByAccount(accountId);

      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: accountId },
        relations: ['projects'],
      });
      expect(result).toEqual(projects);
    });

    it('should throw NotFoundException if account does not exist', async () => {
      const accountId = '123';

      jest.spyOn(accountRepository, 'findOne').mockResolvedValueOnce(undefined);

      await expect(service.findByAccount(accountId)).rejects.toThrow(
        NotFoundException,
      );
      expect(accountRepository.findOne).toHaveBeenCalledWith({
        where: { id: accountId },
        relations: ['projects'],
      });
    });
  });
});
