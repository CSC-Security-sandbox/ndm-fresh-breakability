import { SMBProtocol } from './smb.protocol';
import { ProtocolPayload } from 'src/protocols/protocol/protocol.type';
import * as fs from 'fs';
import {
  handleConnectionError,
  parseLinMacShares,
  parseProtocolVersions,
} from './smb.utils';
import { ConfigService } from '@nestjs/config';
import { WorkersConfig } from 'src/config/app.config';
import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { Runtime, RuntimeOptions } from '@temporalio/worker';
import { ProtocolTypes } from 'src/protocols/protocols';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';

let loggerFactory: LoggerFactory;

jest.mock('./smb.utils');

describe('SMBProtocol', () => {
  let smbProtocol: SMBProtocol;
  const mockTraceId = 'test-trace-id';
  const mockPayload: ProtocolPayload = {
    hostname: 'test-host',
    username: 'test-user',
    protocolVersion: '3.0',
    path: '/test/path'
  };
  let loggerMock: any;

  beforeEach(() => {
    jest
      .spyOn(Runtime, 'install')
      .mockImplementation((options: RuntimeOptions) => {
        return null;
      });

    const configService = new ConfigService();
    jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      if (key === 'workerId') {
        return 'defaultWorkerId';
      } else if (key === 'platform') {
        return 'win32';
      }
    });
    WorkersConfig.configService = configService;
    CommandConfig.configService = configService;

    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

    loggerFactory = mockLoggerFactory as unknown as LoggerFactory;

    smbProtocol = new SMBProtocol(loggerFactory);
    (smbProtocol as any).logger = mockLogger;
    (smbProtocol as any).platform = 'win32';
    (smbProtocol as any).workerId = 'defaultWorkerId';
  });

  describe('validateConnection', () => {
    it('should establish a connection successfully', async () => {
      jest
        .spyOn(smbProtocol as any, 'listPaths')
        .mockResolvedValue(['share1', 'share2']);
      const options: ProtocolPayload = {
        hostname: 'localhost',
        username: 'user',
        password: 'pass',
        protocolVersion: 'SMB2',
      };
      const result = await smbProtocol.validateConnection('traceId', options);

      expect(result).toBe(undefined);
      expect(smbProtocol.listPaths).toHaveBeenCalledWith('traceId', options);
    });

    it('should handle connection error', async () => {
      (handleConnectionError as any).mockImplementation((error) => {
        if (error.message === 'Connection error') {
          return 'Handled connection error';
        } else if (error.message === 'Connection timed out') {
          return 'Connection timed out';
        }
        return 'Unhandled error';
      });

      const options: ProtocolPayload = { hostname: 'localhost', username: 'user', password: 'pass', protocolVersion: 'SMB2' };

      await expect(smbProtocol.validateConnection('traceId', options)).rejects.toThrow('');
      // expect(mockLogger.error).toHaveBeenCalledWith('Error during connection: Connection error');
    });

    it('should handle connection timeout', async () => {
      jest.useFakeTimers();
      const options: ProtocolPayload = { hostname: 'localhost', username: 'user', password: 'pass', protocolVersion: 'SMB2' };

      const promise = smbProtocol.validateConnection('traceId', options);
      jest.advanceTimersByTime(2000);

      await expect(promise).rejects.toThrow('');
      jest.useRealTimers();
    });

  });

  describe('listShares', () => {
  });

  describe('listSharesforLinMac', () => {
    it('should list shares successfully for linux and mac', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        username: 'user',
        password: 'pass',
        protocolVersion: 'SMB2',
      };

      jest
        .spyOn(CommandConfig, 'getSMBCommand')
        .mockImplementation((platform: string, key: string) => {
          if (key === CommandPattern.LIST_PATHS) {
            return CommandPattern.LIST_PATHS;
          } else if (key === CommandPattern.VALIDATE_CRED) {
            return CommandPattern.VALIDATE_CRED;
          }
          return '';
        });

      jest
        .spyOn(smbProtocol, 'executeCommand')
        .mockImplementation(
          (traceId: string, p: any, pl: any, command: string, cd: string) => {
            if (command.includes(CommandPattern.VALIDATE_CRED)) {
              return Promise.resolve('Connected successfully.');
            } else if (command.includes(CommandPattern.LIST_PATHS)) {
              return Promise.resolve({
                message: 'share1\nshare2',
                status: 'success',
              });
            }
            return Promise.resolve('');
          },
        );

      (parseLinMacShares as jest.Mock).mockReturnValue(['share1', 'share2']);

      const result = await smbProtocol.listPathLinMac('traceId', payload);

      expect(result).toEqual(['share1', 'share2']);
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[traceId] share1\nshare2 success',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[traceId] share1\nshare2 success',
      );
    });

    describe('getProtocolVersions', () => {
      it('should get protocol versions successfully', async () => {
        const payload: ProtocolPayload = {
          hostname: 'localhost',
          username: 'user',
          password: 'pass',
          protocolVersion: 'SMB2',
        };

        jest
          .spyOn(CommandConfig, 'getSMBCommand')
          .mockImplementation((platform: string, key: string) => {
            if (key === CommandPattern.VERSION_DETAIL) {
              return CommandPattern.VERSION_DETAIL;
            }
            return '';
          });

        jest
          .spyOn(smbProtocol, 'executeCommand')
          .mockResolvedValue({ message: 'SMB1\nSMB2' });

        (parseProtocolVersions as jest.Mock).mockReturnValue(['SMB1', 'SMB2']);

        const result = await smbProtocol.getProtocolVersions(
          'traceId',
          payload,
        );

        expect(result).toEqual(['SMB1', 'SMB2']);
        expect(mockLogger.log).toHaveBeenCalledWith(
          '[traceId] Getting protocols for localhost of type SMB from defaultWorkerId',
        );
        expect(mockLogger.log).toHaveBeenCalledWith('[traceId] SMB1\nSMB2');
      });

      it('should handle error during getting protocol versions', async () => {
        const payload: ProtocolPayload = {
          hostname: 'localhost',
          username: 'user',
          password: 'pass',
          protocolVersion: 'SMB2',
        };

        jest
          .spyOn(CommandConfig, 'getSMBCommand')
          .mockImplementation((platform: string, key: string) => {
            if (key === CommandPattern.VERSION_DETAIL) {
              return CommandPattern.VERSION_DETAIL;
            }
            return '';
          });

        jest
          .spyOn(smbProtocol, 'executeCommand')
          .mockRejectedValue(new Error('Command execution failed'));

        await expect(
          smbProtocol.getProtocolVersions('traceId', payload),
        ).rejects.toThrow('Command execution failed');

        expect(mockLogger.log).toHaveBeenCalledWith(
          '[traceId] Getting protocols for localhost of type SMB from defaultWorkerId',
        );
      });
    });

    describe('listPathLinMac', () => {
      it('should list shares successfully for linux and mac', async () => {
        const payload: ProtocolPayload = {
          hostname: 'localhost',
          username: 'user',
          password: 'pass',
          protocolVersion: 'SMB2',
        };

        jest
          .spyOn(CommandConfig, 'getSMBCommand')
          .mockImplementation((platform: string, key: string) => {
            if (key === CommandPattern.LIST_PATHS) {
              return CommandPattern.LIST_PATHS;
            }
            return '';
          });

        jest.spyOn(smbProtocol, 'executeCommand').mockResolvedValue({
          message: 'share1\nshare2',
          status: 'success',
        });

        (parseLinMacShares as jest.Mock).mockReturnValue(['share1', 'share2']);

        const result = await smbProtocol.listPathLinMac('traceId', payload);

        expect(result).toEqual(['share1', 'share2']);
        expect(mockLogger.log).toHaveBeenCalledWith(
          '[traceId] share1\nshare2 success',
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
          '[traceId] share1\nshare2 success',
        );
      });
    });

    describe('listPaths', () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        username: 'user',
        password: 'pass',
        protocolVersion: 'SMB2',
      };

      it('should list paths for darwin platform', async () => {
        jest
          .spyOn(smbProtocol, 'listPathLinMac')
          .mockResolvedValue(['share1', 'share2']);
        (smbProtocol as any).platform = 'darwin';

        const result = await smbProtocol.listPaths('traceId', payload);

        expect(result).toEqual(['share1', 'share2']);
        expect(smbProtocol.listPathLinMac).toHaveBeenCalledWith(
          'traceId',
          payload,
        );
      });

      it('should list paths for linux platform', async () => {
        jest
          .spyOn(smbProtocol, 'listPathLinMac')
          .mockResolvedValue(['share1', 'share2']);
        (smbProtocol as any).platform = 'linux';

        const result = await smbProtocol.listPaths('traceId', payload);

        expect(result).toEqual(['share1', 'share2']);
        expect(smbProtocol.listPathLinMac).toHaveBeenCalledWith(
          'traceId',
          payload,
        );
      });

      it('should list paths for win32 platform', async () => {
        jest
          .spyOn(smbProtocol, 'listPathWindows')
          .mockResolvedValue(['share1', 'share2']);
        (smbProtocol as any).platform = 'win32';

        const result = await smbProtocol.listPaths('traceId', payload);

        expect(result).toEqual(['share1', 'share2']);
        expect(smbProtocol.listPathWindows).toHaveBeenCalledWith(
          'traceId',
          payload,
        );
      });

      it('should throw error for unsupported platform', async () => {
        (smbProtocol as any).platform = 'unsupported';

        await expect(smbProtocol.listPaths('traceId', payload)).rejects.toThrow(
          'Unsupported platform unsupported',
        );
      });
    });

    describe('listPathWindows', () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        username: 'user',
        password: 'pass',
        protocolVersion: 'SMB2',
      };
    });

    // Test the executeCommand method directly for full coverage
    describe('executeCommand', () => {
    });

    // Test constructor and initialization
    describe('constructor', () => {
      it('should initialize properly', () => {
        const protocol = new SMBProtocol(loggerFactory);
        expect(protocol).toBeInstanceOf(SMBProtocol);
      });
    });
  });


  describe('SMBProtocol', () => {
    let smbProtocol: SMBProtocol;
    let loggerMock: any;

    const mockTraceId = 'test-trace-id';
    const mockPayload: ProtocolPayload = {
      hostname: 'test-host',
      username: 'test-user',
      protocolVersion: '3.0',
      path: '/test/path'
    };

    beforeEach(() => {
      loggerMock = {
        log: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        verbose: jest.fn()
      };
      smbProtocol = new SMBProtocol(loggerFactory);

      (smbProtocol as any).logger = loggerMock;
      (smbProtocol as any).platform = 'win32';
      (smbProtocol as any).workerId = 'test-worker-id';

      jest.spyOn(smbProtocol as any, 'executeCommand').mockImplementation();
      jest.spyOn(smbProtocol as any, 'getCommandPattern').mockReturnValue('mock-command-pattern');

      jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe('getTotalSizeWindows', () => {
      it('should successfully return total size', async () => {
        const mockResponse = { message: '1048576' };
        (smbProtocol as any).executeCommand.mockResolvedValue(mockResponse);

        const result = await smbProtocol.getTotalUsedMemory(mockTraceId, mockPayload);

        expect((smbProtocol as any).executeCommand).toHaveBeenCalledWith(
          mockTraceId,
          ProtocolTypes.SMB,
          mockPayload,
          'mock-command-pattern',
          'SMB Mounted Folder size'
        );

        expect((smbProtocol as any).getCommandPattern).toHaveBeenCalledWith(CommandPattern.MOUNTED_FOLDER_SIZE);

        expect(result).toBe(1048576);
      });

      it('should handle string with whitespace', async () => {
        const mockResponse = { message: '  2097152  ' };
        (smbProtocol as any).executeCommand.mockResolvedValue(mockResponse);

        const result = await smbProtocol.getTotalUsedMemory(mockTraceId, mockPayload);

        expect(result).toBe(2097152);
      });

      it('should return 0 for non-numeric response', async () => {
        const mockResponse = { message: 'not a number' };
        (smbProtocol as any).executeCommand.mockResolvedValue(mockResponse);

        const result = await smbProtocol.getTotalUsedMemory(mockTraceId, mockPayload);
        expect(result).toBe(0);
      });

      it('should return 0 for empty response', async () => {
        const mockResponse = { message: '' };
        (smbProtocol as any).executeCommand.mockResolvedValue(mockResponse);

        const result = await smbProtocol.getTotalUsedMemory(mockTraceId, mockPayload);
        expect(result).toBe(0);
      });
    });

    describe('getAvailableDiskSpace', () => {
      it('should successfully return available disk space', async () => {
        const mockResponse = { message: '1073741824', status: 'success' };
        (smbProtocol as any).executeCommand.mockResolvedValue(mockResponse);

        const result = await smbProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);

        expect((smbProtocol as any).executeCommand).toHaveBeenCalledWith(
          mockTraceId,
          ProtocolTypes.SMB,
          mockPayload,
          'mock-command-pattern',
          'SMB Available Disk Space'
        );

        expect((smbProtocol as any).getCommandPattern).toHaveBeenCalledWith(CommandPattern.AVAILABLE_DISK_SPACE);

        expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] Checking available disk space at path: ${mockPayload.path}`);
        expect(loggerMock.log).toHaveBeenCalledWith(`response of getAvailableDiskSpace in smb.protocol ${JSON.stringify(mockResponse)}`);
        expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] ${mockResponse.message}`);
        expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] Available space at ${mockPayload.path}: 1073741824 bytes`);

        expect(result).toEqual({ size: 1073741824 });
      });

      it('should handle string with whitespace', async () => {
        const mockResponse = { message: '  2147483648  ' };
        (smbProtocol as any).executeCommand.mockResolvedValue(mockResponse);

        const result = await smbProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);

        expect(result).toEqual({ size: 2147483648 });
      });

      it('should handle undefined path in payload', async () => {
        const payloadWithoutPath: ProtocolPayload = {
          hostname: 'test-host',
          username: 'test-user',
          protocolVersion: '3.0'
        };

        const mockResponse = { message: '3221225472' };
        (smbProtocol as any).executeCommand.mockResolvedValue(mockResponse);

        const result = await smbProtocol.getAvailableDiskSpace(mockTraceId, payloadWithoutPath);

        expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] Checking available disk space at path: undefined`);
        expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] Available space at undefined: 3221225472 bytes`);

        expect(result).toEqual({ size: 3221225472 });
      });

      it('should handle non-numeric response', async () => {
        const mockResponse = { message: 'not a number' };
        (smbProtocol as any).executeCommand.mockResolvedValue(mockResponse);

        const result = await smbProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);
        expect(result.size).toBeNaN();
      });

      it('should verify SMB protocol type is used', async () => {
        const mockResponse = { message: '4294967296' };
        (smbProtocol as any).executeCommand.mockResolvedValue(mockResponse);

        await smbProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);

        expect((smbProtocol as any).executeCommand).toHaveBeenCalledWith(
          mockTraceId,
          ProtocolTypes.SMB,
          mockPayload,
          'mock-command-pattern',
          'SMB Available Disk Space'
        );
      });

      describe('SMBProtocol - mountPath & unmountPath', () => {
        let smbProtocol: SMBProtocol;
        let loggerMock: any;

        const mockTraceId = 'mount-trace-id';
        const mockPayload = {
          hostname: 'host',
          username: 'user',
          password: 'pass',
          protocolVersion: 'SMB2',
          mountBasePath: '/mnt',
          jobRunId: 'job123'
        };

        beforeEach(() => {
          loggerMock = {
            log: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            verbose: jest.fn()
          };
          smbProtocol = new SMBProtocol(loggerFactory);
          (smbProtocol as any).logger = loggerMock;
          (smbProtocol as any).platform = 'win32';
          (smbProtocol as any).workerId = 'test-worker-id';

          jest.spyOn(smbProtocol as any, 'executeCommand').mockResolvedValue({ message: 'mounted successfully.' });
          jest.spyOn(smbProtocol as any, 'getCommandPattern').mockImplementation((key: string) => key);
        });

        afterEach(() => {
          jest.clearAllMocks();
        });

        describe('mountPath', () => {
          it('should create directory and mount path successfully', async () => {
            // Mock isPathExists to return false (directory doesn't exist)
            jest.spyOn(require('src/activities/core/utils/utils'), 'isPathExists').mockResolvedValue(false);
            
            // Mock fs.promises.mkdir
            const mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);

            // Simulate executeCommand for save creds, mount, and create path link
            (smbProtocol as any).executeCommand
              .mockResolvedValueOnce({ message: 'credentials saved successfully.' }) // save creds
              .mockResolvedValueOnce({ message: 'mounted successfully.' }) // mount
              .mockResolvedValueOnce({ message: 'link created successfully.' }); // create path link

            const payload = { ...mockPayload };
            const result = await smbProtocol.mountPath(mockTraceId, payload);

            expect(mockMkdir).toHaveBeenCalledWith('/mnt/job123', { recursive: true });
            expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] Directory created: /mnt/job123`);
            expect((smbProtocol as any).executeCommand).toHaveBeenCalledWith(
              mockTraceId,
              ProtocolTypes.SMB,
              payload,
              CommandPattern.SAVE_CREDS,
              'SMB Save Credentials'
            );
            expect((smbProtocol as any).executeCommand).toHaveBeenCalledWith(
              mockTraceId,
              ProtocolTypes.SMB,
              payload,
              CommandPattern.MOUNT_PATH,
              'SMB Mount'
            );
            expect((smbProtocol as any).executeCommand).toHaveBeenCalledWith(
              mockTraceId,
              ProtocolTypes.SMB,
              payload,
              CommandPattern.CREATE_PATH_LINK,
              'SMB Show Shares'
            );
            expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] link created successfully.`);
            expect(result).toEqual({ message: 'link created successfully.' });
            
            // Restore mocks
            mockMkdir.mockRestore();
          });

          it('should handle error during directory creation', async () => {
            // Mock isPathExists to return false (directory doesn't exist)
            jest.spyOn(require('src/activities/core/utils/utils'), 'isPathExists').mockResolvedValue(false);
            
            // Mock fs.promises.mkdir to throw error
            const error = new Error('mkdir failed');
            const mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockRejectedValue(error);

            const payload = { ...mockPayload };
            const result = await smbProtocol.mountPath(mockTraceId, payload);

            expect(mockMkdir).toHaveBeenCalledWith('/mnt/job123', { recursive: true });
            expect(loggerMock.error).toHaveBeenCalledWith(`[${mockTraceId}] Error creating directory------?: ${error.message}`);
            expect(result).toEqual({
              traceId: mockTraceId,
              status: 'error',
              protocolType: ProtocolTypes.SMB,
              hostname: payload.hostname,
              workerId: (smbProtocol as any).workerId,
              message: `[${mockTraceId}] Error creating directory: ${error.message}`,
            });
            
            // Restore mocks
            mockMkdir.mockRestore();
          });

          it('should skip directory creation when directory already exists', async () => {
            // Mock isPathExists to return true (directory exists)
            jest.spyOn(require('src/activities/core/utils/utils'), 'isPathExists').mockResolvedValue(true);
            
            // Mock fs.promises.mkdir (should not be called)
            const mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);

            // Simulate executeCommand for save creds, mount and create path link
            (smbProtocol as any).executeCommand
              .mockResolvedValueOnce({ message: 'credentials saved successfully.' }) // save creds
              .mockResolvedValueOnce({ message: 'mounted successfully.' }) // mount
              .mockResolvedValueOnce({ message: 'link created successfully.' }); // create path link

            const payload = { ...mockPayload };
            const result = await smbProtocol.mountPath(mockTraceId, payload);

            expect(mockMkdir).not.toHaveBeenCalled(); // Should not create directory if it exists
            expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] link created successfully.`);
            expect(result).toEqual({ message: 'link created successfully.' });
            
            // Restore mocks
            mockMkdir.mockRestore();
          });

          it('should call WindowsPrivilegeService.enableBackupPrivileges() before mounting on Windows', async () => {
            // Mock WindowsPrivilegeService
            const mockPrivilegeService = {
              enableBackupPrivileges: jest.fn().mockResolvedValue(true),
              logCurrentPrivileges: jest.fn().mockResolvedValue(undefined),
            };
            (smbProtocol as any).windowsPrivilegeService = mockPrivilegeService;
            (smbProtocol as any).platform = 'win32';

            jest.spyOn(require('src/activities/core/utils/utils'), 'isPathExists').mockResolvedValue(true);
            (smbProtocol as any).executeCommand
              .mockResolvedValueOnce({ message: 'credentials saved successfully.' })
              .mockResolvedValueOnce({ message: 'mounted successfully.' })
              .mockResolvedValueOnce({ message: 'link created successfully.' });

            const payload = { ...mockPayload };
            await smbProtocol.mountPath(mockTraceId, payload, true);

            // Verify privilege service was called
            expect(mockPrivilegeService.enableBackupPrivileges).toHaveBeenCalled();
            expect(loggerMock.log).toHaveBeenCalledWith(expect.stringContaining('Enabling Windows backup privileges'));
          });

          it('should skip privilege enablement on non-Windows platforms', async () => {
            const mockPrivilegeService = {
              enableBackupPrivileges: jest.fn().mockResolvedValue(true),
              logCurrentPrivileges: jest.fn().mockResolvedValue(undefined),
            };
            (smbProtocol as any).windowsPrivilegeService = mockPrivilegeService;
            (smbProtocol as any).platform = 'linux';

            jest.spyOn(require('src/activities/core/utils/utils'), 'isPathExists').mockResolvedValue(true);
            (smbProtocol as any).executeCommand
              .mockResolvedValueOnce({ message: 'credentials saved successfully.' })
              .mockResolvedValueOnce({ message: 'mounted successfully.' })
              .mockResolvedValueOnce({ message: 'link created successfully.' });

            const payload = { ...mockPayload };
            await smbProtocol.mountPath(mockTraceId, payload, true);

            // Verify privilege service was NOT called on non-Windows
            expect(mockPrivilegeService.enableBackupPrivileges).not.toHaveBeenCalled();
          });

          it('should throw error when privilege enablement fails', async () => {
            const mockPrivilegeService = {
              enableBackupPrivileges: jest.fn().mockResolvedValue(false),
              logCurrentPrivileges: jest.fn().mockResolvedValue(undefined),
            };
            (smbProtocol as any).windowsPrivilegeService = mockPrivilegeService;
            (smbProtocol as any).platform = 'win32';

            const payload = { ...mockPayload };
            
            // Should throw error when privileges fail to enable
            await expect(smbProtocol.mountPath(mockTraceId, payload, true)).rejects.toThrow(
              'Failed to enable Windows backup privileges'
            );
            expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('Failed to enable Windows backup privileges'));
          });

          it('should handle WindowsPrivilegeService being null gracefully', async () => {
            (smbProtocol as any).windowsPrivilegeService = null;
            (smbProtocol as any).platform = 'win32';

            jest.spyOn(require('src/activities/core/utils/utils'), 'isPathExists').mockResolvedValue(true);
            (smbProtocol as any).executeCommand
              .mockResolvedValueOnce({ message: 'credentials saved successfully.' })
              .mockResolvedValueOnce({ message: 'mounted successfully.' })
              .mockResolvedValueOnce({ message: 'link created successfully.' });

            const payload = { ...mockPayload };
            const result = await smbProtocol.mountPath(mockTraceId, payload);

            // Should complete mounting when service is not available (non-DI environments)
            expect(result).toEqual({ message: 'link created successfully.' });
            // Should not attempt to log privilege messages
            expect(loggerMock.log).not.toHaveBeenCalledWith(expect.stringContaining('Enabling Windows backup privileges'));
          });
        });
      });
    });
  });
});
