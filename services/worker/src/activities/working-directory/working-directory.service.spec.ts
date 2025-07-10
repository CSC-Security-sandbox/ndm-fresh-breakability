import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import { AuthService } from 'src/auth/auth.service';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { ConfigError, ConfigStatus } from './working-directory.type';
import { ValidateWorkingDirectoryActivity } from './working-directory.service';
const getProtocol = require('src/protocols/protocols').Protocols.getProtocol;


// Mock Temporal dependencies to avoid native binary issues
jest.mock('@temporalio/core-bridge', () => ({}));
jest.mock('@temporalio/worker', () => ({}));
jest.mock('@temporalio/activity', () => ({}));

// Mock other dependencies
jest.mock('axios');
jest.mock('fs');
jest.mock('src/protocols/protocols');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('ValidateWorkingDirectoryActivity', () => {
  let service: ValidateWorkingDirectoryActivity;
  let configService: jest.Mocked<ConfigService>;
  let logger: jest.Mocked<Logger>;
  let authService: jest.Mocked<AuthService>;
  let mockProtocol: any;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock protocol
    mockProtocol = {
      mountPath: jest.fn(),
      unmountPath: jest.fn(),
    };

    // Mock Protocols.getProtocol
    jest.mocked(Protocols.getProtocol).mockReturnValue(mockProtocol);

    // Create mock config service with immediate return values
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateWorkingDirectoryActivity,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            getAccessToken: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ValidateWorkingDirectoryActivity>(ValidateWorkingDirectoryActivity);
    configService = module.get(ConfigService);
    logger = module.get(Logger);
    authService = module.get(AuthService);
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

      expect(mockProtocol.mountPath).toHaveBeenCalled();
      expect(mockProtocol.unmountPath).toHaveBeenCalled();
      expect(result.status).toBe('success');
      expect(result.message).toContain('validated successfully');
    });

    it('should handle mount error when exportPathWorkingDirectoryProvided is false', async () => {
      const payload = { ...mockPayload, exportPathWorkingDirectoryProvided: false };
      const mountError = new Error('Mount failed');
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });
      mockProtocol.mountPath.mockRejectedValue(mountError);

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Validation failed');
    });

    it('should handle invalid export path when exportPathPresent is false', async () => {
      const payload = { ...mockPayload, exportPathWorkingDirectoryProvided: true, exportPathPresent: false };
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(logger.log).toHaveBeenCalledWith('Invalid Export Path');
      expect(result.status).toBe('error');
      expect(result.message).toContain(ConfigError.INVALID_EXPORT_PATH);
    });

    it('should handle valid directory validation successfully', async () => {
      const payload = { ...mockPayload, exportPathWorkingDirectoryProvided: true };
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });
      
      // Mock isValidDirectory to return true
      jest.spyOn(service, 'isValidDirectory').mockResolvedValue(true);

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(logger.log).toHaveBeenCalledWith('Valid Export Path');
      expect(logger.log).toHaveBeenCalledWith('Started validating working directory');
      expect(result.status).toBe('success');
    });

    it('should handle invalid directory validation', async () => {
      const payload = { ...mockPayload, exportPathWorkingDirectoryProvided: true };
      authService.getAccessToken.mockResolvedValue('test-token');
      mockedAxios.post.mockResolvedValue({ data: {} });
      
      // Mock isValidDirectory to return false
      jest.spyOn(service, 'isValidDirectory').mockResolvedValue(false);

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
      expect(result.message).toContain(ConfigError.INVALID_WORKING_DIRECTORY);
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
      expect(logger.error).toHaveBeenCalledWith('Working directory validation error: Validation error');
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

    it('should return original error message for other errors', () => {
      const error = { message: 'Some other error' };
      const result = service['getNfsMountErrorMessage'](error);
      expect(result).toBe('Some other error');
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
      });
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

    it('should call axios.post with correct headers and payload', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ status: 200 });
      const apiUrl = 'http://some.url';
      const payload = { configId: 'cfg', status: ConfigStatus.ACTIVE };

      await activity.updateConfigStatus(apiUrl, payload as any);

      expect(axios.post).toHaveBeenCalledWith(
      apiUrl,
      payload,
      expect.objectContaining({
        headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dummyToken}`,
        }),
      }),
      );
    });

    describe('getNfsMountErrorMessage', () => {
      it('returns PROTOCOL_NOT_SUPPORTED for illegal NFS version', () => {
      const error = { message: 'illegal NFS version value: 4' };
      // @ts-ignore
      expect(activity.getNfsMountErrorMessage(error)).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
      });

      it('returns PROTOCOL_NOT_SUPPORTED for RPC prog. not avail', () => {
      const error = { message: 'RPC prog. not avail' };
      // @ts-ignore
      expect(activity.getNfsMountErrorMessage(error)).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
      });

      it('returns PROTOCOL_NOT_SUPPORTED for Protocol not supported for', () => {
      const error = { message: 'Protocol not supported for NFS' };
      // @ts-ignore
      expect(activity.getNfsMountErrorMessage(error)).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
      });

      it('returns original message for other errors', () => {
      const error = { message: 'Some other error' };
      // @ts-ignore
      expect(activity.getNfsMountErrorMessage(error)).toBe('Some other error');
      });
    });

    describe('handleMountAndUnmountPaths', () => {
      it('should call mountPath and unmountPath for each fileServer', async () => {
      const traceId = 'trace-7';
      const payload: any = {
        listPathPayload: [
        { type: 'NFS', host: 'host1', username: 'u', password: 'p', protocolVersion: '4' },
        { type: 'NFS', host: 'host2', username: 'u2', password: 'p2', protocolVersion: '3' },
        ],
        fetchedPath: '/mnt/path'
      };
      const mountPathMock = jest.fn().mockResolvedValue(undefined);
      const unmountPathMock = jest.fn().mockResolvedValue(undefined);
      const protocolMock = { mountPath: mountPathMock, unmountPath: unmountPathMock };
      getProtocol.mockReturnValue(protocolMock);

      await (activity as any).handleMountAndUnmountPaths(traceId, payload);

      expect(mountPathMock).toHaveBeenCalledTimes(2);
      expect(unmountPathMock).toHaveBeenCalledTimes(2);
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Mounting export path for host host1'));
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Unmounting export path for host host2'));
      });

      it('should throw and log error if mountPath fails', async () => {
      const traceId = 'trace-8';
      const payload: any = {
        listPathPayload: [
        { type: 'NFS', host: 'host1', username: 'u', password: 'p', protocolVersion: '4' },
        ],
        fetchedPath: '/mnt/path'
      };
      const mountPathMock = jest.fn().mockRejectedValue(new Error('mount error'));
      const unmountPathMock = jest.fn();
      const protocolMock = { mountPath: mountPathMock, unmountPath: unmountPathMock };
      getProtocol.mockReturnValue(protocolMock);

      await expect((activity as any).handleMountAndUnmountPaths(traceId, payload)).rejects.toThrow('mount error');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error while mounting the path - mount error'));
      });
    });

    describe('isValidDirectory', () => {
      const traceId = 'trace-9';
      const payload: any = {
      listPathPayload: [
        { type: 'NFS', host: 'host1', username: 'u', password: 'p', protocolVersion: '4' },
      ],
      exportPath: '/export',
      workingDirectory: 'workdir'
      };
      let protocolMock: any;
      let getProtocol: any;

      beforeEach(() => {
      protocolMock = {
        mountPath: jest.fn().mockResolvedValue(undefined),
        unmountPath: jest.fn().mockResolvedValue(undefined),
      };
      getProtocol = require('src/protocols/protocols').Protocols.getProtocol;
      getProtocol.mockReturnValue(protocolMock);
      });

      it('returns true if directory exists and writable', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(activity, 'checkWritable').mockReturnValue(true);

      const result = await activity.isValidDirectory(payload, traceId);

      expect(protocolMock.mountPath).toHaveBeenCalled();
      expect(protocolMock.unmountPath).toHaveBeenCalled();
      expect(result).toBe(true);
      });

      it('returns false if directory does not exist', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = await activity.isValidDirectory(payload, traceId);

      expect(result).toBe(false);
      });

      it('throws if directory exists but not writable', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(activity, 'checkWritable').mockReturnValue(false);

      await expect(activity.isValidDirectory(payload, traceId)).rejects.toThrow(
        /has no writable permission/
      );
      });

      it('throws and logs if mountPath throws', async () => {
      protocolMock.mountPath.mockRejectedValue(new Error('mount fail'));
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      await expect(activity.isValidDirectory(payload, traceId)).rejects.toThrow('mount fail');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Working Directory validation error:'));
      });
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
      jest.spyOn(service, 'checkWritable').mockReturnValue(true);

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
      jest.spyOn(service, 'checkWritable').mockReturnValue(false);

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
      jest.spyOn(service, 'checkWritable').mockReturnValue(true);

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
    it('should return true for writable directory', () => {
      // Mock writeFileSync and unlinkSync to succeed
      const mockWriteFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const mockUnlinkSync = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const result = service.checkWritable('/test/directory');

      expect(mockWriteFileSync).toHaveBeenCalledWith('/test/directory/.nfs_write_test', '');
      expect(mockUnlinkSync).toHaveBeenCalledWith('/test/directory/.nfs_write_test');
      expect(result).toBe(true);
      expect(logger.log).toHaveBeenCalledWith('Success: Directory /test/directory is writable.');
      
      // Restore mocks
      mockWriteFileSync.mockRestore();
      mockUnlinkSync.mockRestore();
    });

    it('should return false for non-writable directory', () => {
      const writeError = new Error('Permission denied');
      
      // Mock writeFileSync to throw error
      const mockWriteFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw writeError;
      });

      const result = service.checkWritable('/test/directory');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Error: No write permission for directory /test/directory - Permission denied');
      
      // Restore mock
      mockWriteFileSync.mockRestore();
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