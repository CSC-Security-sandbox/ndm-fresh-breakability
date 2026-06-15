import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { Repository } from 'typeorm';
import { Project } from '../entities/project.entity';
import { Account } from '../entities/account.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';
import { randomUUID } from 'crypto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

describe('ProjectController', () => {
  let controller: ProjectController;
  let service: ProjectService;

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ['permission1', 'permission2'],
            projects: ['project1'],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        ProjectService,
        {
          provide: getRepositoryToken(Project),
          useClass: Repository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: getRepositoryToken(Account),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(User),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(UserRole),
          useClass: Repository,
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              log: jest.fn(),
              error: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<ProjectController>(ProjectController);
    service = module.get<ProjectService>(ProjectService);
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

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should be defined service', async () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a project', async () => {
      const account = {} as Account;
      const user_roles = {} as UserRole;
      const baseAtts = {
        created_at: new Date(),
        created_by: randomUUID(),
        updated_at: new Date(),
        updated_by: randomUUID(),
        user_roles: [],
        projects: [],
        populateWhoColumns: jest.fn(),
      };
      const createProjectDto = {
        account_id: '1',
        account,
        user_roles,
        project_name: 'test',
        project_description: 'test project description',
        start_date: new Date(),
        ...baseAtts,
      };
      const project = { ...createProjectDto, id: '1' };

      jest.spyOn(service, 'create').mockResolvedValue(project);

      const result = await controller.create(
        createProjectDto,
        userPermissionResponseMock,
      );
      expect(result).toEqual(project);
      expect(service.create).toHaveBeenCalledWith(
        createProjectDto.account_id,
        createProjectDto,
        userPermissionResponseMock,
      );
    });

    it('should handle errors during project creation', async () => {
      const createProjectDto = {
        account_id: 'invalid-id',
        project_name: 'test',
        project_description: 'test project description',
        start_date: new Date(),
      };

      jest
        .spyOn(service, 'create')
        .mockRejectedValue(new Error('Failed to create project'));

      await expect(
        controller.create(createProjectDto, userPermissionResponseMock),
      ).rejects.toThrow('Failed to create project');
    });
  });

  describe('findAll', () => {
    it('should return an empty list when no projects exist', async () => {
      jest.spyOn(service, 'findAll').mockResolvedValue({ data: [], total: 0, page: 1, limit: 10 });

      const result = await controller.findAll(1, 10, 'id', 'ASC', '{}');
      const result2 = await controller.findAll(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      const result3 = await controller.findAll(
        1,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      const result4 = await controller.findAll(
        1,
        10,
        undefined,
        undefined,
        undefined,
      );
      const result5 = await controller.findAll(
        1,
        10,
        'id',
        undefined,
        undefined,
      );
      const result6 = await controller.findAll(1, 10, 'id', 'ASC', undefined);
      const emptyResult = { data: [], total: 0, page: 1, limit: 10 };
      expect(result).toEqual(emptyResult);
      expect(result2).toEqual(emptyResult);
      expect(result3).toEqual(emptyResult);
      expect(result4).toEqual(emptyResult);
      expect(result5).toEqual(emptyResult);
      expect(result6).toEqual(emptyResult);
      expect(service.findAll).toHaveBeenCalledWith(1, 10, 'id', 'ASC', {});
    });

    it('should return a list of projects', async () => {
      const projects = [
        {
          id: '1',
          account_id: 'acc1',
          project_name: 'Project 1',
          project_description: 'Description for Project 1',
          start_date: new Date(),
          account: {} as Account,
          user_roles: [],
          created_at: new Date(),
          updated_at: new Date(),
          updated_by: 'user1',
          created_by: 'user1',
          populateWhoColumns: jest.fn(),
        },
      ];
      jest.spyOn(service, 'findAll').mockResolvedValue({ data: projects, total: 1, page: 1, limit: 10 });

      const result = await controller.findAll(1, 10, 'id', 'ASC', '{}');
      expect(result).toEqual({ data: projects, total: 1, page: 1, limit: 10 });
      expect(service.findAll).toHaveBeenCalledWith(1, 10, 'id', 'ASC', {});
    });

    it('should handle errors during findAll', async () => {
      jest
        .spyOn(service, 'findAll')
        .mockRejectedValue(new Error('Failed to fetch projects'));

      await expect(
        controller.findAll(1, 10, 'id', 'ASC', '{}'),
      ).rejects.toThrow('Failed to fetch projects');
    });
  });

  describe('findByAccountId', () => {
    it('should return an empty list when no projects exist for an account', async () => {
      jest.spyOn(service, 'findByAccount').mockResolvedValue({ data: [], total: 0, page: 1, limit: 10 });

      const result = await controller.findByAccountId(
        userPermissionResponseMock,
        '1',
        1,
        10,
        'id',
        'ASC',
        '{}',
      );

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10 });
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10 });
      expect(service.findByAccount).toHaveBeenCalledWith(
        '1',
        1,
        10,
        'id',
        'ASC',
        {},
        userPermissionResponseMock,
      );
    });

    it('should return projects for an account', async () => {
      const projects = [
        {
          id: '1',
          account_id: 'acc1',
          project_name: 'Project 1',
          project_description: 'Description for Project 1',
          start_date: new Date(),
          account: {} as Account,
          user_roles: [],
          created_at: new Date(),
          updated_at: new Date(),
          updated_by: 'user1',
          created_by: 'user1',
          populateWhoColumns: jest.fn(),
        },
      ];

      jest.spyOn(service, 'findByAccount').mockResolvedValue({ data: projects, total: 1, page: 1, limit: 10 });

      const userPermissionResponseMock = {
        user: {
          id: '6d4657c8-b19a-47b4-bb2e-bcef5865d4ca',
          roles: [
            {
              permissions: [],
              projects: [],
              role_name: '',
            },
          ],
        },
      };

      const result = await controller.findByAccountId(
        userPermissionResponseMock,
        '1',
        1,
        10,
        'id',
        'ASC',
        '{}',
      );

      expect(result).toEqual({ data: projects, total: 1, page: 1, limit: 10 });
      expect(service.findByAccount).toHaveBeenCalledWith(
        '1',
        1,
        10,
        'id',
        'ASC',
        {},
        userPermissionResponseMock,
      );
    });

    it('should handle errors during findByAccountId', async () => {
      jest
        .spyOn(service, 'findByAccount')
        .mockRejectedValue(new Error('Account not found'));

      await expect(
        controller.findByAccountId(
          userPermissionResponseMock,
          'invalid-id',
          1,
          10,
          'id',
          'ASC',
          '{}',
        ),
      ).rejects.toThrow('Account not found');
    });
  });

  describe('findOne', () => {
    it('should return null when project is not found', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(null);

      const result = await controller.findOne('non-existent-id');
      expect(result).toBeNull();
      expect(service.findOne).toHaveBeenCalledWith('non-existent-id');
    });

    it('should handle errors during findOne', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockRejectedValue(new Error('Failed to fetch project'));

      await expect(controller.findOne('1')).rejects.toThrow(
        'Failed to fetch project',
      );
    });
  });

  describe('update', () => {
    it('should update a project', async () => {
      const updateDto = { project_name: 'updated test' } as any;
      jest
        .spyOn(service, 'update')
        .mockResolvedValue({ message: 'Project updated successfully' });

      const result = await controller.update(
        '1',
        updateDto,
        userPermissionResponseMock,
      );

      expect(service.update).toHaveBeenCalledWith(
        '1',
        updateDto,
        userPermissionResponseMock,
      );
      expect(result.message).toBe('Project updated successfully');
    });

    it('should handle errors during update', async () => {
      const updateDto = { project_name: 'updated test' } as any;

      jest
        .spyOn(service, 'update')
        .mockRejectedValue(new Error('Failed to update project'));

      await expect(
        controller.update('1', updateDto, userPermissionResponseMock),
      ).rejects.toThrow('Failed to update project');
    });
  });

  describe('delete', () => {
    it('should delete a project', async () => {
      jest.spyOn(service, 'delete').mockResolvedValue();

      await controller.delete('1');
      expect(service.delete).toHaveBeenCalledWith('1');
    });

    it('should handle errors during delete', async () => {
      jest
        .spyOn(service, 'delete')
        .mockRejectedValue(new Error('Failed to delete project'));

      await expect(controller.delete('1')).rejects.toThrow(
        'Failed to delete project',
      );
    });
  });
});
