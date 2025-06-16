import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import { AuthService } from 'src/auth/auth.service';

import { ConfigError, ConfigStatus } from './working-directory.type';
import { ValidateWorkingDirectoryActivity } from './working-directory.service';
const getProtocol = require('src/protocols/protocols').Protocols.getProtocol;

jest.mock('axios');
jest.mock('src/protocols/protocols');

describe('ValidateWorkingDirectoryActivity', () => {
  let configService: Partial<ConfigService>;
  let logger: Partial<Logger>;
  let authService: Partial<AuthService>;
  let activity: ValidateWorkingDirectoryActivity;

  const dummyToken = 'token123';

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'worker.workerId':
            return 'worker-1';
          case 'worker.baseWorkingPath':
            return '/base/path';
          case 'worker.connection.workerConfigUrl':
            return 'http://config.url';
          default:
            return null;
        }
      }),
    };
    logger = {
      log: jest.fn(),
      error: jest.fn(),
    };
    authService = {
      getAccessToken: jest.fn().mockResolvedValue(dummyToken),
    };
    activity = new ValidateWorkingDirectoryActivity(
      configService as ConfigService,
      logger as Logger,
      authService as AuthService,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should succeed when handleMountAndUnmountPaths resolves', async () => {
    // Arrange
    const traceId = 'trace-1';
    const payload: any = { configId: 'cfg-1', exportPathWorkingDirectoryProvided: false, listPathPayload: [] };
    jest.spyOn(activity as any, 'handleMountAndUnmountPaths').mockResolvedValue(undefined);
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    // Act
    const result = await activity.validateWorkingDirectory(traceId, payload);

    // Assert
    expect((activity as any).handleMountAndUnmountPaths).toHaveBeenCalledWith(traceId, payload);
    expect(axios.post).toHaveBeenCalledWith(
      'http://config.url/api/v1/work-manager/validate/working-directory',
      expect.objectContaining({ status: ConfigStatus.ACTIVE, configId: payload.configId }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${dummyToken}` })}),
    );
    expect(result.status).toBe('success');
    expect(result.workerId).toBe('worker-1');
    expect(result.message).toContain('validated successfully');
  });

  it('should error when handleMountAndUnmountPaths rejects with NFS protocol error', async () => {
    // Arrange
    const traceId = 'trace-2';
    const payload: any = { configId: 'cfg-2', exportPathWorkingDirectoryProvided: false, listPathPayload: [] };
    const err = new Error('illegal NFS version value: xyz');
    jest.spyOn(activity as any, 'handleMountAndUnmountPaths').mockRejectedValue(err);
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    // Act
    const result = await activity.validateWorkingDirectory(traceId, payload);

    // Assert
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error while mounting:'),);
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: ConfigStatus.ERRORED, errorMessage: ConfigError.PROTOCOL_NOT_SUPPORTED }),
      expect.any(Object),
    );
    expect(result.status).toBe('error');
    expect(result.message).toContain(ConfigError.PROTOCOL_NOT_SUPPORTED);
  });

  it('should error when exportPathWorkingDirectoryProvided true and exportPathPresent false', async () => {
    // Arrange
    const traceId = 'trace-3';
    const payload: any = { configId: 'cfg-3', exportPathWorkingDirectoryProvided: true, exportPathPresent: false };
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    // Act
    const result = await activity.validateWorkingDirectory(traceId, payload);

    // Assert
    expect(logger.log).toHaveBeenCalledWith('Invalid Export Path');
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: ConfigStatus.ERRORED, errorMessage: ConfigError.INVALID_EXPORT_PATH }),
      expect.any(Object),
    );
    expect(result.status).toBe('error');
    expect(result.message).toContain(ConfigError.INVALID_EXPORT_PATH);
  });

  it('should validate directory successfully when isValidDirectory returns true', async () => {
    // Arrange
    const traceId = 'trace-4';
    const payload: any = {
      configId: 'cfg-4',
      exportPathWorkingDirectoryProvided: true,
      exportPathPresent: true,
      listPathPayload: [],
      exportPath: '/export',
      workingDirectory: 'workdir',
    };
    jest.spyOn(activity as any, 'isValidDirectory').mockResolvedValue(true);
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    // Act
    const result = await activity.validateWorkingDirectory(traceId, payload);

    // Assert
    expect(logger.log).toHaveBeenCalledWith('Valid Export Path');
    expect(logger.log).toHaveBeenCalledWith('Started validating working directory');
    expect((activity as any).isValidDirectory).toHaveBeenCalledWith(payload, traceId);
    expect(result.status).toBe('success');
    expect(result.message).toContain('validated successfully');
  });

  it('should error when isValidDirectory returns false', async () => {
    // Arrange
    const traceId = 'trace-5';
    const payload: any = {
      configId: 'cfg-5',
      exportPathWorkingDirectoryProvided: true,
      exportPathPresent: true,
      listPathPayload: [],
      exportPath: '/export',
      workingDirectory: 'workdir',
    };
    jest.spyOn(activity as any, 'isValidDirectory').mockResolvedValue(false);
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    // Act
    const result = await activity.validateWorkingDirectory(traceId, payload);

    // Assert
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: ConfigStatus.ERRORED, errorMessage: ConfigError.INVALID_WORKING_DIRECTORY }),
      expect.any(Object),
    );
    expect(result.status).toBe('error');
    expect(result.message).toContain(ConfigError.INVALID_WORKING_DIRECTORY);
  });

  it('should error when isValidDirectory throws an error', async () => {
    // Arrange
    const traceId = 'trace-6';
    const payload: any = {
      configId: 'cfg-6',
      exportPathWorkingDirectoryProvided: true,
      exportPathPresent: true,
      listPathPayload: [],
      exportPath: '/export',
      workingDirectory: 'workdir',
    };
    const err = new Error('RPC prog. not avail error');
    jest.spyOn(activity as any, 'isValidDirectory').mockRejectedValue(err);
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    // Act
    const result = await activity.validateWorkingDirectory(traceId, payload);

    // Assert
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Working directory validation error:'),);
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: ConfigStatus.ERRORED, errorMessage: ConfigError.PROTOCOL_NOT_SUPPORTED }),
      expect.any(Object),
    );
    expect(result.status).toBe('error');
    expect(result.message).toContain(ConfigError.PROTOCOL_NOT_SUPPORTED);
  });

  describe('checkWritable', () => {
    const dir = '/some/dir';

    it('returns true when write succeeds', () => {
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);

      const result = activity.checkWritable(dir);
      expect(result).toBe(true);
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('is writable'));
    });

    it('returns false when write fails', () => {
      const error = new Error('perm denied');
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw error; });

      const result = activity.checkWritable(dir);
      expect(result).toBe(false);
    });
  });

  describe('updateConfigStatus', () => {
    it('throws if axios.post fails', async () => {
      (axios.post as jest.Mock).mockRejectedValue({ response: { data: 'fail-data' } });
      const apiUrl = 'http://some.url';
      const payload = { configId: 'cfg', status: ConfigStatus.ACTIVE };

      await expect(activity.updateConfigStatus(apiUrl, payload as any)).rejects.toThrow('API Error: fail-data');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('API Error:'),);
    });

    it('calls axios.post with correct headers and payload', async () => {
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
    });

    describe('getNfsMountErrorMessage', () => {
    it('returns PROTOCOL_NOT_SUPPORTED for illegal NFS version', () => {
      const error = { message: 'illegal NFS version value: 4.2' };
      expect((activity as any).getNfsMountErrorMessage(error)).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
    });

    it('returns PROTOCOL_NOT_SUPPORTED for RPC prog. not avail', () => {
      const error = { message: 'RPC prog. not avail' };
      expect((activity as any).getNfsMountErrorMessage(error)).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
    });

    it('returns PROTOCOL_NOT_SUPPORTED for Protocol not supported for', () => {
      const error = { message: 'Protocol not supported for NFS' };
      expect((activity as any).getNfsMountErrorMessage(error)).toBe(ConfigError.PROTOCOL_NOT_SUPPORTED);
    });

    it('returns original message for other errors', () => {
      const error = { message: 'Some other error' };
      expect((activity as any).getNfsMountErrorMessage(error)).toBe('Some other error');
    });
    });

    describe('handleMountAndUnmountPaths', () => {
    it('mounts and unmounts for each fileServer', async () => {
      const traceId = 'trace-7';
      const protocolMock = {
      mountPath: jest.fn().mockResolvedValue(undefined),
      unmountPath: jest.fn().mockResolvedValue(undefined),
      };
      const fileServer = {
      type: 'NFS',
      host: 'host1',
      username: 'user',
      password: 'pass',
      protocolVersion: '4.1',
      };
      const payload = {
      listPathPayload: [fileServer],
      fetchedPath: '/mnt/path',
      };
      
      getProtocol.mockReturnValue(protocolMock);

      await (activity as any).handleMountAndUnmountPaths(traceId, payload);

      expect(protocolMock.mountPath).toHaveBeenCalledWith(traceId, expect.objectContaining({
      hostname: fileServer.host,
      path: payload.fetchedPath,
      }));
      expect(protocolMock.unmountPath).toHaveBeenCalledWith(traceId, expect.objectContaining({
      hostname: fileServer.host,
      path: payload.fetchedPath,
      }));
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Mounting export path for host'));
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Unmounting export path for host'));
    });

    it('throws and logs error if protocol fails', async () => {
      const traceId = 'trace-8';
      const protocolMock = {
      mountPath: jest.fn().mockRejectedValue(new Error('mount error')),
      unmountPath: jest.fn(),
      };
      const fileServer = {
      type: 'NFS',
      host: 'host2',
      username: 'user',
      password: 'pass',
      protocolVersion: '4.1',
      };
      const payload = {
      listPathPayload: [fileServer],
      fetchedPath: '/mnt/path',
      };
      getProtocol.mockReturnValue(protocolMock);

      await expect((activity as any).handleMountAndUnmountPaths(traceId, payload)).rejects.toThrow('mount error');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error while mounting the path - mount error'));
    });
    });

    describe('isValidDirectory', () => {
    const traceId = 'trace-9';
    const fileServer = {
      type: 'NFS',
      host: 'host3',
      username: 'user',
      password: 'pass',
      protocolVersion: '4.1',
    };
    const payload = {
      listPathPayload: [fileServer],
      exportPath: '/export',
      workingDirectory: 'workdir',
    };
    let protocolMock: any;
    let getProtocol: any;

    beforeEach(() => {
      protocolMock = {
      mountPath: jest.fn().mockResolvedValue(undefined),
      unmountPath: jest.fn().mockResolvedValue(undefined),
      };
      getProtocol.mockReturnValue(protocolMock);
    });

    it('returns true if directory exists and writable', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(activity, 'checkWritable').mockReturnValue(true);

      const result = await (activity as any).isValidDirectory(payload, traceId);

      expect(result).toBe(true);
      expect(protocolMock.mountPath).toHaveBeenCalled();
      expect(protocolMock.unmountPath).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Working Directory exists'));
    });

    it('returns false if directory does not exist', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = await (activity as any).isValidDirectory(payload, traceId);

      expect(result).toBe(false);
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Working Directory does not exist'));
    });

    it('throws if directory exists but not writable', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(activity, 'checkWritable').mockReturnValue(false);

      await expect((activity as any).isValidDirectory(payload, traceId)).rejects.toThrow(
      `Provided working directory ${payload.workingDirectory} has no writable permission`
      );
    });

    it('throws and logs error if protocol fails', async () => {
      protocolMock.mountPath.mockRejectedValue(new Error('mount error'));
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      await expect((activity as any).isValidDirectory(payload, traceId)).rejects.toThrow('mount error');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Working Directory validation error:'));
    });
    });
});
