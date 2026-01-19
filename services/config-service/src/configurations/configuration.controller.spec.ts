import { Test, TestingModule } from '@nestjs/testing';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { ConfigurationType, ServerType } from 'src/constants/enums';
import { ConfigDTO, FetchZonesRequestDTO, FetchCertificateRequestDTO, FetchCertificateResponseDTO, FetchZonesResponseDTO } from './dto/config.dto';
import { FindAllConfigPageDto } from './dto/findallconfig.dto';
import { UserDetails } from './configuration.types';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// Storage-aware server types that use API-based discovery
// Add new storage types here as they are supported
const STORAGE_AWARE_SERVER_TYPES: ServerType[] = [ServerType.dell];

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
    isConfigNameUnique: jest.fn(),
    validateConnection: jest.fn(),
    fetchCertificate: jest.fn(),
    fetchZones: jest.fn()
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
        serverType: ServerType.other,
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
      const config = {
        id: '1',
        configName: "testConfig",
        configType: ConfigurationType.file,
        serverType: ServerType.other,
        fileServers: [],
        workingDirectory: {
          pathName: '/temp',
          pathId: '123123',
          workingDirectory: '/working-directory'
        },
        projectId: "2345678",
      }; 

      mockConfigurationService.getConfigById.mockResolvedValue(config);

      const result = await controller.getConfiguration(configId);
      expect(result).toEqual(config);
      expect(mockConfigurationService.getConfigById).toHaveBeenCalledWith(configId, undefined);
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
        serverType: ServerType.other,
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

  describe('refreshConfig', () => {
    it('should refresh configuration successfully', async () => {
      const configId = '1';
      const fileServerId = 'file-server-123';
      const user: UserDetails = {
        user: {
          id: '23',
          roles: []
        },
        trackId: 'track-123'
      };
      const refreshResult = {
        id: configId,
        status: 'refreshed',
        message: 'Configuration refreshed successfully',
        updatedAt: new Date().toISOString()
      };

      mockConfigurationService.refreshConfig.mockResolvedValue(refreshResult);

      const result = await controller.refreshConfig(configId, user, fileServerId);
      expect(result).toEqual(refreshResult);
      expect(mockConfigurationService.refreshConfig).toHaveBeenCalledWith(configId, user.trackId, fileServerId);
    });

    it('should refresh configuration without fileServerId', async () => {
      const configId = '1';
      const user: UserDetails = {
        user: {
          id: '23',
          roles: []
        },
        trackId: 'track-123'
      };
      const refreshResult = {
        id: configId,
        status: 'refreshed',
        message: 'Configuration refreshed successfully'
      };

      mockConfigurationService.refreshConfig.mockResolvedValue(refreshResult);

      const result = await controller.refreshConfig(configId, user);
      expect(result).toEqual(refreshResult);
      expect(mockConfigurationService.refreshConfig).toHaveBeenCalledWith(configId, user.trackId, undefined);
    });

    it('should handle refresh config errors', async () => {
      const configId = 'invalid-id';
      const user: UserDetails = {
        user: {
          id: '23',
          roles: []
        },
        trackId: 'track-123'
      };

      mockConfigurationService.refreshConfig.mockRejectedValue(new NotFoundException('Configuration not found'));

      await expect(controller.refreshConfig(configId, user)).rejects.toThrow(NotFoundException);
      expect(mockConfigurationService.refreshConfig).toHaveBeenCalledWith(configId, user.trackId, undefined);
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

  describe('validateConnection', () => {
    // Storage-aware validate connection tests - runs for all STORAGE_AWARE_SERVER_TYPES
    STORAGE_AWARE_SERVER_TYPES.forEach((storageType) => {
      it(`should validate ${storageType} connection successfully`, async () => {
        const request: FetchZonesRequestDTO = {
          serverType: storageType,
          host: '10.192.7.32',
          port: 8080,
          username: 'root',
          password: 'password123',
          certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'
        };
        const validationResult = { isValid: true, message: 'Connection successful' };

        mockConfigurationService.validateConnection.mockResolvedValue(validationResult);

        const result = await controller.validateConnection(request);
        expect(result).toEqual(validationResult);
        expect(mockConfigurationService.validateConnection).toHaveBeenCalledWith(request);
      });

      it(`should return invalid ${storageType} connection when validation fails`, async () => {
        const request: FetchZonesRequestDTO = {
          serverType: storageType,
          host: '10.192.7.32',
          port: 8080,
          username: 'wronguser',
          password: 'wrongpassword',
          certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'
        };
        const validationResult = { isValid: false, message: 'Invalid credentials' };

        mockConfigurationService.validateConnection.mockResolvedValue(validationResult);

        const result = await controller.validateConnection(request);
        expect(result).toEqual(validationResult);
        expect(mockConfigurationService.validateConnection).toHaveBeenCalledWith(request);
      });

      it(`should handle ${storageType} connection validation errors`, async () => {
        const request: FetchZonesRequestDTO = {
          serverType: storageType,
          host: 'invalid.host',
          port: 8080,
          username: 'root',
          password: 'password123',
          certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'
        };

        mockConfigurationService.validateConnection.mockRejectedValue(new Error('Network error'));

        await expect(controller.validateConnection(request)).rejects.toThrow('Network error');
        expect(mockConfigurationService.validateConnection).toHaveBeenCalledWith(request);
      });
    });
  });

  describe('fetchCertificate', () => {
    // Storage-aware fetch certificate tests - runs for all STORAGE_AWARE_SERVER_TYPES
    STORAGE_AWARE_SERVER_TYPES.forEach((storageType) => {
      it(`should fetch ${storageType} certificate successfully`, async () => {
        const request: FetchCertificateRequestDTO = {
          host: '10.192.7.32',
          serverType: storageType
        };
      const certificateResponse: FetchCertificateResponseDTO = {
        isSelfSigned: true,
        subject: {
          CN: 'storage.example.com',
          O: 'Storage Technologies',
          C: 'US'
        },
        issuer: {
          CN: 'storage.example.com',
          O: 'Storage Technologies',
          C: 'US'
        },
        validFrom: '2024-01-01T00:00:00.000Z',
        validTo: '2025-01-01T00:00:00.000Z',
        serialNumber: '01:23:45:67:89:AB:CD:EF',
        fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD',
        fingerprint256: '12:34:56:78:9A:BC:DE:F0:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
        subjectAltNames: ['DNS:storage.example.com', 'IP:10.192.7.32'],
        daysRemaining: 365,
        isExpired: false,
        issuerChain: [],
        certificatePEM: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
        host: '10.192.7.32',
        port: 443,
        hostMatches: true,
        certificateHosts: ['storage.example.com', '10.192.7.32']
      };

      mockConfigurationService.fetchCertificate.mockResolvedValue(certificateResponse);

      const result = await controller.fetchCertificate(request);
      expect(result).toEqual(certificateResponse);
      expect(mockConfigurationService.fetchCertificate).toHaveBeenCalledWith(request);
      });

      it(`should handle ${storageType} certificate fetch errors`, async () => {
        const request: FetchCertificateRequestDTO = {
          host: 'invalid.host',
          serverType: storageType
        };

        mockConfigurationService.fetchCertificate.mockRejectedValue(new Error('Connection timeout'));

        await expect(controller.fetchCertificate(request)).rejects.toThrow('Connection timeout');
        expect(mockConfigurationService.fetchCertificate).toHaveBeenCalledWith(request);
      });
    });
  });

  describe('fetchZones', () => {
    // Storage-aware fetch zones tests - runs for all STORAGE_AWARE_SERVER_TYPES
    STORAGE_AWARE_SERVER_TYPES.forEach((storageType) => {
      it(`should fetch ${storageType} zones successfully`, async () => {
        const request: FetchZonesRequestDTO = {
          serverType: storageType,
          host: '10.192.7.32',
          port: 8080,
          username: 'root',
          password: 'password123',
          certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'
        };
      const zonesResponse: FetchZonesResponseDTO = {
        zones: [
          {
            zoneId: 1,
            zoneName: 'System',
            ipAddresses: ['192.168.1.10', '192.168.1.11'],
            smartConnectFqdn: 'storage.lab.local',
            ssip: '192.168.1.100'
          },
          {
            zoneId: 2,
            zoneName: 'zone1',
            ipAddresses: ['192.168.1.20', '192.168.1.21']
          }
        ],
        totalZones: 2,
        totalIpAddresses: 4
      };

      mockConfigurationService.fetchZones.mockResolvedValue(zonesResponse);

      const result = await controller.fetchZones(request);
      expect(result).toEqual(zonesResponse);
      expect(mockConfigurationService.fetchZones).toHaveBeenCalledWith(request);
    });

      it(`should handle empty ${storageType} zones response`, async () => {
        const request: FetchZonesRequestDTO = {
          serverType: storageType,
          host: '10.192.7.32',
          port: 8080,
          username: 'root',
          password: 'password123',
          certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'
        };
        const emptyZonesResponse: FetchZonesResponseDTO = {
          zones: [],
          totalZones: 0,
          totalIpAddresses: 0
        };

        mockConfigurationService.fetchZones.mockResolvedValue(emptyZonesResponse);

        const result = await controller.fetchZones(request);
        expect(result).toEqual(emptyZonesResponse);
        expect(mockConfigurationService.fetchZones).toHaveBeenCalledWith(request);
      });

      it(`should handle ${storageType} zones fetch errors`, async () => {
        const request: FetchZonesRequestDTO = {
          serverType: storageType,
          host: '10.192.7.32',
          port: 8080,
          username: 'wronguser',
          password: 'wrongpassword',
          certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'
        };

        mockConfigurationService.fetchZones.mockRejectedValue(new Error('Authentication failed'));

        await expect(controller.fetchZones(request)).rejects.toThrow('Authentication failed');
        expect(mockConfigurationService.fetchZones).toHaveBeenCalledWith(request);
      });
    });
  });
});
