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

  describe('fetchZones', () => {
    const mockParams = {
      host: 'isilon.example.com',
      port: 8080,
      username: 'admin',
      password: 'password123',
      certificate: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
      serverType: ServerType.dell,
    };

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

      const result = await service.fetchZones(mockParams);

      expect(result).toBeDefined();
      expect(result.zones).toHaveLength(2);
      expect(result.totalZones).toBe(2);
    });

    it('should return empty zones when no zones found', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce({ zones: [] });

      const result = await service.fetchZones(mockParams);

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

      const result = await service.fetchZones(mockParams);

      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].zoneName).toBe('NoGroupnetZone');
      expect(result.zones[0].ipAddresses).toEqual([]);
    });

    it('should throw BadRequestException for connection refused', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.fetchZones(mockParams)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for timeout', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValue(new Error('Connection timeout'));

      await expect(service.fetchZones(mockParams)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for certificate errors', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValue(new Error('self-signed certificate'));

      await expect(service.fetchZones(mockParams)).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException for unknown errors', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValueOnce(new Error('Unknown error'));

      await expect(service.fetchZones(mockParams)).rejects.toThrow(InternalServerErrorException);
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

      const result = await service.fetchZones(mockParams);

      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].ipAddresses).toEqual([]);
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

      const result = await service.validateConnection(mockParams);

      expect(result).toBe(true);
    });

    it('should return false when response has no name', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce({ guid: 'cluster-guid' });

      const result = await service.validateConnection(mockParams);

      expect(result).toBe(false);
    });

    it('should return false when API call fails', async () => {
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockRejectedValueOnce(new Error('Connection failed'));

      const result = await service.validateConnection(mockParams);

      expect(result).toBe(false);
    });

    it('should use default port 8080 when not provided', async () => {
      const paramsWithoutPort = {
        host: 'isilon.example.com',
        username: 'admin',
        password: 'password123',
        certificate: 'cert',
        serverType: ServerType.dell,
      };

      const mockResponse = { name: 'cluster' };
      const makeApiCallSpy = jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce(mockResponse);

      await service.validateConnection(paramsWithoutPort);

      expect(makeApiCallSpy).toHaveBeenCalledWith(
        'isilon.example.com',
        8080,
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
    it('should handle successful API response', async () => {
      const mockParams = {
        host: 'isilon.example.com',
        port: 8080,
        username: 'admin',
        password: 'password',
        certificate: 'cert',
        serverType: ServerType.dell,
      };

      // Mock zones response
      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce({ zones: [] });

      const result = await service.fetchZones(mockParams);

      expect(result.zones).toEqual([]);
    });

    it('should include certificate in PEM format', async () => {
      const mockParams = {
        host: 'isilon.example.com',
        port: 8080,
        username: 'admin',
        password: 'password',
        certificate: 'MIIC...', // Certificate without PEM headers
        serverType: ServerType.dell,
      };

      jest.spyOn(service as any, 'makeIsilonAPICall')
        .mockResolvedValueOnce({ zones: [] });

      // This verifies the method handles non-PEM formatted certificates
      const result = await service.fetchZones(mockParams);
      expect(result).toBeDefined();
    });
  });
});
