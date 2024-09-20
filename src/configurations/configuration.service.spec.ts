import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { AgentEntity } from 'src/entities/agent.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigurationService } from './configuration.service';
import { v4 as uuidv4 } from 'uuid';
import { Repository } from 'typeorm';
import { ConfigUpdateDTO } from './dto/updateconfig.dto';
import { ConfigurationType, Protocol, ServerType } from 'src/constants/enums';

// Mock data for entities
const mockConfig = { id: uuidv4(), configName: 'Test Config', configType: 'Type1' };
const mockFileServer = { id: uuidv4(), host: 'localhost', serverType: 'Type1', agents: [], volumes: [] };
const mockVolume = { id: uuidv4(), volumePath: '/path', isIncluded: true };
const mockAgent = { id: uuidv4(), agentName: 'Agent1' };

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

const mockAgentRepository = {
  findByIds: jest.fn(),
};

describe('ConfigurationService', () => {
  let service: ConfigurationService;
  let configRepository: Repository<ConfigEntity>;

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
          provide: getRepositoryToken(AgentEntity),
          useValue: mockAgentRepository,
        },
      ],
    }).compile();

    service = module.get<ConfigurationService>(ConfigurationService);
    configRepository = module.get(getRepositoryToken(ConfigEntity));
  });

  describe('getAllConfig', () => {
    it('should return paginated config results', async () => {
      mockConfigRepository.find.mockResolvedValue([mockConfig]);
      mockConfigRepository.count.mockResolvedValue(1);
      
      const result = await service.getAllConfig({ page: '1', limit: '10', sort: 'createdAt', order: 'asc' });
      
      expect(mockConfigRepository.find).toHaveBeenCalled();
      expect(result.data).toEqual([mockConfig]);
      expect(result.total).toBe(1);
    });

    it('should return all configs without pagination if page and limit are not provided', async () => {
      mockConfigRepository.find.mockResolvedValue([mockConfig]);
      mockConfigRepository.count.mockResolvedValue(1);
      
      const result = await service.getAllConfig({});
      
      expect(mockConfigRepository.find).toHaveBeenCalled();
      expect(result.data).toEqual([mockConfig]);
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
      mockAgentRepository.findByIds.mockResolvedValue([mockAgent]);

      const createConfigDTO = {
        projectId:"123456",
        createdBy: "123123",
        stage:"",
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        fileServers: [{
          host: 'localhost',
          serverType: ServerType.emc,
          agents: [mockAgent.id],
          volumes: [{  volumePath: '/new-path', isIncluded: true, createdBy:"1234567" }],
          createdBy:"1234567",
          protocol: Protocol.NFS,
          userName: "TEST"
        }]
      };

      const result = await service.createConfiguration(createConfigDTO);

      expect(result).toEqual(mockConfig);
      expect(mockConfigRepository.save).toHaveBeenCalled();
    });
  });

  describe('updateConfiguration', () => {
    it('should update and save the configuration', async () => {
      mockConfigRepository.findOne.mockResolvedValue(mockConfig);
      mockConfigRepository.save.mockResolvedValue(mockConfig);
      mockAgentRepository.findByIds.mockResolvedValue([mockAgent]);

      const updateConfigDTO:ConfigUpdateDTO = {
        projectId:"123456",
        createdBy: "123123",
        stage:"",
        configName: 'Updated Config',
        configType: ConfigurationType.file,
        fileServers: [{
          id: mockFileServer.id,
          host: 'localhost',
          serverType: ServerType.emc,
          agents: [mockAgent.id],
          volumes: [{ id: mockVolume.id, volumePath: '/new-path', isIncluded: true, createdBy:"1234567" }],
          createdBy:"1234567",
          protocol: Protocol.NFS,
          userName: "TEST"
        }]
      };

      const result = await service.updateConfiguration(mockConfig.id, updateConfigDTO);

      expect(result).toEqual(mockConfig);
      expect(mockConfigRepository.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if config is not found', async () => {
      mockConfigRepository.findOne.mockResolvedValue(null);
      await expect(service.updateConfiguration(uuidv4(), {} as any)).rejects.toThrow(NotFoundException);
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
