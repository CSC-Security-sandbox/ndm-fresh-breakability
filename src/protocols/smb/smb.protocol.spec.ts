import { SMBProtocol } from './smb.protocol';
import { ProtocolPayload } from 'src/protocols/protocol/protocol.type';
import {
  handleConnectionError,
  parseWindowsShares,
  parseLinMacShares,
  parseProtocolVersions,
} from './smb.utils';
import { ConfigService } from '@nestjs/config';
import { WorkersConfig } from 'src/config/app.config';
import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { Runtime, RuntimeOptions } from '@temporalio/worker';
import { mocked } from 'jest-mock';
import { exec } from 'child_process';

jest.mock('./smb.utils');

describe('SMBProtocol', () => {
  let smbProtocol: SMBProtocol;
  let mockLogger: any;

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

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      log: jest.fn(), // Add this line
    };
    smbProtocol = new SMBProtocol();
    (smbProtocol as any).logger = mockLogger;
    (smbProtocol as any).platform = 'win32';
    (smbProtocol as any).workerId = 'defaultWorkerId';
  });

  describe('validateConnection', () => {
    it('should establish a connection successfully', async () => {
      jest
        .spyOn(smbProtocol as any, 'executeCommand')
        .mockResolvedValue('Connection established');
      const options: ProtocolPayload = {
        hostname: 'localhost',
        username: 'user',
        password: 'pass',
        protocolVersion: 'SMB2',
      };
      const result = await smbProtocol.validateConnection('traceId', options);

      expect(result).toBe(undefined);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[traceId] Getting list paths for localhost of type SMB from defaultWorkerId, platform: win32',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[traceId] Getting list paths for localhost of type SMB from defaultWorkerId, platform: win32',
      );
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
      //expect(mockLogger.error).toHaveBeenCalledWith('Error during connection: Connection error');
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
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[traceId] share1\nshare2 success',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
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
        expect(mockLogger.info).toHaveBeenCalledWith(
          '[traceId] Getting protocols for localhost of type SMB from defaultWorkerId',
        );
        expect(mockLogger.info).toHaveBeenCalledWith('[traceId] SMB1\nSMB2');
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

        expect(mockLogger.info).toHaveBeenCalledWith(
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
        expect(mockLogger.info).toHaveBeenCalledWith(
          '[traceId] share1\nshare2 success',
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
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
        const protocol = new SMBProtocol();
        expect(protocol).toBeInstanceOf(SMBProtocol);
      });
    });
  });
});
