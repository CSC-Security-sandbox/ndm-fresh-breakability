import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import { AuthService } from 'src/auth/auth.service';

import { ConfigError, ConfigStatus } from './working-directory.type';
import { ValidateWorkingDirectoryActivity } from './working-directory.service';
import { Protocols } from 'src/protocols/protocols';

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

    it('should log and skip MANUAL_UPLOAD entries in handleMountAndUnmountPaths', async () => {
      const traceId = 'trace-manual';
      const payload = {
      listPathPayload: [
        { exportPathSource: 'MANUAL_UPLOAD', host: 'host1' },
        { exportPathSource: 'OTHER', host: 'host2', type: 'NFS', username: 'u', password: 'p', protocolVersion: 'v' }
      ],
      fetchedPath: '/fetched'
      };
      const mockProtocol = {
      mountPath: jest.fn().mockResolvedValue(undefined),
      unmountPath: jest.fn().mockResolvedValue(undefined),
      };
      // Mock the protocol lookup
      jest.spyOn(Protocols, 'getProtocol').mockReturnValue(mockProtocol as any);

      await (activity as any).handleMountAndUnmountPaths(traceId, payload);

      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Skipping mounting and unmounting for MANUAL_UPLOAD type for host host1'));
      expect(mockProtocol.mountPath).toHaveBeenCalledWith(traceId, expect.objectContaining({ hostname: 'host2' }));
      expect(mockProtocol.unmountPath).toHaveBeenCalledWith(traceId, expect.objectContaining({ hostname: 'host2' }));
    });

    it('should throw and log error in handleMountAndUnmountPaths if protocol throws', async () => {
      const traceId = 'trace-err';
      const payload = {
      listPathPayload: [
        { exportPathSource: 'OTHER', host: 'host2', type: 'NFS', username: 'u', password: 'p', protocolVersion: 'v' }
      ],
      fetchedPath: '/fetched'
      };
      const mockProtocol = {
      mountPath: jest.fn().mockRejectedValue(new Error('mount fail')),
      unmountPath: jest.fn(),
      };
      jest.spyOn(Protocols, 'getProtocol').mockReturnValue(mockProtocol as any);


      await expect((activity as any).handleMountAndUnmountPaths(traceId, payload)).rejects.toThrow('mount fail');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error while mounting the path - mount fail'));
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
      const error = { message: 'some other error' };
      expect((activity as any).getNfsMountErrorMessage(error)).toBe('some other error');
      });
    });

    describe('isValidDirectory', () => {
      const traceId = 'trace-valid';
      const payload = {
      listPathPayload: [
        { host: 'host1', type: 'NFS', username: 'u', password: 'p', protocolVersion: 'v' }
      ],
      exportPath: '/export',
      workingDirectory: 'workdir'
      };
      let mockProtocol: any;
      let Protocols: any;

      beforeEach(() => {
      mockProtocol = {
        mountPath: jest.fn().mockResolvedValue(undefined),
        unmountPath: jest.fn().mockResolvedValue(undefined),
      };
      Protocols = require('src/protocols/protocols');
      Protocols.Protocols.getProtocol.mockReturnValue(mockProtocol);
      });

      it('returns true if directory exists and writable', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(activity, 'checkWritable').mockReturnValue(true);

      const result = await (activity as any).isValidDirectory(payload, traceId);
      expect(result).toBe(true);
      expect(mockProtocol.mountPath).toHaveBeenCalled();
      expect(mockProtocol.unmountPath).toHaveBeenCalled();
      });

      it('returns false if directory does not exist', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = await (activity as any).isValidDirectory(payload, traceId);
      expect(result).toBe(false);
      });

      it('throws if directory exists but not writable', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(activity, 'checkWritable').mockReturnValue(false);

      await expect((activity as any).isValidDirectory(payload, traceId)).rejects.toThrow(
        /has no writable permission/
      );
      });

      it('logs and throws if protocol throws', async () => {
      mockProtocol.mountPath.mockRejectedValueOnce(new Error('mount error'));
      await expect((activity as any).isValidDirectory(payload, traceId)).rejects.toThrow('mount error');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Working Directory validation error:'));
      });
    });
  });
});
