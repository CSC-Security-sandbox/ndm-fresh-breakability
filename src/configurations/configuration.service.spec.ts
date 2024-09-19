import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { ConfigurationService } from './configuration.service';
import { CreateConfigDTO } from './dto/createconfig.dto';
import { FindallConfigPageDto } from './dto/findallconfig.dto';
import { ConfigUpdateDTO } from './dto/updateconfig.dto';
import { ConfigurationType } from 'src/constants/enums';

describe('ConfigurationService', () => {
  let service: ConfigurationService;

  const mockConfigRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  };

  const mockFileServerRepository = {
    create: jest.fn(),
  };

  const mockVolumeRepository = {
    create: jest.fn(),
  };

  const mockAgentRepository = {
    findByIds: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigurationService,
        { provide: getRepositoryToken(ConfigEntity), useValue: mockConfigRepository },
        { provide: getRepositoryToken(FileServerEntity), useValue: mockFileServerRepository },
        { provide: getRepositoryToken(VolumeEntity), useValue: mockVolumeRepository },
        { provide: getRepositoryToken(AgentEntity), useValue: mockAgentRepository },
      ],
    }).compile();

    service = module.get<ConfigurationService>(ConfigurationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllConfig', () => {
    it('should return paginated configs', async () => {
      const findallConfigPageDto: FindallConfigPageDto = { page: "1", limit: "10", sort: 'createdAt', order: 'asc' };
      const configData = [{ id: '1', configName: 'testConfig' }];
      const total = 1;

      mockConfigRepository.find.mockResolvedValue(configData);
      mockConfigRepository.count.mockResolvedValue(total);

      const result = await service.getAllConfig(findallConfigPageDto);
      expect(result).toEqual({ data: configData, total });
      expect(mockConfigRepository.find).toHaveBeenCalled();
      expect(mockConfigRepository.count).toHaveBeenCalled();
    });

    it('should return all configs if pagination is not provided', async () => {
      const configData = [{ id: '1', configName: 'testConfig' }];
      const total = 1;

      mockConfigRepository.find.mockResolvedValue(configData);
      mockConfigRepository.count.mockResolvedValue(total);

      const result = await service.getAllConfig({});
      expect(result).toEqual({ data: configData, total });
    });
  });

  describe('getConfigById', () => {
    it('should return a config by id', async () => {
      const configId = '53e6713e-17a2-47a0-bb58-724ec3329827';
      const config = { id: configId, configName: 'testConfig' };

      mockConfigRepository.findOne.mockResolvedValue(config);

      const result = await service.getConfigById(configId);
      expect(result).toEqual(config);
      expect(mockConfigRepository.findOne).toHaveBeenCalledWith({ where: { id: configId }, relations: { project: true, fileServers: { agents: true, volumes: true } } });
    });

    it('should throw BadRequestException for invalid UUID', async () => {
      const invalidId = 'invalid-id';

      await expect(service.getConfigById(invalidId)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if config is not found', async () => {
      const configId = '53e6713e-17a2-47a0-bb58-724ec3329827';
      mockConfigRepository.findOne.mockResolvedValue(null);

      await expect(service.getConfigById(configId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createConfiguration', () => {
    it('should create and return a configuration', async () => {
      const createConfigDTO: CreateConfigDTO = {
        configName: "testConfig",
        configType: ConfigurationType.file,
        fileServers: [],
        projectId: "2345678",
        stage: "212"
       };
      const createdConfig = { id: '1', configName: 'testConfig' };
      const fileServerEntityMock = { host: 'localhost', agents: [], volumes: [] };

      mockFileServerRepository.create.mockResolvedValue(fileServerEntityMock);
      mockConfigRepository.create.mockReturnValue(createdConfig);
      mockConfigRepository.save.mockResolvedValue(createdConfig);

      const result = await service.createConfiguration(createConfigDTO);
      expect(result).toEqual(createdConfig);
      expect(mockConfigRepository.save).toHaveBeenCalledWith(createdConfig);
    });
  });

  describe('updateConfiguration', () => {
    it('should update and return the updated configuration', async () => {
      const configId = '53e6713e-17a2-47a0-bb58-724ec3329827';
      const updateConfigDTO: ConfigUpdateDTO = { configName: "testConfigUpdate",
      configType: ConfigurationType.file,
      fileServers: [],
      projectId: "2345678",
      stage: "212",
      createdBy: "1234" };
      const existingConfig = { id: configId, configName: 'oldConfig', fileServers: [] };

      mockConfigRepository.findOne.mockResolvedValue(existingConfig);
      mockConfigRepository.save.mockResolvedValue({ ...existingConfig, ...updateConfigDTO });

      const result = await service.updateConfiguration(configId, updateConfigDTO);
      expect(result.configName).toEqual(updateConfigDTO.configName);
      expect(mockConfigRepository.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if config not found for update', async () => {
      const configId = '53e6713e-17a2-47a0-bb58-724ec3329827';
      const updateConfigDTO: ConfigUpdateDTO = {  configName: "testConfigUpdate",
      configType: ConfigurationType.file,
      fileServers: [],
      projectId: "2345678",
      stage: "212",
      createdBy: "1234"
     };

      mockConfigRepository.findOne.mockResolvedValue(null);

      await expect(service.updateConfiguration(configId, updateConfigDTO)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete and return the removed config', async () => {
      const configId = '53e6713e-17a2-47a0-bb58-724ec3329827';
      const configToDelete = { id: configId };

      mockConfigRepository.findOne.mockResolvedValue(configToDelete);
      mockConfigRepository.remove.mockResolvedValue(configToDelete);

      const result = await service.remove(configId);
      expect(result).toEqual(configToDelete);
      expect(mockConfigRepository.remove).toHaveBeenCalledWith(configToDelete);
    });

    it('should throw BadRequestException if config to delete is not found', async () => {
      const configId = '5';
      mockConfigRepository.findOne.mockResolvedValue(null);

      await expect(service.remove(configId)).rejects.toThrow(BadRequestException);
    });
  });
});
