import { Test, TestingModule } from '@nestjs/testing';
import { ValidateWorkingDirectoryActivity } from './working-directory.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ProtocolTypes, Protocols } from 'src/protocols/protocols';
import { WorkersConfig } from 'src/config/app.config';
import axios from 'axios';
import { of, throwError } from 'rxjs';
import * as fs from 'fs';
import { HttpService } from '@nestjs/axios';

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
        return 'http://localhost';
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
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), update: jest.fn(), patch: jest.fn(), put: jest.fn() } },
        { provide: WorkersConfig, useValue: { get: jest.fn((key) => (key === 'workerConfigUrl' ? 'http://localhost' : null)) } },
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
      jest.spyOn(service, 'updateConfigStatus').mockResolvedValue();

      const result = await service.validateWorkingDirectory('trace-id', payload);
      expect(result.status).toBe('error');
    });

    it('should return error message for invalid export path', async () => {
      const payload = {
        configId: 'config-1',
        exportPathPresent: false,
        workingDirectory: 'valid-directory',
        listPathPayload: [],
      };
      jest.spyOn(service, 'updateConfigStatus').mockResolvedValue();
      
      const result = await service.validateWorkingDirectory('trace-id', payload);
      expect(result.status).toBe('error');
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
      jest.spyOn(service, 'updateConfigStatus').mockResolvedValue();

      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
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
      jest.spyOn(service, 'updateConfigStatus').mockResolvedValue();
      const result = await service.validateWorkingDirectory('trace-id', payload);

      expect(result.status).toBe('error');
    });
  });

  describe('isValidDirectory', () => {
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
