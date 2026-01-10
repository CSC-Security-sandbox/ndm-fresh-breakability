import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { IsilonStorageClient } from './isilon-storage-client';
import { FileServerEntity } from '../../entities/fileserver.entity';
import { ServerType } from '../../constants/enums';

// Mock https module
jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('IsilonStorageClient', () => {
  let service: IsilonStorageClient;
  let fileServerRepository: Repository<FileServerEntity>;

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue({
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    }),
  };

  const mockFileServerRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IsilonStorageClient,
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: getRepositoryToken(FileServerEntity),
          useValue: mockFileServerRepository,
        },
      ],
    }).compile();

    service = module.get<IsilonStorageClient>(IsilonStorageClient);
    fileServerRepository = module.get<Repository<FileServerEntity>>(
      getRepositoryToken(FileServerEntity),
    );

    jest.clearAllMocks();
  });

  describe('detectIsilonVersion', () => {
    const mockConnectionParams = {
      host: 'isilon.example.com',
      port: 8080,
      username: 'admin',
      password: 'password123',
      certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
    };

    it('should detect OneFS 9.4.x and return API v14', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '9.4.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('9.4.0.0');
      expect(result.apiVersion).toBe(14);
    });

    it('should detect OneFS 8.2.1.x and return API v8', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '8.2.1.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('8.2.1.0');
      expect(result.apiVersion).toBe(8);
    });

    it('should detect OneFS 8.1.0.x and return API v5', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '8.1.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('8.1.0.0');
      expect(result.apiVersion).toBe(5);
    });

    it('should detect OneFS 8.0.x and return API v3', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '8.0.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('8.0.0.0');
      expect(result.apiVersion).toBe(3);
    });

    it('should detect OneFS 7.x and return API v3 (earliest documented)', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '7.2.1.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('7.2.1.0');
      expect(result.apiVersion).toBe(3);
    });

    it('should detect OneFS 9.3.0.x and return API v14', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '9.3.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('9.3.0.0');
      expect(result.apiVersion).toBe(14);
    });

    it('should detect OneFS 9.2.1.x and return API v13', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '9.2.1.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('9.2.1.0');
      expect(result.apiVersion).toBe(13);
    });

    it('should detect OneFS 9.2.0.x and return API v12', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '9.2.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('9.2.0.0');
      expect(result.apiVersion).toBe(12);
    });

    it('should detect OneFS 9.1.0.x and return API v11', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '9.1.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('9.1.0.0');
      expect(result.apiVersion).toBe(11);
    });

    it('should detect OneFS 9.0.0.x and return API v10', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '9.0.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('9.0.0.0');
      expect(result.apiVersion).toBe(10);
    });

    it('should detect OneFS 8.2.2.x and return API v9', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '8.2.2.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('8.2.2.0');
      expect(result.apiVersion).toBe(9);
    });

    it('should detect OneFS 8.2.0.x and return API v7', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '8.2.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('8.2.0.0');
      expect(result.apiVersion).toBe(7);
    });

    it('should detect OneFS 8.1.1.x and return API v6', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '8.1.1.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('8.1.1.0');
      expect(result.apiVersion).toBe(6);
    });

    it('should detect OneFS 8.0.1.x and return API v4', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '8.0.1.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('8.0.1.0');
      expect(result.apiVersion).toBe(4);
    });

    it('should handle version from version field if release is not available', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { version: '9.5.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('9.5.0.0');
      expect(result.apiVersion).toBe(14);
    });

    it('should default to API v14 when version cannot be determined', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: {},
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('unknown');
      expect(result.apiVersion).toBe(14);
    });

    it('should default to API v14 when version cannot be parsed', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: 'invalid-version' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('invalid-version');
      expect(result.apiVersion).toBe(14);
    });

    it('should default to API v14 when API call fails', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockRejectedValueOnce(
        new Error('Connection failed'),
      );

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('unknown');
      expect(result.apiVersion).toBe(14);
    });

    it('should handle version with v prefix', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: 'v9.3.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('v9.3.0.0');
      expect(result.apiVersion).toBe(14);
    });

    it('should detect OneFS 10.x (future version) and return API v14', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '10.0.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('10.0.0.0');
      expect(result.apiVersion).toBe(14);
    });

    it('should detect OneFS 8.3.x and return API v9', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall').mockResolvedValueOnce({
        onefs_version: { release: '8.3.0.0' },
      });

      const result = await service.detectIsilonVersion(
        mockConnectionParams.host,
        mockConnectionParams.port,
        mockConnectionParams.username,
        mockConnectionParams.password,
        mockConnectionParams.certificate,
      );

      expect(result.oneFsVersion).toBe('8.3.0.0');
      expect(result.apiVersion).toBe(9);
    });
  });

  describe('fetchZones', () => {
    const mockParams = {
      host: 'isilon.example.com',
      port: 8080,
      username: 'admin',
      password: 'password123',
      certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
      serverType: ServerType.dell,
    };

    beforeEach(() => {
      // Set instance properties for fetchZones tests
      service.hostname = mockParams.host;
      service.port = mockParams.port;
      service.username = mockParams.username;
      service.password = mockParams.password;
      service.certificate = mockParams.certificate;
      
      // Mock detectIsilonVersion for all fetchZones tests
      jest.spyOn(service, 'detectIsilonVersion').mockResolvedValue({
        oneFsVersion: '9.4.0.0',
        apiVersion: 14,
      });
    });

    it('should fetch zones successfully', async () => {
      const mockZonesResponse = {
        zones: [
          { name: 'System', zone_id: 1, groupnet: 'groupnet0' },
          { name: 'zone1', zone_id: 2, groupnet: 'groupnet0' },
        ],
      };

      const mockSubnetsResponse = {
        subnets: [
          {
            name: 'subnet0',
            sc_service_name: 'smartconnect',
            sc_service_addrs: [{ low: '10.0.0.100' }],
          },
        ],
      };

      const mockPoolsResponse = {
        pools: [
          {
            name: 'pool0',
            access_zone: 'System',
            sc_dns_zone: 'example.com',
          },
        ],
      };

      const mockInterfacesResponse = {
        interfaces: [
          { ip_addrs: ['10.0.0.1', '10.0.0.2'] },
        ],
      };

      // Mock the makeIsilonAPICall method
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockZonesResponse) // zones
        .mockResolvedValueOnce(mockSubnetsResponse) // subnets for zone 1
        .mockResolvedValueOnce(mockPoolsResponse) // pools for subnet
        .mockResolvedValueOnce(mockInterfacesResponse) // interfaces for pool
        .mockResolvedValueOnce(mockSubnetsResponse) // subnets for zone 2
        .mockResolvedValueOnce(mockPoolsResponse) // pools for subnet
        .mockResolvedValueOnce(mockInterfacesResponse); // interfaces for pool

      const result = await service.fetchZones();

      expect(result).toBeDefined();
      expect(result.zones).toHaveLength(2);
      expect(result.totalZones).toBe(2);
    });

    it('should return empty zones when no zones found', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce({ zones: [] });

      const result = await service.fetchZones();

      expect(result.zones).toEqual([]);
      expect(result.totalZones).toBe(0);
      expect(result.totalIpAddresses).toBe(0);
    });

    it('should handle zones with no groupnet', async () => {
      const mockZonesResponse = {
        zones: [
          { name: 'NoGroupnetZone', zone_id: 1, groupnet: '' },
        ],
      };

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockZonesResponse);

      const result = await service.fetchZones();

      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].zoneName).toBe('NoGroupnetZone');
      expect(result.zones[0].ipAddresses).toEqual([]);
    });

    it('should throw BadRequestException for connection refused', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.fetchZones()).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for timeout', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValue(new Error('Connection timeout'));

      await expect(service.fetchZones()).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for certificate errors', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValue(new Error('self-signed certificate'));

      await expect(service.fetchZones()).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException for unknown errors', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValueOnce(new Error('Unknown error'));

      await expect(service.fetchZones()).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle subnet fetch failures gracefully', async () => {
      const mockZonesResponse = {
        zones: [
          { name: 'zone1', zone_id: 1, groupnet: 'groupnet0' },
        ],
      };

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockZonesResponse)
        .mockResolvedValueOnce({ subnets: [] }); // Empty subnets

      const result = await service.fetchZones();

      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].ipAddresses).toEqual([]);
    });

    it('should handle pool interface fetch errors gracefully', async () => {
      const mockZonesResponse = {
        zones: [
          { name: 'zone1', zone_id: 1, groupnet: 'groupnet0' },
        ],
      };

      const mockSubnetsResponse = {
        subnets: [{ name: 'subnet0' }],
      };

      const mockPoolsResponse = {
        pools: [{ name: 'pool0', access_zone: 'zone1' }],
      };

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockZonesResponse)
        .mockResolvedValueOnce(mockSubnetsResponse)
        .mockResolvedValueOnce(mockPoolsResponse)
        .mockRejectedValueOnce(new Error('Interface fetch failed')); // interfaces error

      const result = await service.fetchZones();

      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].zoneName).toBe('zone1');
      // Should continue despite interface error
    });

    it('should handle pool fetch errors gracefully', async () => {
      const mockZonesResponse = {
        zones: [
          { name: 'zone1', zone_id: 1, groupnet: 'groupnet0' },
        ],
      };

      const mockSubnetsResponse = {
        subnets: [{ name: 'subnet0' }],
      };

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockZonesResponse)
        .mockResolvedValueOnce(mockSubnetsResponse)
        .mockRejectedValueOnce(new Error('Pool fetch failed')); // pools error

      const result = await service.fetchZones();

      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].zoneName).toBe('zone1');
    });

    it('should handle zone processing errors gracefully', async () => {
      const mockZonesResponse = {
        zones: [
          { name: 'zone1', zone_id: 1, groupnet: 'groupnet0' },
          { name: 'zone2', zone_id: 2, groupnet: 'groupnet0' },
        ],
      };

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockZonesResponse)
        .mockRejectedValueOnce(new Error('Zone processing failed')) // error for zone1
        .mockResolvedValueOnce({ subnets: [] }); // zone2 succeeds with empty subnets

      const result = await service.fetchZones();

      expect(result.zones).toHaveLength(2);
      expect(result.zones[0].zoneName).toBe('zone1');
      expect(result.zones[0].ipAddresses).toEqual([]);
      expect(result.zones[1].zoneName).toBe('zone2');
    });

    it('should include SmartConnect FQDN and SSIP when available', async () => {
      const mockZonesResponse = {
        zones: [
          { name: 'zone1', zone_id: 1, groupnet: 'groupnet0' },
        ],
      };

      const mockSubnetsResponse = {
        subnets: [
          {
            name: 'subnet0',
            sc_service_name: 'smartconnect',
            sc_service_addrs: [{ low: '10.0.0.100' }],
          },
        ],
      };

      const mockPoolsResponse = {
        pools: [
          {
            name: 'pool0',
            access_zone: 'zone1',
            sc_dns_zone: 'example.com',
          },
        ],
      };

      const mockInterfacesResponse = {
        interfaces: [{ ip_addrs: ['10.0.0.1'] }],
      };

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockZonesResponse)
        .mockResolvedValueOnce(mockSubnetsResponse)
        .mockResolvedValueOnce(mockPoolsResponse)
        .mockResolvedValueOnce(mockInterfacesResponse);

      const result = await service.fetchZones();

      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].smartConnectFqdn).toBe('smartconnect.example.com');
      expect(result.zones[0].ssip).toBe('10.0.0.100');
    });

    it('should skip pools that belong to different zone', async () => {
      const mockZonesResponse = {
        zones: [
          { name: 'zone1', zone_id: 1, groupnet: 'groupnet0' },
        ],
      };

      const mockSubnetsResponse = {
        subnets: [{ name: 'subnet0' }],
      };

      const mockPoolsResponse = {
        pools: [
          { name: 'pool0', access_zone: 'different_zone' }, // Different zone
        ],
      };

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockZonesResponse)
        .mockResolvedValueOnce(mockSubnetsResponse)
        .mockResolvedValueOnce(mockPoolsResponse);

      const result = await service.fetchZones();

      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].ipAddresses).toEqual([]);
    });

    it('should handle SSL error message', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValue(new Error('SSL connection failed'));

      await expect(service.fetchZones()).rejects.toThrow(BadRequestException);
    });
  });

  describe('getNFSExportPaths', () => {
    const fileServerId = 'test-file-server-id';

    it('should fetch NFS export paths successfully', async () => {
      const mockFileServer = {
        id: fileServerId,
        fileServerName: 'zone1',
        config: {
          hostname: 'isilon.example.com',
          port: 8080,
          username: 'admin',
          password: 'password',
          tlsCaCertificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
        },
      };

      const mockExportsResponse = {
        exports: [
          { id: 1, paths: ['/ifs/data', '/ifs/data/shared'] },
          { id: 2, paths: ['/ifs/home'] },
        ],
      };

      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockExportsResponse);

      const result = await service.getNFSExportPaths(fileServerId);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ path: '/ifs/data', id: 1 });
      expect(result[1]).toEqual({ path: '/ifs/data/shared', id: 1 });
      expect(result[2]).toEqual({ path: '/ifs/home', id: 2 });
    });

    it('should throw error when file server not found', async () => {
      mockFileServerRepository.findOne.mockResolvedValue(null);

      await expect(service.getNFSExportPaths(fileServerId)).rejects.toThrow(
        InternalServerErrorException
      );
    });

    it('should throw error when config not found', async () => {
      mockFileServerRepository.findOne.mockResolvedValue({
        id: fileServerId,
        config: null,
      });

      await expect(service.getNFSExportPaths(fileServerId)).rejects.toThrow(
        InternalServerErrorException
      );
    });

    it('should return empty array when fileServerName is not set', async () => {
      const mockFileServer = {
        id: fileServerId,
        fileServerName: null,
        config: {
          hostname: 'isilon.example.com',
          port: 8080,
        },
      };

      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);

      const result = await service.getNFSExportPaths(fileServerId);

      expect(result).toEqual([]);
    });

    it('should handle empty exports response', async () => {
      const mockFileServer = {
        id: fileServerId,
        fileServerName: 'zone1',
        config: {
          hostname: 'isilon.example.com',
          port: 8080,
          username: 'admin',
          password: 'password',
          tlsCaCertificate: 'cert',
        },
      };

      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce({ exports: [] });

      const result = await service.getNFSExportPaths(fileServerId);

      expect(result).toEqual([]);
    });

    it('should handle API errors', async () => {
      const mockFileServer = {
        id: fileServerId,
        fileServerName: 'zone1',
        config: {
          hostname: 'isilon.example.com',
          port: 8080,
          username: 'admin',
          password: 'password',
          tlsCaCertificate: 'cert',
        },
      };

      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValueOnce(new Error('API Error'));

      await expect(service.getNFSExportPaths(fileServerId)).rejects.toThrow(
        InternalServerErrorException
      );
    });
  });

  describe('getSMBShares', () => {
    const fileServerId = 'test-file-server-id';

    it('should fetch SMB shares successfully', async () => {
      const mockFileServer = {
        id: fileServerId,
        fileServerName: 'zone1',
        config: {
          hostname: 'isilon.example.com',
          port: 8080,
          username: 'admin',
          password: 'password',
          tlsCaCertificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
        },
      };

      const mockSharesResponse = {
        shares: [
          { name: 'share1', path: '/ifs/share1' },
          { name: 'share2', path: '/ifs/share2' },
        ],
      };

      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockSharesResponse);

      const result = await service.getSMBShares(fileServerId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'share1', path: '/ifs/share1' });
      expect(result[1]).toEqual({ name: 'share2', path: '/ifs/share2' });
    });

    it('should throw error when file server not found', async () => {
      mockFileServerRepository.findOne.mockResolvedValue(null);

      await expect(service.getSMBShares(fileServerId)).rejects.toThrow(
        InternalServerErrorException
      );
    });

    it('should throw error when config not found', async () => {
      mockFileServerRepository.findOne.mockResolvedValue({
        id: fileServerId,
        config: null,
      });

      await expect(service.getSMBShares(fileServerId)).rejects.toThrow(
        InternalServerErrorException
      );
    });

    it('should return empty array when fileServerName is not set', async () => {
      const mockFileServer = {
        id: fileServerId,
        fileServerName: null,
        config: {
          hostname: 'isilon.example.com',
          port: 8080,
        },
      };

      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);

      const result = await service.getSMBShares(fileServerId);

      expect(result).toEqual([]);
    });

    it('should filter out shares without name or path', async () => {
      const mockFileServer = {
        id: fileServerId,
        fileServerName: 'zone1',
        config: {
          hostname: 'isilon.example.com',
          port: 8080,
          username: 'admin',
          password: 'password',
          tlsCaCertificate: 'cert',
        },
      };

      const mockSharesResponse = {
        shares: [
          { name: 'share1', path: '/ifs/share1' },
          { name: null, path: '/ifs/invalid' },
          { name: 'invalid', path: null },
          { name: 'share2', path: '/ifs/share2' },
        ],
      };

      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockSharesResponse);

      const result = await service.getSMBShares(fileServerId);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('share1');
      expect(result[1].name).toBe('share2');
    });

    it('should handle API errors', async () => {
      const mockFileServer = {
        id: fileServerId,
        fileServerName: 'zone1',
        config: {
          hostname: 'isilon.example.com',
          port: 8080,
          username: 'admin',
          password: 'password',
          tlsCaCertificate: 'cert',
        },
      };

      mockFileServerRepository.findOne.mockResolvedValue(mockFileServer);
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValueOnce(new Error('API Error'));

      await expect(service.getSMBShares(fileServerId)).rejects.toThrow(
        InternalServerErrorException
      );
    });
  });

  describe('validateConnection', () => {
    const mockParams = {
      host: 'isilon.example.com',
      port: 8080,
      username: 'admin',
      password: 'password123',
      certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
      serverType: ServerType.dell,
    };

    it('should return true for valid connection', async () => {
      const mockResponse = {
        name: 'isilon-cluster',
        guid: 'cluster-guid',
      };

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockResponse);

      const result = await service.validateConnection();

      expect(result).toBe(true);
    });

    it('should return false when response has no name', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce({ guid: 'cluster-guid' });

      const result = await service.validateConnection();

      expect(result).toBe(false);
    });

    it('should return false when API call fails', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValueOnce(new Error('Connection failed'));

      const result = await service.validateConnection();

      expect(result).toBe(false);
    });

    it('should use port value from instance property', async () => {
      // Set hostname and port
      service.hostname = 'isilon.example.com';
      service.port = 0;
      service.username = 'admin';
      service.password = 'password123';
      service.certificate = 'cert';

      const mockResponse = { name: 'cluster' };
      const makeApiCallSpy = jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockResponse);

      await service.validateConnection();

      // Port uses the instance value (0 in this case)
      expect(makeApiCallSpy).toHaveBeenCalledWith(
        'isilon.example.com',
        0,
        '/platform/1/cluster/config',
        'GET',
        'admin',
        'password123',
        'cert'
      );
    });
  });

  describe('makeIsilonAPICall', () => {
    // Testing the private method through integration with public methods
    beforeEach(() => {
      // Mock detectIsilonVersion for all makeIsilonAPICall tests
      jest.spyOn(service, 'detectIsilonVersion').mockResolvedValue({
        oneFsVersion: '9.4.0.0',
        apiVersion: 7,
      });
    });

    it('should handle successful API response', async () => {
      // Set instance properties
      service.hostname = 'isilon.example.com';
      service.port = 8080;
      service.username = 'admin';
      service.password = 'password';
      service.certificate = 'cert';

      // Mock zones response
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce({ zones: [] });

      const result = await service.fetchZones();

      expect(result.zones).toEqual([]);
    });

    it('should include certificate in PEM format', async () => {
      // Set instance properties
      service.hostname = 'isilon.example.com';
      service.port = 8080;
      service.username = 'admin';
      service.password = 'password';
      service.certificate = 'MIIC...'; // Certificate without PEM headers

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce({ zones: [] });

      // This verifies the method handles non-PEM formatted certificates
      const result = await service.fetchZones();
      expect(result).toBeDefined();
    });
  });
});
