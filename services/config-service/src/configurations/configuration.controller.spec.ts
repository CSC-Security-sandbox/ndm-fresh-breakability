import { Test, TestingModule } from '@nestjs/testing';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { ConfigurationType } from 'src/constants/enums';
import { ConfigDTO } from './dto/config.dto';
import { FindAllConfigPageDto } from './dto/findallconfig.dto';
import { UserDetails } from './configuration.types';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ConfigurationController', () => {
  let controller: ConfigurationController;
  let service: ConfigurationService;

  const mockConfigurationService = {
    createConfiguration: jest.fn(),
    getAllConfig: jest.fn(),
    getConfigById: jest.fn(),
    updateConfiguration: jest.fn(),
    refreshConfig: jest.fn(),
    remove: jest.fn(),
    isConfigNameUnique: jest.fn()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConfigurationController],
      providers: [
        {
          provide: ConfigurationService,
          useValue: mockConfigurationService,
         
        },
        {
          provide: JwtService,
          useValue: {},
        }
      ],
    }).compile();

    controller = module.get<ConfigurationController>(ConfigurationController);
    service = module.get<ConfigurationService>(ConfigurationService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
//on finish check here
  describe('createConfiguration', () => {
    it('should create a new configuration', async () => {
      const createConfigDTO: ConfigDTO = {
        configName: "testConfig",
        configType: ConfigurationType.file,
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working-directory'
        },
        fileServers: [],
        projectId: "2345678",
      };
      const createdConfig = {
        configName: "testConfig",
        configType: ConfigurationType.file,
        fileServers: [],
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working-directory'
        },
        projectId: "2345678",
        stage: "212"
       };
       const user: UserDetails = {
        user: {
          id: '23',
          roles: []
        }
       }
      mockConfigurationService.createConfiguration.mockResolvedValue(createdConfig);

      const result = await controller.createConfiguration(createConfigDTO,user);
      expect(result).toEqual(createdConfig);
    });
  });

  describe('getConfigs', () => {
    it('should return paginated list of configurations', async () => {
      const findAllConfigPageDto: FindAllConfigPageDto = { page: "1", limit: "10" };
      const configList = [];

      mockConfigurationService.getAllConfig.mockResolvedValue(configList);

      const result = await controller.getAllConfiguration(findAllConfigPageDto);
      expect(result).toEqual(configList);
      expect(service.getAllConfig).toHaveBeenCalledWith(findAllConfigPageDto);
    });
  });

  describe('getConfiguration', () => {
    it('should return a configuration by ID', async () => {
      const configId = '1';
      const config = {}; 

      mockConfigurationService.getConfigById.mockResolvedValue(config);

      const result = await controller.getConfiguration(configId);
      expect(result).toEqual(config);
      expect(service.getConfigById).toHaveBeenCalledWith(configId);
    });

  });

  describe('checkUniqueConfigName', () => {
    it('should return true if config name is unique', async () => {
      jest.spyOn(service, 'isConfigNameUnique').mockResolvedValue({ isUnique: true });
      await expect(controller.isConfigNameUnique('project-id', 'config-name')).resolves.toEqual({ isUnique: true });
    });

    it('should throw NotFoundException if project ID is invalid', async () => {
      jest.spyOn(service, 'isConfigNameUnique').mockRejectedValue(new NotFoundException('Invalid Project ID'));
      await expect(controller.isConfigNameUnique('invalid-project-id', 'config-name')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if config name is not unique', async () => {
      jest.spyOn(service, 'isConfigNameUnique').mockRejectedValue(new BadRequestException('Config name already exists for this project.'));
      await expect(controller.isConfigNameUnique('project-id', 'config-name')).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should update configuration by ID', async () => {
      const configId = '1';


      const updateConfigDTO: ConfigDTO = {
        configName: "testConfigUpdate",
        configType: ConfigurationType.file,
        fileServers: [],
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working-directory'
        },
        projectId: "2345678",
        createdBy: "1234"
      };
      const updatedConfig = {
        configName: "testConfig",
        configType: ConfigurationType.file,
        fileServers: [],
        projectId: "2345678",
        stage: "212"
       };

       const user: UserDetails = {
        user: {
          id: '23',
          roles: []
        }
       }

      jest.spyOn(service, 'refreshConfig').mockReturnValue({} as any)
      mockConfigurationService.updateConfiguration.mockResolvedValue(updatedConfig);

      const result = await controller.update(configId, updateConfigDTO, user);
      expect(result).toEqual(updatedConfig);
    });
  });

  describe('remove', () => {
    it('should delete configuration by ID', async () => {
      const configId = '1';
      const deleteResult = { };

      mockConfigurationService.remove.mockResolvedValue(deleteResult);

      const result = await controller.remove(configId);
      expect(result).toEqual(deleteResult);
      expect(service.remove).toHaveBeenCalledWith(configId);
    });
  });
});
