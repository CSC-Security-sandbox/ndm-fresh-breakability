import { Test, TestingModule } from '@nestjs/testing';
import { ValidateWorkingDirectoryActivity } from './working-directory.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';
import { WorkersConfig } from 'src/config/app.config';
import axios from 'axios';
import { of, throwError } from 'rxjs';
import * as fs from 'fs';

jest.mock('src/protocols/protocols', () => ({
  Protocols: {
    getProtocol: jest.fn().mockImplementation((protocolType: ProtocolTypes) => ({
      mountPath: jest.fn().mockResolvedValue(undefined),
      unmountPath: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock('src/config/app.config', () => ({
  WorkersConfig: {
    get: jest.fn((key: string) => {
      if (key === 'workerConfigUrl') {
        return 'http://localhost'; // Provide a valid URL for testing
      }
      return null;
    }),
  },
}));

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ValidateWorkingDirectoryActivity', () => {
  let service: ValidateWorkingDirectoryActivity;
  let mockConfigService: Partial<ConfigService>;
  let mockLogger: Partial<Logger>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker-id';
          case 'baseWorkingPath':
            return '/base/mount/dir';
          default:
            return null;
        }
      }),
    };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateWorkingDirectoryActivity,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ValidateWorkingDirectoryActivity>(ValidateWorkingDirectoryActivity);
  });

  describe('validateWorkingDirectory', () => {
    it('should return success message for valid export path and working directory', async () => {
      const payload = {
        configId: 'config-1',
        exportPathPresent: true,
        workingDirectory: 'valid-directory',
        listPathPayload: [
          {
            type: 'NFS',
            host: 'nfs-server',
            username: 'user',
            password: 'pass',
            protocolVersion: '4',
          },
        ],
      };

      const mockMountPath = jest.fn().mockResolvedValue(undefined);
      const mockUnmountPath = jest.fn().mockResolvedValue(undefined);
      (Protocols.getProtocol as jest.Mock).mockReturnValue({
        mountPath: mockMountPath,
        unmountPath: mockUnmountPath,
      });

      mockedAxios.post.mockResolvedValue({ data: {} });

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(service, 'checkWritable').mockReturnValue(true);

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('success');
      expect(mockLogger.log).toHaveBeenCalledWith('Valid Export Path');
      expect(mockLogger.log).toHaveBeenCalledWith('Started validating working directory');
      expect(mockLogger.log).toHaveBeenCalledWith('Mounted export path successfully');
      expect(mockLogger.log).toHaveBeenCalledWith('Working Directory exists: /base/mount/dir/trace-id/valid-directory');
      expect(mockLogger.log).toHaveBeenCalledWith('Unmounted export path successfully');
    });

    it('should return error message for invalid export path', async () => {
      const payload = {
        configId: 'config-1',
        exportPathPresent: false,
        workingDirectory: 'valid-directory',
        listPathPayload: [],
      };

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Validation failed: Invalid export path');
      expect(mockLogger.log).toHaveBeenCalledWith('Invalid Export Path');
    });

    it('should return error message for invalid working directory', async () => {
      const payload = {
        configId: 'config-1',
        exportPathPresent: true,
        workingDirectory: 'invalid-directory',
        listPathPayload: [
          {
            type: 'NFS',
            host: 'nfs-server',
            username: 'user',
            password: 'pass',
            protocolVersion: '4',
          },
        ],
      };

      const mockMountPath = jest.fn().mockResolvedValue(undefined);
      const mockUnmountPath = jest.fn().mockResolvedValue(undefined);
      (Protocols.getProtocol as jest.Mock).mockReturnValue({
        mountPath: mockMountPath,
        unmountPath: mockUnmountPath,
      });

      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Validation failed: INVALID_WORKING_DIRECTORY');
      expect(mockLogger.log).toHaveBeenCalledWith('Working Directory does not exist: /base/mount/dir/trace-id/invalid-directory');
    });

    it('should handle errors during validation', async () => {
      const payload = {
        configId: 'config-1',
        exportPathPresent: true,
        workingDirectory: 'valid-directory',
        listPathPayload: [
          {
            type: 'NFS',
            host: 'nfs-server',
            username: 'user',
            password: 'pass',
            protocolVersion: '4',
          },
        ],
      };

      const mockMountPath = jest.fn().mockRejectedValue(new Error('RPC prog. not avail'));
      const mockUnmountPath = jest.fn().mockResolvedValue(undefined);
      (Protocols.getProtocol as jest.Mock).mockReturnValue({
        mountPath: mockMountPath,
        unmountPath: mockUnmountPath,
      });

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Validation failed: The server does not support to provided NFS version. Please use a valid version.');
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Working Directory validation error: RPC prog. not avail'));
    });
  });

  describe('isValidDirectory', () => {
    it('should return true for a valid directory with write permission', async () => {
      const payload = {
        exportPath: 'valid-path',
        listPathPayload: [
          {
            type: 'NFS',
            host: 'nfs-server',
            username: 'user',
            password: 'pass',
            protocolVersion: '4',
          },
        ],
      };

      const mockMountPath = jest.fn().mockResolvedValue(undefined);
      const mockUnmountPath = jest.fn().mockResolvedValue(undefined);
      (Protocols.getProtocol as jest.Mock).mockReturnValue({
        mountPath: mockMountPath,
        unmountPath: mockUnmountPath,
      });

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(service, 'checkWritable').mockReturnValue(true);

      const result = await service.isValidDirectory(payload, 'trace-id');

      expect(result).toBe(true);
      expect(mockLogger.log).toHaveBeenCalledWith('Mounted export path successfully');
      expect(mockLogger.log).toHaveBeenCalledWith('Working Directory exists: /base/mount/dir/trace-id/valid-path');
    });

    it('should return false for a valid directory without write permission', async () => {
      const payload = {
        exportPath: 'valid-path',
        listPathPayload: [
          {
            type: 'NFS',
            host: 'nfs-server',
            username: 'user',
            password: 'pass',
            protocolVersion: '4',
          },
        ],
      };

      const mockMountPath = jest.fn().mockResolvedValue(undefined);
      const mockUnmountPath = jest.fn().mockResolvedValue(undefined);
      (Protocols.getProtocol as jest.Mock).mockReturnValue({
        mountPath: mockMountPath,
        unmountPath: mockUnmountPath,
      });

      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(service, 'checkWritable').mockReturnValue(false);

      const result = await service.isValidDirectory(payload, 'trace-id');

      expect(result).toBe(false);
      expect(mockLogger.log).toHaveBeenCalledWith('Working Directory does not exist: /base/mount/dir/trace-id/valid-path');
    });

    it('should throw an error if the directory validation fails', async () => {
      const payload = {
        exportPath: 'valid-path',
        listPathPayload: [
          {
            type: 'NFS',
            host: 'nfs-server',
            username: 'user',
            password: 'pass',
            protocolVersion: '4',
          },
        ],
      };

      const mockMountPath = jest.fn().mockResolvedValue(undefined);
      const mockUnmountPath = jest.fn().mockResolvedValue(undefined);
      (Protocols.getProtocol as jest.Mock).mockReturnValue({
        mountPath: mockMountPath,
        unmountPath: mockUnmountPath,
      });

      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      await expect(service.isValidDirectory(payload, 'trace-id')).rejects.toThrow('Working Directory validation error: Working Directory does not exist: /base/mount/dir/trace-id/valid-path');
    });
  });

  describe('checkWritable', () => {
    it('should return true if the directory is writable', () => {
      const directoryPath = '/valid/path';
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const result = service.checkWritable(directoryPath);

      expect(result).toBe(true);
      expect(mockLogger.log).toHaveBeenCalledWith(`Success: Directory ${directoryPath} is writable.`);
    });

    it('should return false if the directory is not writable', () => {
      const directoryPath = '/invalid/path';
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('No write permission');
      });

      const result = service.checkWritable(directoryPath);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(`Error: No write permission for directory ${directoryPath} - No write permission`);
    });
  });
});
