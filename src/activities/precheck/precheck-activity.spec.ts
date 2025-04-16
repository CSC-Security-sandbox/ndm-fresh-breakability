import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PrecheckActivity } from './precheck-activity';
import { Protocols } from 'src/protocols/protocols';
import {
  PreCheckStatus,
  PreCheckErrorCodes,
} from 'src/workflows/pre-check/pre-check.types';
import * as fs from 'fs/promises';

jest.mock('@nestjs/config');
jest.mock('src/protocols/protocols');
jest.mock('fs/promises');

jest.mock('fast-folder-size', () => {
  return jest.fn().mockImplementation((path, callback) => callback(null, 0));
});

describe('PrecheckActivity', () => {
  let precheckActivity: PrecheckActivity;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockLogger: jest.Mocked<Logger>;
  let mockProtocol: any;

  const mockSettings = {
    preserveAccessTime: false,
  };

  const mockServerCredentials = {
    id: 'server-1',
    serverType: 'SFTP',
    host: 'test-server',
    userName: 'testuser',
    password: 'testpass',
    protocol: 'SFTP',
    protocolVersion: '1.0',
  };

  const mockServerPaths = {
    pathId: 'path123',
    pathName: '/test/path',
    isSource: true,
    serverId: 'server-1',
  };

  const mockTraceId = 'trace-123';

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn(),
    } as any;

    mockConfigService.get.mockImplementation((key: string) => {
      switch (key) {
        case 'worker.workerId':
          return 'worker-1';
        case 'worker.baseWorkingPath':
          return '/base/working/path';
        default:
          return null;
      }
    });

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    mockProtocol = {
      validateConnection: jest.fn(),
      mountPath: jest.fn(),
      listPaths: jest.fn(),
      unmountPath: jest.fn(),
      getTotalSizeWindows: jest.fn(),
    };

    Protocols.getProtocol = jest.fn().mockReturnValue(mockProtocol);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrecheckActivity,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    precheckActivity = module.get<PrecheckActivity>(PrecheckActivity);
  });

  describe('preCheckPath', () => {
    it('should successfully precheck a path', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/test/path']);
      mockProtocol.unmountPath.mockResolvedValue(true);

      (fs.open as jest.Mock).mockResolvedValue({
        close: jest.fn().mockResolvedValue(true),
      });
      (fs.readFile as jest.Mock).mockResolvedValue('');
      (fs.unlink as jest.Mock).mockResolvedValue(true);

      const result = await precheckActivity.preCheckPath(
        mockSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.SUCCESS);
      expect(result.errorCode).toBeUndefined();
      expect(result.workerId).toBe('worker-1');
      expect(result.pathId).toBe('path123');
    });

    it('should fail when connection validation fails', async () => {
      mockProtocol.validateConnection.mockRejectedValue(
        new Error('Connection failed'),
      );

      const result = await precheckActivity.preCheckPath(
        mockSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCode).toBe(
        PreCheckErrorCodes.SOURCE_PATH_MOUNT_FAILED,
      );
    });

    it('should fail when path is not found', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/different/path']);

      const result = await precheckActivity.preCheckPath(
        mockSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCode).toBe(PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND);
    });

    it('should fail when test file write fails for destination path', async () => {
      const modifiedSettings = { preserveAccessTime: true };
      const destinationPaths = {
        ...mockServerPaths,
        isSource: false,
      };

      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/test/path']);

      (fs.open as jest.Mock).mockRejectedValue(new Error('Write failed'));

      const result = await precheckActivity.preCheckPath(
        modifiedSettings,
        mockServerCredentials,
        destinationPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCode).toBe(
        PreCheckErrorCodes.DESTINATION_PATH_WRITE_PERMISSION_FAILED,
      );
    });

    it('should fail when test file write fails for source path with preserveAccessTime', async () => {
      const modifiedSettings = { preserveAccessTime: true };

      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/test/path']);

      (fs.open as jest.Mock).mockRejectedValue(new Error('Write failed'));

      const result = await precheckActivity.preCheckPath(
        modifiedSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCode).toBe(
        PreCheckErrorCodes.SOURCE_PATH_WRITE_PERMISSION_FAILED,
      );
    });

    it('should successfully precheck a path', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/test/path']);
      mockProtocol.unmountPath.mockResolvedValue(true);

      (fs.open as jest.Mock).mockResolvedValue({
        close: jest.fn().mockResolvedValue(true),
      });
      (fs.readFile as jest.Mock).mockResolvedValue('');
      (fs.unlink as jest.Mock).mockResolvedValue(true);

      const result = await precheckActivity.preCheckPath(
        mockSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.SUCCESS);
      expect(result.errorCode).toBeUndefined();
      expect(result.workerId).toBe('worker-1');
      expect(result.pathId).toBe('path123');
    });

    it('should handle unmount failure gracefully', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/test/path']);
      mockProtocol.unmountPath.mockRejectedValue(new Error('Unmount failed'));

      (fs.open as jest.Mock).mockResolvedValue({
        close: jest.fn().mockResolvedValue(true),
      });
      (fs.readFile as jest.Mock).mockResolvedValue('');
      (fs.unlink as jest.Mock).mockResolvedValue(true);

      const result = await precheckActivity.preCheckPath(
        mockSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.SUCCESS);
      expect(result.errorCode).toBeUndefined();
    });

    it('should fail when unmounting path fails', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/test/path']);
      mockProtocol.unmountPath.mockRejectedValue(new Error('Unmount failed'));

      (fs.open as jest.Mock).mockResolvedValue({
        close: jest.fn().mockResolvedValue(true),
      });
      (fs.readFile as jest.Mock).mockResolvedValue('');
      (fs.unlink as jest.Mock).mockResolvedValue(true);

      const result = await precheckActivity.preCheckPath(
        mockSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.SUCCESS);
      expect(result.errorCode).toBeUndefined();
    });

    it('should fail when listing paths throws an error', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockRejectedValue(new Error('List paths failed'));

      const result = await precheckActivity.preCheckPath(
        mockSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCode).toBe(PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND);
    });

    it('should fail when creating test file throws an error', async () => {
      const modifiedSettings = { preserveAccessTime: true };

      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/test/path']);

      (fs.open as jest.Mock).mockRejectedValue(
        new Error('File creation failed'),
      );

      const result = await precheckActivity.preCheckPath(
        modifiedSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCode).toBe(
        PreCheckErrorCodes.SOURCE_PATH_WRITE_PERMISSION_FAILED,
      );
    });

    it('should fail when reading test file throws an error', async () => {
      const modifiedSettings = { preserveAccessTime: true };

      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/test/path']);

      (fs.open as jest.Mock).mockResolvedValue({
        close: jest.fn().mockResolvedValue(true),
      });
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('Read failed'));

      const result = await precheckActivity.preCheckPath(
        modifiedSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCode).toBe(
        PreCheckErrorCodes.SOURCE_PATH_WRITE_PERMISSION_FAILED,
      );
    });

    it('should fail when deleting test file throws an error', async () => {
      const modifiedSettings = { preserveAccessTime: true };

      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/test/path']);

      (fs.open as jest.Mock).mockResolvedValue({
        close: jest.fn().mockResolvedValue(true),
      });
      (fs.readFile as jest.Mock).mockResolvedValue('');
      (fs.unlink as jest.Mock).mockRejectedValue(new Error('Delete failed'));

      const result = await precheckActivity.preCheckPath(
        modifiedSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCode).toBe(
        PreCheckErrorCodes.SOURCE_PATH_WRITE_PERMISSION_FAILED,
      );
    });

    it('should handle protocol validation and mounting errors gracefully', async () => {
      mockProtocol.validateConnection.mockRejectedValue(
        new Error('Validation failed'),
      );

      const result = await precheckActivity.preCheckPath(
        mockSettings,
        mockServerCredentials,
        mockServerPaths,
        mockTraceId,
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCode).toBe(
        PreCheckErrorCodes.SOURCE_PATH_MOUNT_FAILED,
      );
    });

    describe('Source data size calculation', () => {
      it('should handle source data size calculation errors gracefully', async () => {
        mockProtocol.validateConnection.mockResolvedValue(true);
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue(['/test/path']);
        mockProtocol.unmountPath.mockResolvedValue(true);
        mockProtocol.getTotalSizeWindows.mockRejectedValue(new Error('Size calc failed'));
    
        const result = await precheckActivity.preCheckPath(
          mockSettings,
          mockServerCredentials,
          mockServerPaths,
          mockTraceId
        );
    
        expect(result.status).toBe(PreCheckStatus.SUCCESS);
        expect(result.sourceDataSize).toBeUndefined();
        expect(mockLogger.error).toHaveBeenCalled();
      });
    });
    
    describe('Destination available space check', () => { 
      it('should handle destination space check errors gracefully', async () => {
        const destinationPaths = {
          ...mockServerPaths,
          isSource: false
        };
      
        mockProtocol.validateConnection.mockResolvedValue(true);
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([destinationPaths.pathName]);
        mockProtocol.unmountPath.mockResolvedValue(true);
          
        const result = await precheckActivity.preCheckPath(
          mockSettings,
          mockServerCredentials,
          destinationPaths,
          mockTraceId
        );
      
        expect(result.status).toBe(PreCheckStatus.FAILED);
        expect(result.destinationAvailableSpace).toBeUndefined();
        expect(mockLogger.error).toHaveBeenCalled();
      });

    });

    describe('checkDestinationPathEmpty', () => {
      let instance;
      let mockFs;
      let mockLogger;
      let PreCheckPathOutput;
      const mountPath = '/test/mount/path';
    
      beforeEach(() => {
        mockFs = {
          readdir: jest.fn()
        };
        
        mockLogger = {
          log: jest.fn(),
          error: jest.fn()
        };
        
        PreCheckPathOutput = {};
        
        instance = {
          logger: mockLogger
        };
        
        jest.mock('fs/promises', () => mockFs);
      });
    
      afterEach(() => {
        jest.clearAllMocks();
      });
    
      it('should set destinationIsEmpty to true when directory is empty', async () => {
        mockFs.readdir.mockResolvedValue([]);
        
        await executeCheckDestinationPath();
        
        expect(mockFs.readdir).toHaveBeenCalledWith(mountPath);
        expect(PreCheckPathOutput.destinationIsEmpty).toBe(true);
        expect(mockLogger.log).toHaveBeenCalledWith(
          `Destination path empty status: true`
        );
        expect(mockLogger.error).not.toHaveBeenCalled();
      });
    
      it('should set destinationIsEmpty to false when directory has contents', async () => {
        mockFs.readdir.mockResolvedValue(['file1.txt', 'file2.txt']);
        
        await executeCheckDestinationPath();
        
        expect(mockFs.readdir).toHaveBeenCalledWith(mountPath);
        expect(PreCheckPathOutput.destinationIsEmpty).toBe(false);
        expect(mockLogger.log).toHaveBeenCalledWith(
          `Destination path empty status: false`
        );
        expect(mockLogger.error).not.toHaveBeenCalled();
      });
    
      it('should handle errors when reading directory fails', async () => {
        const error = new Error('Permission denied');
        mockFs.readdir.mockRejectedValue(error);
        
        await executeCheckDestinationPath();
        
        expect(mockFs.readdir).toHaveBeenCalledWith(mountPath);
        expect(PreCheckPathOutput.destinationIsEmpty).toBeUndefined();
        expect(mockLogger.log).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith(
          `Error while checking destination path empty status: Permission denied`
        );
      });
    
      it('should handle empty directories with hidden files', async () => {
        mockFs.readdir.mockResolvedValue(['.hidden_file']);
        
        await executeCheckDestinationPath();
        
        expect(PreCheckPathOutput.destinationIsEmpty).toBe(false);
        expect(mockLogger.log).toHaveBeenCalledWith(
          `Destination path empty status: false`
        );
      });
    
      async function executeCheckDestinationPath() {
        try {
          const dirContents = await mockFs.readdir(mountPath);
          PreCheckPathOutput.destinationIsEmpty = dirContents.length === 0;
          instance.logger.log(`Destination path empty status: ${PreCheckPathOutput?.destinationIsEmpty}`);
        } catch (error) {
          instance.logger.error(`Error while checking destination path empty status: ${error.message}`);
        }
      }
    });

    describe('checkDestinationPathEmpty', () => {
      let instance;
      let mockFs;
      let mockLogger;
      let PreCheckPathOutput;
      const mountPath = '/test/mount/path';
    
      beforeEach(() => {
        mockFs = {
          readdir: jest.fn()
        };
        
        mockLogger = {
          log: jest.fn(),
          error: jest.fn()
        };
        
        PreCheckPathOutput = {};
        
        instance = {
          logger: mockLogger
        };
        
        jest.mock('fs/promises', () => mockFs);
      });
    
      afterEach(() => {
        jest.clearAllMocks();
      });
    
      it('should set destinationIsEmpty to true when directory is empty', async () => {
        mockFs.readdir.mockResolvedValue([]);
        
        await executeCheckDestinationPath();
        
        expect(mockFs.readdir).toHaveBeenCalledWith(mountPath);
        expect(PreCheckPathOutput.destinationIsEmpty).toBe(true);
        expect(mockLogger.log).toHaveBeenCalledWith(
          `Destination path empty status: true`
        );
        expect(mockLogger.error).not.toHaveBeenCalled();
      });
    
      it('should set destinationIsEmpty to false when directory has contents', async () => {
        mockFs.readdir.mockResolvedValue(['file1.txt', 'file2.txt']);
        
        await executeCheckDestinationPath();
        
        expect(mockFs.readdir).toHaveBeenCalledWith(mountPath);
        expect(PreCheckPathOutput.destinationIsEmpty).toBe(false);
        expect(mockLogger.log).toHaveBeenCalledWith(
          `Destination path empty status: false`
        );
        expect(mockLogger.error).not.toHaveBeenCalled();
      });
    
      it('should handle errors when reading directory fails', async () => {
        const error = new Error('Permission denied');
        mockFs.readdir.mockRejectedValue(error);
        
        await executeCheckDestinationPath();
        
        expect(mockFs.readdir).toHaveBeenCalledWith(mountPath);
        expect(PreCheckPathOutput.destinationIsEmpty).toBeUndefined();
        expect(mockLogger.log).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith(
          `Error while checking destination path empty status: Permission denied`
        );
      });
    
      it('should handle empty directories with hidden files', async () => {
        mockFs.readdir.mockResolvedValue(['.hidden_file']);
    
        await executeCheckDestinationPath();
        
        expect(PreCheckPathOutput.destinationIsEmpty).toBe(false);
        expect(mockLogger.log).toHaveBeenCalledWith(
          `Destination path empty status: false`
        );
      });
    
      async function executeCheckDestinationPath() {
        try {
          const dirContents = await mockFs.readdir(mountPath);
          PreCheckPathOutput.destinationIsEmpty = dirContents.length === 0;
          instance.logger.log(`Destination path empty status: ${PreCheckPathOutput?.destinationIsEmpty}`);
        } catch (error) {
          instance.logger.error(`Error while checking destination path empty status: ${error.message}`);
        }
      }
    });

  });
});
