import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigurationType, Protocol, ProtocolVersion, ServerType } from 'src/constants/enums';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ConfigurationService } from './configuration.service';
import { ConfigDTO } from './dto/config.dto';
import { WorkflowService } from 'src/workflow/workflow.service';


// Mock data for entities
const mockConfig = { id: uuidv4(), configName: 'Test Config', configType: 'Type1' };
const mockFileServer = { id: uuidv4(), host: 'localhost', serverType: 'Type1', workers: [], volumes: [] };
const mockVolume = { id: uuidv4(), volumePath: '/path', isIncluded: true };
const mockWorker = { id: uuidv4(), workerName: 'Worker1' };

const mockConfigRepository = {
  find: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  update: jest.fn()
};

const mockFileServerRepository = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn()
};

const mockVolumeRepository = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn()
};

const mockWorkerRepository = {
  findByIds: jest.fn(),
  find: jest.fn(),
};

const mockMappingRepository = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
};

describe('ConfigurationService', () => {
  let service: ConfigurationService;
  let configRepository: Repository<ConfigEntity>;
  let mappingRepository: Repository<FileServerWorkingDirectoryMappingEntity>;
  let workflowService:WorkflowService

  let loggerFactoryMock = {
    create: jest.fn().mockReturnValue({
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigurationService,
        {
          provide: getRepositoryToken(ConfigEntity),
          useValue: mockConfigRepository,
        },
        {
          provide: getRepositoryToken(FileServerEntity),
          useValue: mockFileServerRepository,
        },
        {
          provide: getRepositoryToken(VolumeEntity),
          useValue: mockVolumeRepository,
        },
        {
          provide: getRepositoryToken(WorkerEntity),
          useValue: mockWorkerRepository,
        },
        {
          provide: getRepositoryToken(FileServerWorkingDirectoryMappingEntity),
          useValue: mockMappingRepository,
        },
        { provide: LoggerFactory, useValue: loggerFactoryMock },
        { provide: WorkflowService, useValue : {
          startWorkflow: jest.fn()
        }}
      ],
    }).compile();

    service = module.get<ConfigurationService>(ConfigurationService);
    workflowService = module.get<WorkflowService>(WorkflowService);
    configRepository = module.get(getRepositoryToken(ConfigEntity));
    mappingRepository = module.get(getRepositoryToken(FileServerWorkingDirectoryMappingEntity));
  });

  describe('getAllConfig', () => {
    it('should return paginated config results', async () => {
      mockConfigRepository.find.mockResolvedValue([mockConfig]);
      mockConfigRepository.count.mockResolvedValue(1);
      
      const result = await service.getAllConfig({ page: '1', limit: '10', sort: 'createdAt', order: 'asc' });
      
      expect(mockConfigRepository.find).toHaveBeenCalled();
      expect(result.serverConfig).toEqual([mockConfig]);
      expect(result.total).toBe(1);
    });

    it('should return all configs without pagination if page and limit are not provided', async () => {
      mockConfigRepository.find.mockResolvedValue([mockConfig]);
      mockConfigRepository.count.mockResolvedValue(1);
      
      const result = await service.getAllConfig({});
      
      expect(mockConfigRepository.find).toHaveBeenCalled();
      expect(result.serverConfig).toEqual([mockConfig]);
      expect(result.total).toBe(1);
    });

    it('should handle empty filter with default sort and order', async () => {
      mockConfigRepository.find.mockResolvedValue([]);
      mockConfigRepository.count.mockResolvedValue(0);
      
      const result = await service.getAllConfig({});
      
      expect(mockConfigRepository.find).toHaveBeenCalledWith(expect.objectContaining({
        order: { createdAt: 'ASC' }
      }));
      expect(result).toEqual({ serverConfig: [], total: 0 });
    });

    it('should handle custom sort and order', async () => {
      mockConfigRepository.find.mockResolvedValue([mockConfig]);
      mockConfigRepository.count.mockResolvedValue(1);
      
      await service.getAllConfig({ 
        sort: 'configName', 
        order: 'desc' 
      });
      
      expect(mockConfigRepository.find).toHaveBeenCalledWith(expect.objectContaining({
        order: { configName: 'desc' }
      }));
    });
  });

  describe('getConfigById', () => {
    it('should return config when valid ID is passed', async () => {
      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      
      const result = await service.getConfigById(mockConfig.id);
      
      expect(result).toEqual(mockConfig);
    });

    it('should throw BadRequestException if invalid UUID is passed', async () => {
      await expect(service.getConfigById('invalid-uuid')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if config is not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      await expect(service.getConfigById(uuidv4())).rejects.toThrow(NotFoundException);
    });
  });

  describe('createConfiguration', () => {
    it('should create and save a new configuration', async () => {
      mockConfigRepository.create.mockReturnValue(mockConfig);
      mockConfigRepository.save.mockResolvedValue(mockConfig);
      mockWorkerRepository.find.mockResolvedValue([mockWorker]);

      const createConfigDTO = {
        projectId:"123456",
        createdBy: "123123",
        stage:"",
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working/dir'
          
        },
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        fileServers: [{
          host: 'localhost',
          protocolVersion: ProtocolVersion.NFSv3,
          serverType: ServerType.emc,
          workers: [mockWorker.id],
          volumes: [{  volumePath: '/new-path', isIncluded: true, createdBy:"1234567" }],
          createdBy:"1234567",
          protocol: Protocol.NFS,
          userName: "TEST"
        }]
      };

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      const result = await service.createConfiguration(createConfigDTO, uuidv4(), uuidv4());

      expect(result).toEqual(mockConfig);
      expect(mockConfigRepository.save).toHaveBeenCalled();
    });

    it('should create working directory mapping when workingDirectory is provided', async () => {
      const configId = uuidv4();
      const workingDirData = {
        pathName: '/test/path',
        pathId: '123',
        workingDirectory: '/working/dir'
      };

      const createConfigDTO = {
        configName: 'Test Config',
        configType: ConfigurationType.file,
        projectId: '123456',
        workingDirectory: workingDirData,
        fileServers: [{
          host: 'test.com',
          serverType: ServerType.emc,
          protocol: Protocol.NFS,
          userName: 'test',
          protocolVersion: ProtocolVersion.NFSv3,
          workers: ['worker1']
        }]
      };

      mockWorkerRepository.find.mockResolvedValue([{ workerId: 'worker1' }]);
      mockConfigRepository.create.mockReturnValue({ id: configId, ...createConfigDTO });
      mockConfigRepository.save.mockResolvedValue({ id: configId, ...createConfigDTO });

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      await service.createConfiguration(createConfigDTO, uuidv4(), uuidv4());

      expect(mockMappingRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        ...workingDirData,
        configId
      }));
    });

    it('should handle null/undefined working directory fields', async () => {
      const configId = uuidv4();
      const createConfigDTO = {
        configName: 'Test Config',
        configType: ConfigurationType.file,
        projectId: '123456',
        workingDirectory: null,
        fileServers: [{
          host: 'test.com',
          serverType: ServerType.emc,
          protocol: Protocol.NFS,
          userName: 'test',
          protocolVersion: ProtocolVersion.NFSv3,
          workers: ['worker1']
        }]
      };

      mockWorkerRepository.find.mockResolvedValue([{ workerId: 'worker1' }]);
      mockConfigRepository.create.mockReturnValue({ id: configId, ...createConfigDTO });
      mockConfigRepository.save.mockResolvedValue({ id: configId, ...createConfigDTO });

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      await service.createConfiguration(createConfigDTO, uuidv4(), uuidv4());

      expect(mockMappingRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        pathName: undefined,
        pathId: undefined,
        workingDirectory: undefined,
        configId
      }));
    });

    it('should handle database error during working directory save', async () => {
      const workingDirData = {
        pathName: '/test/path',
        pathId: '123',
        workingDirectory: '/working/dir'
      };

      const createConfigDTO = {
        configName: 'Test Config',
        configType: ConfigurationType.file,
        projectId: '123456',
        workingDirectory: workingDirData,
        fileServers: [{
          host: 'test.com',
          serverType: ServerType.emc,
          protocol: Protocol.NFS,
          userName: 'test',
          workers: ['worker1'],
          protocolVersion: ProtocolVersion.NFSv3,
        }]
      };

      mockMappingRepository.create.mockReturnValue(workingDirData);
      mockMappingRepository.save.mockRejectedValue(new Error('Database error'));

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      await expect(service.createConfiguration(createConfigDTO, uuidv4(), uuidv4()))
        .rejects
        .toThrow('Error Occurred during creating Config');
    });

    it('should set config status to Active when workingDirectory pathName is empty', async () => {
      const configId = uuidv4();
      const createConfigDTO = {
        configName: 'Test Config',
        configType: ConfigurationType.file,
        projectId: '123456',
        workingDirectory: {
          pathName: '',
          pathId: '',
          workingDirectory: ''
        },
        fileServers: [{
          host: 'test.com',
          serverType: ServerType.emc,
          protocol: Protocol.NFS,
          userName: 'test',
          protocolVersion: ProtocolVersion.NFSv3,
          workers: ['worker1']
        }]
      };

      const mockCreatedConfig = {
        id: configId,
        ...createConfigDTO,
        status: 'Active'
      };

      mockWorkerRepository.find.mockResolvedValue([{ workerId: 'worker1' }]);
      mockConfigRepository.create.mockReturnValue(mockCreatedConfig);
      mockConfigRepository.save.mockResolvedValue(mockCreatedConfig);
      mockMappingRepository.create.mockReturnValue({ configId, ...createConfigDTO.workingDirectory });
      mockMappingRepository.save.mockResolvedValue({ configId, ...createConfigDTO.workingDirectory });

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      const result = await service.createConfiguration(createConfigDTO, uuidv4(), uuidv4());

      expect(result.status).toBe('Active');
    });

    it('should handle empty workers array in fileServer', async () => {
      const configId = uuidv4();
      const createConfigDTO = {
        configName: 'Test Config',
        configType: ConfigurationType.file,
        projectId: '123456',
        workingDirectory: {
          pathName: '/test',
          pathId: '123',
          workingDirectory: '/working/dir'
        },
        fileServers: [{
          host: 'test.com',
          serverType: ServerType.emc,
          protocol: Protocol.NFS,
          userName: 'test',
          protocolVersion: ProtocolVersion.NFSv3,
          workers: []
        }]
      };

      mockWorkerRepository.find.mockResolvedValue([]);
      mockConfigRepository.create.mockReturnValue({ id: configId, ...createConfigDTO });
      mockConfigRepository.save.mockImplementation(data => data);
      mockMappingRepository.create.mockReturnValue({ configId, ...createConfigDTO.workingDirectory });
      mockMappingRepository.save.mockResolvedValue({ configId, ...createConfigDTO.workingDirectory });

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      const result = await service.createConfiguration(createConfigDTO, uuidv4(), uuidv4());

      expect(result.fileServers[0].workers).toEqual([]);
    });
  });

  describe('updateConfiguration', () => {
    
    it('should update and save the configuration', async () => {
      const existingConfig = {
        id: uuidv4(),
        configName: 'Old Config',
        configType: ConfigurationType.file,
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          protocol: Protocol.NFS,
          createdBy: '1234567',
          volumes: [],
          workers: []
        }]
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: "123456",
        createdBy: "123123",
        configName: 'Updated Config',
        workingDirectory: {
          pathName: '/test/path',
          pathId: '123',
          workingDirectory: '/working/dir'
        },
        configType: ConfigurationType.file,
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          protocolVersion: ProtocolVersion.NFSv3,
          serverType: ServerType.emc,
          workers: [mockWorker.id],
          createdBy: "1234567",
          protocol: Protocol.NFS,
          userName: "TEST"
        }]
      };

      const existingMapping = {
        id: 'mapping-123',
        pathId: '123',
        pathName: '/old/path',
        workingDirectory: '/old/dir'
      };

      const updatedMapping = {
        ...existingMapping,
        pathName: '/test/path',
        workingDirectory: '/working/dir'
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockConfigRepository.save.mockResolvedValue({ ...existingConfig, ...updateConfigDTO });
      mockWorkerRepository.find.mockResolvedValue([{ workerId: mockWorker.id }]);
      mockFileServerRepository.create.mockReturnValue(updateConfigDTO.fileServers[0]);
      mockMappingRepository.findOne.mockResolvedValue(existingMapping);
      mockMappingRepository.save.mockResolvedValue(updatedMapping);

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      const result = await service.updateConfiguration(existingConfig.id, updateConfigDTO, uuidv4(), uuidv4());

      expect(mockMappingRepository.findOne).toHaveBeenCalledWith({ 
        where: { configId: existingConfig.id }
      });
      expect(mockMappingRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        id: 'mapping-123',
        pathName: '/test/path',
        workingDirectory: '/working/dir',
        pathId: '123'
      }));

      expect(mockFileServerRepository.create).toHaveBeenCalledWith(expect.objectContaining({
        id: mockFileServer.id,
        host: 'localhost',
        protocol: Protocol.NFS,
        protocolVersion: ProtocolVersion.NFSv3,
        userName: "TEST",
        isRefreshed: false
      }));

      expect(result).toBeDefined();
      expect(result.configName).toBe(updateConfigDTO.configName);
    });

    it('should throw NotFoundException if config is not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      await expect(service.updateConfiguration(uuidv4(), {} as ConfigDTO, uuidv4(), uuidv4()))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should handle working directory mapping not found', async () => {
      const existingConfig = {
        id: uuidv4(),
        fileServers: [{
          id: mockFileServer.id,
          protocol: Protocol.NFS,
          host: 'localhost',
          workers: []
        }]
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: "123456",
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathId: 'non-existent',
          pathName: '/test/path',
          workingDirectory: '/working/dir'
        },
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          protocol: Protocol.NFS,
          protocolVersion: ProtocolVersion.NFSv3,
          workers: [mockWorker.id],
          userName: "TEST"
        }]
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockMappingRepository.findOne.mockRejectedValue(new Error('Not found'));
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      await expect(service.updateConfiguration(existingConfig.id, updateConfigDTO, uuidv4(), uuidv4()))
        .rejects
        .toThrow('Error Occurred during updating Config');
    });

    it('should return the mapping if found', async () => {
      const existingConfig = {
        id: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
        configName: 'Test Config',
        configType: ConfigurationType.file,
        fileServers: [{
          id: mockFileServer.id,
          protocol: Protocol.NFS,
          host: 'localhost',
          workers: []
        }]
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: "123456",
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathId: 'non-existent',
          pathName: '/test/path',
          workingDirectory: '/working/dir'
        },
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          protocol: Protocol.NFS,
          protocolVersion: ProtocolVersion.NFSv3,
          workers: [mockWorker.id],
          userName: "TEST"
        }]
      };

      const expectedResult = {
        id: existingConfig.id,
        configName: updateConfigDTO.configName,
        configType: updateConfigDTO.configType,
        projectId: updateConfigDTO.projectId,
        createdBy: updateConfigDTO.createdBy,
        fileServers: updateConfigDTO.fileServers,
        workingDirectory: updateConfigDTO.workingDirectory
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockConfigRepository.save.mockResolvedValue(expectedResult);
      mockWorkerRepository.find.mockResolvedValue([{ workerId: mockWorker.id }]);
      mockMappingRepository.findOne.mockResolvedValue({
        id: '1234',
        configId: existingConfig.id,
        pathName: '/test/path',
        workingDirectory: '/working/dir',
        pathId: 'non-existent'
      });

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      const result = await service.updateConfiguration(existingConfig.id, updateConfigDTO, uuidv4(), uuidv4());

      expect(result).toEqual(expectedResult);
      expect(mockMappingRepository.findOne).toHaveBeenCalledWith({ 
        where: { configId: existingConfig.id } 
      });
    });
    
    
    
    it('should throw NotFoundException if mapping is not found', async () => {
      const existingConfig = {
        id: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f',
        configName: 'Test Config',
        fileServers: [{
          id: mockFileServer.id,
          protocol: Protocol.NFS,
          host: 'localhost',
          workers: []
        }]
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: "123456",
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathId: 'non-existent',
          pathName: '/test/path',
          workingDirectory: '/working/dir'
        },
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          protocol: Protocol.NFS,
          protocolVersion: ProtocolVersion.NFSv3,
          workers: [mockWorker.id],
          userName: "TEST"
        }]
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockMappingRepository.findOne.mockResolvedValue(null);
      mockWorkerRepository.find.mockResolvedValue([{ workerId: mockWorker.id }]);
      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      try {
        await service.updateConfiguration('36bfd77f-1d7c-47a3-8c62-3c8739e2f88f', updateConfigDTO, uuidv4(), uuidv4());
        fail('Should have thrown InternalServerErrorException');
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect(error.message).toBe('Error Occurred during updating Config');
      }

      expect(mockMappingRepository.findOne).toHaveBeenCalledWith({ 
        where: { configId: '36bfd77f-1d7c-47a3-8c62-3c8739e2f88f' } 
      });
    });
    
    it('should handle update when workingDirectory is null', async () => {
      const existingConfig = {
        id: uuidv4(),
        configName: 'Old Config',
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          protocol: Protocol.NFS,
          workers: []
        }]
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: "123456",
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathName: '',
          pathId: '',
          workingDirectory: ''
        },
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          protocol: Protocol.NFS,
          protocolVersion: ProtocolVersion.NFSv3,
          userName: 'test',
          workers: [mockWorker.id]
        }]
      };

      const existingMapping = {
        id: 'mapping-123',
        pathId: '123',
        pathName: '/old/path',
        workingDirectory: '/old/dir'
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockConfigRepository.save.mockResolvedValue({ ...existingConfig, ...updateConfigDTO });
      mockWorkerRepository.find.mockResolvedValue([{ workerId: mockWorker.id }]);
      mockMappingRepository.findOne.mockResolvedValue(existingMapping);
      mockMappingRepository.save.mockResolvedValue(existingMapping);

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)
      const result = await service.updateConfiguration(existingConfig.id, updateConfigDTO, uuidv4(), uuidv4());

      expect(result).toBeDefined();
      expect(mockMappingRepository.save).toHaveBeenCalledWith(existingMapping);
    });

    it('should handle fileServer update with missing optional fields', async () => {
      const existingConfig = {
        id: uuidv4(),
        configName: 'Old Config',
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          protocol: Protocol.NFS,
          userName: 'oldUser',
          workers: []
        }]
      };

      const updateConfigDTO: ConfigDTO = {
        projectId: "123456",
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        workingDirectory: {
          pathName: '',
          pathId: '',
          workingDirectory: ''
        },
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          protocol: Protocol.NFS,
          protocolVersion: ProtocolVersion.NFSv3,
          userName: 'test',
          workers: [mockWorker.id]
        }]
      };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockConfigRepository.save.mockImplementation(data => data);
      mockWorkerRepository.find.mockResolvedValue([{ workerId: mockWorker.id }]);
      mockMappingRepository.findOne.mockResolvedValue({});
      mockMappingRepository.save.mockImplementation(data => data);

      jest.spyOn(service, 'refreshConfig').mockResolvedValue({}as any)      
      await service.updateConfiguration(existingConfig.id, updateConfigDTO,uuidv4(), uuidv4());

      expect(mockFileServerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userName: existingConfig.fileServers[0].userName
        })
      );
    });

  });

  describe('remove', () => {
    it('should remove the configuration', async () => {
      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockConfigRepository.remove.mockResolvedValue(mockConfig);

      const result = await service.remove(mockConfig.id);

      expect(result).toEqual(mockConfig);
      expect(mockConfigRepository.remove).toHaveBeenCalled();
    });

    it('should throw BadRequestException if invalid UUID is passed', async () => {
      await expect(service.remove('invalid-uuid')).rejects.toThrow(BadRequestException);
    });

    it('should handle non-existent config during removal', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      mockConfigRepository.remove.mockImplementation(() => {
        throw new NotFoundException('Config for id not found.');
      });
      
      await expect(service.remove(uuidv4()))
        .rejects
        .toThrow('Config for id');
    });
  });


  it('should update paths correctly', async () => {
    const id = 'config-id';
    const details = {
        completed: [
            {
                protocolType: 'NFS',
                paths: ['/path1', '/path2'],
            },
            {
                protocolType: 'SMB',
                paths: ['/path3'],
            },
        ],
    };

    const mockConfig = {
        id,
        updatedBy: 'user-id',
        createdBy: 'creator-id',
        fileServers: [
            {
                id: 'file-server-1',
                protocol: 'NFS',
                volumes: [
                    { id: 'vol-1', volumePath: '/path1' },
                ],
            },
            {
                id: 'file-server-2',
                protocol: 'SMB',
                volumes: [],
            },
        ],
    };

    jest.spyOn(configRepository, 'findOne').mockResolvedValue(mockConfig as any);
    mockVolumeRepository.update.mockResolvedValue(null)
    mockVolumeRepository.create.mockImplementation((data) => data);
    mockVolumeRepository.save.mockImplementation((data) => data);
    mockFileServerRepository.update.mockResolvedValue(null);
    mockConfigRepository.update.mockResolvedValue(null)


    await service.updatePaths(id, details as any);

    expect(configRepository.findOne).toHaveBeenCalledWith({
        select: {
            fileServers: {
                id: true,
                protocol: true,
                volumes: {
                    id: true,
                    volumePath: true,
                },
            },
        },
        where: { id },
        relations: {
            fileServers: {
                volumes: true,
            },
        },
    });

  });


  describe('refresh', ()=>{
    it('should throw NotFoundException if config is not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);

      await expect(service.refreshConfig('invalid-id', 'trace-id')).rejects.toThrow(NotFoundException);
      expect(configRepository.findOne).toHaveBeenCalledWith({
          where: { id: 'invalid-id' },
          relations: { fileServers: { workers: true } },
      });
    });


    it('should not proceed if no workers are found', async () => {
      const mockConfig = {
          id: 'config-id',
          fileServers: [
              {
                  id: 'file-server-1',
                  host: 'localhost',
                  protocol: 'NFS',
                  userName: 'user',
                  password: 'pass',
                  workers: [],
              },
          ],
      };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      const result = await service.refreshConfig('config-id', 'trace-id');

      expect(result).toBeUndefined();
    });


    it('should start workflow and update file servers', async () => {
      const mockConfig = {
          id: 'config-id',
          fileServers: [
              {
                  id: 'file-server-1',
                  host: 'localhost',
                  protocol: 'NFS',
                  userName: 'user',
                  password: 'pass',
                  workers: [
                      { workerId: 'worker-1' },
                      { workerId: 'worker-2' },
                  ],
              },
          ],
      };

      const mockWorkflow = { workflowId: 'workflow-123' };

      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockFileServerRepository.update.mockResolvedValue(null)
      jest.spyOn(workflowService, 'startWorkflow').mockResolvedValue(mockWorkflow as any);
      jest.spyOn(service, 'updateResult').mockResolvedValue(null);

      const result = await service.refreshConfig('config-id', 'trace-id');

      expect(result).toEqual({ workflowId: 'workflow-123' });
    })
  })

});
