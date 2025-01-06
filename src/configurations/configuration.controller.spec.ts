import { Test, TestingModule } from '@nestjs/testing';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';



import { ConfigurationType } from 'src/constants/enums';
import { ConfigDTO } from './dto/config.dto';
import { UserDetails } from './configuration.types';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { FindAllConfigPageDto } from './dto/findallconfig.dto';

describe('ConfigurationController', () => {
  let controller: ConfigurationController;
  let service: ConfigurationService;

  const mockConfigurationService = {
    createConfiguration: jest.fn(),
    getAllConfig: jest.fn(),
    getConfigById: jest.fn(),
    updateConfiguration: jest.fn(),
    remove: jest.fn(),
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

  describe('createConfiguration', () => {
    it('should create a new configuration', async () => {
      const createConfigDTO: ConfigDTO = {
        configName: "testConfig",
        configType: ConfigurationType.file,
        workingDirectory: {
          path: '/temp',
          pathId: '123123',
        },
        fileServers: [],
        projectId: "2345678",
      };
      const createdConfig = {
        configName: "testConfig",
        configType: ConfigurationType.file,
        fileServers: [],
        workingDirectory: {
          path: '/temp',
          pathId: '123123',
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
      // expect(service.createConfiguration).toHaveBeenCalledWith(createConfigDTO, user.user.id);
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

  describe('update', () => {
    it('should update configuration by ID', async () => {
      const configId = '1';


      const updateConfigDTO: ConfigDTO = {
        configName: "testConfigUpdate",
        configType: ConfigurationType.file,
        fileServers: [],
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

      mockConfigurationService.updateConfiguration.mockResolvedValue(updatedConfig);

      const result = await controller.update(configId, updateConfigDTO, user);
      expect(result).toEqual(updatedConfig);
      // expect(service.updateConfiguration).toHaveBeenCalledWith(configId, updateConfigDTO, user.user.id);
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
