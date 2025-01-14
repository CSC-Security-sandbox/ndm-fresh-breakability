import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigurationType, Protocol, ProtocolVersion, ServerType } from 'src/constants/enums';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { RabbitMQService } from 'src/rabbitmq/rabbitmq.service';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ConfigurationService } from './configuration.service';
import { ConfigDTO, UpdateConfigDTO } from './dto/config.dto';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';


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
};

const mockFileServerRepository = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockVolumeRepository = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockWorkerRepository = {
  findByIds: jest.fn(),
  find: jest.fn(),
};

const mockMappingRepository = {
  create: jest.fn(),
  save: jest.fn(),
  findOneByOrFail: jest.fn(),
};

describe('ConfigurationService', () => {
  let service: ConfigurationService;
  let configRepository: Repository<ConfigEntity>;
  let rabbitMqService: RabbitMQService;
  let mappingRepository: Repository<FileServerWorkingDirectoryMappingEntity>;

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
        {
          provide: RabbitMQService,
          useValue: {
            sendMessage: jest.fn(),
          },
        }
      ],
    }).compile();

    service = module.get<ConfigurationService>(ConfigurationService);
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

      const result = await service.createConfiguration(createConfigDTO, uuidv4());

      expect(result).toEqual(mockConfig);
      expect(mockConfigRepository.save).toHaveBeenCalled();
    });

    it('should create working directory mapping when workingDirectory is provided', async () => {
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

      mockMappingRepository.create.mockReturnValue(workingDirData);
      mockMappingRepository.save.mockResolvedValue(workingDirData);
      mockWorkerRepository.find.mockResolvedValue([{ workerId: 'worker1' }]);
      mockConfigRepository.create.mockReturnValue({ id: uuidv4(), ...createConfigDTO });
      mockConfigRepository.save.mockResolvedValue({ id: uuidv4(), ...createConfigDTO });

      await service.createConfiguration(createConfigDTO, 'userId');

      expect(mockMappingRepository.create).toHaveBeenCalledWith(workingDirData);
      expect(mockMappingRepository.save).toHaveBeenCalledWith(workingDirData);
    });

    it('should handle null/undefined working directory fields', async () => {
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
          workers: ['worker1'],
          protocolVersion: ProtocolVersion.NFSv3,
        }]
      };

      const expectedWorkingDir = {
        pathName: undefined,
        pathId: undefined,
        workingDirectory: undefined,
      };

      mockMappingRepository.create.mockReturnValue(expectedWorkingDir);
      mockMappingRepository.save.mockResolvedValue(expectedWorkingDir);
      mockWorkerRepository.find.mockResolvedValue([{ workerId: 'worker1' }]);
      mockConfigRepository.create.mockReturnValue({ id: uuidv4(), ...createConfigDTO });
      mockConfigRepository.save.mockResolvedValue({ id: uuidv4(), ...createConfigDTO });

      await service.createConfiguration(createConfigDTO, 'userId');

      expect(mockMappingRepository.create).toHaveBeenCalledWith(expectedWorkingDir);
      expect(mockMappingRepository.save).toHaveBeenCalledWith(expectedWorkingDir);
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

      await expect(service.createConfiguration(createConfigDTO, 'userId'))
        .rejects
        .toThrow('Error Occurred during creating Config');
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

      const updateConfigDTO: UpdateConfigDTO = {
        projectId: "123456",
        createdBy: "123123",
        configName: 'Updated Config',
        workingDirectory: {
          id: 'mapping-123',
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
      mockMappingRepository.findOneByOrFail.mockResolvedValue(existingMapping);
      mockMappingRepository.save.mockResolvedValue(updatedMapping);

      const result = await service.updateConfiguration(existingConfig.id, updateConfigDTO, 'userId');

      expect(mockMappingRepository.findOneByOrFail).toHaveBeenCalledWith({ 
        id: updateConfigDTO.workingDirectory.id 
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

      expect(mockConfigRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        id: existingConfig.id,
        configName: updateConfigDTO.configName,
        configType: updateConfigDTO.configType,
        createdBy: updateConfigDTO.createdBy,
        updatedBy: 'userId'
      }));

      expect(result).toBeDefined();
      expect(result.configName).toBe(updateConfigDTO.configName);
    });

    it('should throw NotFoundException if config is not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      await expect(service.updateConfiguration(uuidv4(), {} as ConfigDTO, uuidv4()))
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
      mockMappingRepository.findOneByOrFail.mockRejectedValue(new Error('Not found'));

      await expect(service.updateConfiguration(existingConfig.id, updateConfigDTO, 'userId'))
        .rejects
        .toThrow('Error Occurred during updating Config');
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
  });
});
