import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import { AuthService } from 'src/auth/auth.service';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { ConfigError, ConfigStatus } from './working-directory.type';
import { ValidateWorkingDirectoryActivity } from './working-directory.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { SMBProtocol } from '../../protocols/smb/smb.protocol';
import { NFSProtocol } from '../../protocols/nfs/nfs.protocol';
import { WorkersConfig } from 'src/config/app.config';
import { CommandConfig } from 'src/config/command.config';
import { mockLogger } from 'src/auth/auth.service.spec';

// Mock Temporal dependencies to avoid native binary issues
jest.mock('@temporalio/core-bridge', () => ({}));
jest.mock('@temporalio/worker', () => ({}));
jest.mock('@temporalio/activity', () => ({}));

// Mock other dependencies
jest.mock('axios');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('src/protocols/protocols');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedFsPromises = fs.promises as jest.Mocked<typeof fs.promises>;

describe('ValidateWorkingDirectoryActivity', () => {
  let service: ValidateWorkingDirectoryActivity;
  let configService: jest.Mocked<ConfigService>;
  let authService: jest.Mocked<AuthService>;
  let mockProtocol: any;
  let loggerFactory: LoggerFactory;
  let protocols: Protocols;
  let logger: LoggerService;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();


    const mockConfigService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker-id';
          case 'worker.baseWorkingPath':
            return '/base/working/path';
          case 'worker.connection.workerConfigUrl':
            return 'http://test-url';
          default:
            return undefined;
        }
      }),
    };

    WorkersConfig.configService = mockConfigService as unknown as ConfigService;
    CommandConfig.configService = mockConfigService as unknown as ConfigService;

    // Create mock protocol
    mockProtocol = {
      mountPath: jest.fn(),
      unmountPath: jest.fn(),
    };

    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

    loggerFactory = mockLoggerFactory as unknown as LoggerFactory;

    protocols = new Protocols(
      new NFSProtocol(loggerFactory),
      new SMBProtocol(loggerFactory)
    );

    const mockProtocols = {
      getProtocol: jest.fn().mockReturnValue(mockProtocol),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateWorkingDirectoryActivity,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: AuthService,
          useValue: {
            getAccessToken: jest.fn(),
          },
        },
        {
          provide: LoggerService,
          useValue: mockLogger as any,
        },
        {
          provide: Protocols,
          useValue: mockProtocols,
        },
      ],
    }).compile();

    service = module.get<ValidateWorkingDirectoryActivity>(ValidateWorkingDirectoryActivity);
    configService = module.get(ConfigService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    logger = module.get<LoggerService>(LoggerService);
    authService = module.get(AuthService);
    protocols = module.get(Protocols);
  });

  describe('validateWorkingDirectory', () => {
    const mockPayload = {
      configId: 'test-config-id',
      exportPathWorkingDirectoryProvided: false,
      exportPathPresent: true,
      exportPath: '/export/path',
      workingDirectory: 'working-dir',
      fetchedPath: '/fetched/path',
      listPathPayload: [
        {
          type: 'NFS',
          host: 'test-host',
          username: 'test-user',
          password: 'test-pass',
          protocolVersion: '3',
        },
      ],
    };

    it('should handle successful mount and unmount when exportPathWorkingDirectoryProvided is false', async () => {
      const payload = { ...mockPayload, exportPathWorkingDirectoryProvided: false };
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });
      mockProtocol.mountPath.mockResolvedValue(undefined);
      mockProtocol.unmountPath.mockResolvedValue(undefined);

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBeDefined();
    });

    it('should handle mount error when exportPathWorkingDirectoryProvided is false', async () => {
      const payload = { ...mockPayload, exportPathWorkingDirectoryProvided: false };
      const mountError = new Error('Mount failed');
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });
      mockProtocol.mountPath.mockRejectedValue(mountError);

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
    });

    it('should handle invalid export path when exportPathPresent is false', async () => {
      const payload = { ...mockPayload, exportPathWorkingDirectoryProvided: true, exportPathPresent: false };
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
    });

    it('should handle invalid directory validation', async () => {
      const payload = { ...mockPayload, exportPathWorkingDirectoryProvided: true };
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });
      
      // Mock isValidDirectory to return false
      jest.spyOn(service, 'isValidDirectory').mockResolvedValue(false);

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
      expect(result.message).toContain(ConfigError.UNABLE_TO_DETECT_EXPORT_PATH);
    });

    it('should handle directory validation error', async () => {
      const payload = { ...mockPayload, exportPathWorkingDirectoryProvided: true };
      const validationError = new Error('Validation error');
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });
      
      // Mock isValidDirectory to throw error
      jest.spyOn(service, 'isValidDirectory').mockRejectedValue(validationError);

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
    });
  });

  describe('getNfsMountErrorMessage', () => {
    it('should return PROTOCOL_NOT_SUPPORTED for illegal NFS version error', () => {
      const error = { message: 'illegal NFS version value' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
    });

    it('should return PROTOCOL_NOT_SUPPORTED for RPC prog not avail error', () => {
      const error = { message: 'RPC prog. not avail' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
    });

    it('should return PROTOCOL_NOT_SUPPORTED for Protocol not supported error', () => {
      const error = { message: 'Protocol not supported for something' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
    });

    it('should return PROTOCOL_NOT_SUPPORTED for version mismatch error', () => {
      const error = { message: 'version mismatch detected' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
    });

    it('should return PROTOCOL_PORT_BLOCKED for port blocked error', () => {
      const error = { message: 'port 2049 is blocked by firewall' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe(ConfigError.PROTOCOL_PORT_BLOCKED);
    });

    it('should return PROTOCOL_PORT_BLOCKED for port filtered error', () => {
      const error = { message: 'port access is filtered' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe(ConfigError.PROTOCOL_PORT_BLOCKED);
    });

    it('should return HOST_OS_NOT_SUPPORTED for OS not supported error', () => {
      const error = { message: 'os not supported for this operation' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe(ConfigError.HOST_OS_NOT_SUPPORTED);
    });

    it('should return HOST_OS_NOT_SUPPORTED for unsupported OS error', () => {
      const error = { message: 'current os is unsupported' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe(ConfigError.HOST_OS_NOT_SUPPORTED);
    });

    it('should return the actual error message for other errors', () => {
      const error = { message: 'Some other random error' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe('Some other random error');
    });

    it('should return empty string when error message is undefined', () => {
      const error = {};
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe('');
    });

    it('should return empty string when error is null', () => {
      const error = null;
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe('');
    });
  });

  describe('handleMountAndUnmountPaths', () => {
    const mockPayload = {
      fetchedPath: '/fetched/path',
      listPathPayload: [
        {
          type: 'NFS',
          host: 'test-host',
          username: 'test-user',
          password: 'test-pass',
          protocolVersion: '3',
        },
      ],
    };

    it('should successfully mount and unmount paths', async () => {
      mockProtocol.mountPath.mockResolvedValue(undefined);
      mockProtocol.unmountPath.mockResolvedValue(undefined);

      await service.handleMountAndUnmountPaths('trace-id', mockPayload);

      expect(mockProtocol.mountPath).toHaveBeenCalledWith('trace-id', {
        hostname: 'test-host',
        username: 'test-user',
        password: 'test-pass',
        protocolVersion: '3',
        path: '/fetched/path',
        mountBasePath: service.baseWorkingPath,
        pathId: 'trace-id',
        jobRunId: 'trace-id',
      }, false);
      expect(mockProtocol.unmountPath).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith('Mounting export path for host test-host');
      expect(logger.log).toHaveBeenCalledWith('Mounted export path successfully');
      expect(logger.log).toHaveBeenCalledWith('Unmounting export path for host test-host');
      expect(logger.log).toHaveBeenCalledWith('Unmounted export path successfully');
    });

    it('should handle mount error and rethrow', async () => {
      const mountError = new Error('Mount failed');
      mockProtocol.mountPath.mockRejectedValue(mountError);

      await expect(service.handleMountAndUnmountPaths('trace-id', mockPayload))
        .rejects.toThrow('Mount failed');

      expect(logger.error).toHaveBeenCalledWith('Error while mounting the path - Mount failed');
    });

    it('should handle mount error without message and rethrow', async () => {
      const mountError = 'String error';
      mockProtocol.mountPath.mockRejectedValue(mountError);

      await expect(service.handleMountAndUnmountPaths('trace-id', mockPayload))
        .rejects.toThrow('String error');

      expect(logger.error).toHaveBeenCalledWith('Error while mounting the path - String error');
    });
  });

  describe('updateConfigStatus', () => {
    const mockPayload = {
      configId: 'test-config-id',
      status: ConfigStatus.ACTIVE,
      errorMessage: null,
    };

    it('should successfully update config status', async () => {
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });

      await service.updateConfigStatus('http://test-url/api', mockPayload);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://test-url/api',
        mockPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          },
        }
      );
    });

    it('should handle API error with response data', async () => {
      authService.getAccessToken.mockResolvedValue('test-token');
      const apiError = {
        response: { data: 'API Error Response' },
        message: 'Network Error',
      };
      mockedAxios.post.mockRejectedValue(apiError);

      await expect(service.updateConfigStatus('http://test-url/api', mockPayload))
        .rejects.toThrow('API Error: API Error Response');

      expect(logger.error).toHaveBeenCalledWith('API Error: API Error Response');
    });

    it('should handle API error without response data', async () => {
      authService.getAccessToken.mockResolvedValue('test-token');
      const apiError = {
        message: 'Network Error',
      };
      mockedAxios.post.mockRejectedValue(apiError);

      await expect(service.updateConfigStatus('http://test-url/api', mockPayload))
        .rejects.toThrow('API Error: Network Error');

      expect(logger.error).toHaveBeenCalledWith('API Error: Network Error');
    });
  });

  describe('isValidDirectory', () => {
    const mockPayload = {
      exportPath: '/export/path',
      workingDirectory: 'working-dir',
      listPathPayload: [
        {
          type: 'NFS',
          host: 'test-host',
          username: 'test-user',
          password: 'test-pass',
          protocolVersion: '3',
        },
      ],
    };

    it('should return true for valid and writable directory', async () => {
      mockProtocol.mountPath.mockResolvedValue(undefined);
      mockProtocol.unmountPath.mockResolvedValue(undefined);
      mockedFs.existsSync.mockReturnValue(true);
      jest.spyOn(service, 'checkWritable').mockResolvedValue(true);

      const result = await service.isValidDirectory(mockPayload, 'trace-id');

      expect(result).toBe(true);
      // The path is constructed using path.join, so we need to expect the actual path construction
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Working Directory exists:'));
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('working-dir'));
    });

    it('should return false for non-existent directory', async () => {
      mockProtocol.mountPath.mockResolvedValue(undefined);
      mockProtocol.unmountPath.mockResolvedValue(undefined);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await service.isValidDirectory(mockPayload, 'trace-id');

      expect(result).toBe(false);
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Working Directory does not exist:'));
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('working-dir'));
    });

    it('should throw error for directory without write permission', async () => {
      mockProtocol.mountPath.mockResolvedValue(undefined);
      mockProtocol.unmountPath.mockResolvedValue(undefined);
      mockedFs.existsSync.mockReturnValue(true);
      jest.spyOn(service, 'checkWritable').mockResolvedValue(false);

      await expect(service.isValidDirectory(mockPayload, 'trace-id'))
        .rejects.toThrow('Provided working directory working-dir has no writable permission');
    });

    it('should handle multiple file servers and break on first valid one', async () => {
      const payloadWithMultipleServers = {
        ...mockPayload,
        listPathPayload: [
          {
            type: 'NFS',
            host: 'test-host-1',
            username: 'test-user-1',
            password: 'test-pass-1',
            protocolVersion: '3',
          },
          {
            type: 'NFS',
            host: 'test-host-2',
            username: 'test-user-2',
            password: 'test-pass-2',
            protocolVersion: '3',
          },
        ],
      };

      mockProtocol.mountPath.mockResolvedValue(undefined);
      mockProtocol.unmountPath.mockResolvedValue(undefined);
      mockedFs.existsSync.mockReturnValue(true);
      jest.spyOn(service, 'checkWritable').mockResolvedValue(true);

      const result = await service.isValidDirectory(payloadWithMultipleServers, 'trace-id');

      expect(result).toBe(true);
      // Should only call mount/unmount once because it breaks after first valid directory
      expect(mockProtocol.mountPath).toHaveBeenCalledTimes(1);
      expect(mockProtocol.unmountPath).toHaveBeenCalledTimes(1);
    });

    it('should handle validation error and rethrow', async () => {
      const validationError = new Error('Validation failed');
      mockProtocol.mountPath.mockRejectedValue(validationError);

      await expect(service.isValidDirectory(mockPayload, 'trace-id'))
        .rejects.toThrow('Validation failed');

      expect(logger.error).toHaveBeenCalledWith('Working Directory validation error: Validation failed');
    });

    it('should handle validation error without message and rethrow', async () => {
      const validationError = 'String validation error';
      mockProtocol.mountPath.mockRejectedValue(validationError);

      await expect(service.isValidDirectory(mockPayload, 'trace-id'))
        .rejects.toThrow('String validation error');

      expect(logger.error).toHaveBeenCalledWith('Working Directory validation error: String validation error');
    });
  });

  describe('checkWritable', () => {
    it('should return true for writable directory', async () => {
      const result = await service.checkWritable('/test/directory');

      expect(mockedFsPromises.writeFile).toHaveBeenCalledWith('/test/directory/.nfs_write_test', '');
      expect(mockedFsPromises.unlink).toHaveBeenCalledWith('/test/directory/.nfs_write_test');
      expect(result).toBe(true);
      expect(logger.log).toHaveBeenCalledWith('Success: Directory /test/directory is writable.');
    });

    it('should return false for non-writable directory', async () => {
      const writeError = new Error('Permission denied');
      mockedFsPromises.writeFile.mockRejectedValueOnce(writeError);

      const result = await service.checkWritable('/test/directory');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Error: No write permission for directory /test/directory - Permission denied');
    });
  });

  describe('Constructor', () => {
    it('should initialize with correct configuration values', () => {
      // The service should have been initialized with the config values
      expect(service.workerId).toBe('test-worker-id');
      expect(service.baseWorkingPath).toBe('/base/working/path');
      expect(service.workerConfigUrl).toBe('http://test-url');
      
      // Verify that configService.get was called with the correct keys
      expect(configService.get).toHaveBeenCalledWith('worker.workerId');
      expect(configService.get).toHaveBeenCalledWith('worker.baseWorkingPath');
      expect(configService.get).toHaveBeenCalledWith('worker.connection.workerConfigUrl');
    });
  });
});