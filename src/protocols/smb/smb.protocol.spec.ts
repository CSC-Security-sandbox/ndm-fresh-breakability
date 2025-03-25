import { SMBProtocol } from './smb.protocol';
import { ProtocolPayload } from 'src/protocols/protocol/protocol.type';
import { handleConnectionError, parseWindowsShares, parseLinMacShares, parseProtocolVersions } from './smb.utils';
import { ConfigService } from '@nestjs/config';
import { WorkersConfig } from 'src/config/app.config';
import { CommandConfig, CommandPattern } from 'src/config/command.config';
import { Runtime, RuntimeOptions } from '@temporalio/worker';
import { Logger } from '@nestjs/common';

jest.mock('./smb.utils');

describe('SMBProtocol', () => {
  let smbProtocol: SMBProtocol;
  let mockLogger: Partial<Logger>;

  beforeEach(() => {
    jest.spyOn(Runtime, 'install').mockImplementation((options: RuntimeOptions) => {
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
      log: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    smbProtocol = new SMBProtocol(mockLogger as Logger);
    (smbProtocol as any).platform = 'win32';
    (smbProtocol as any).workerId = 'defaultWorkerId';
  });

  describe('validateConnection', () => {
    it('should establish a connection successfully', async () => {
      const traceId = 'trace-id';
      const payload: ProtocolPayload = { hostname: 'test-host', ... }; // Fill in with necessary properties

      // Mock the listPaths method to simulate successful connection
      jest.spyOn(smbProtocol, 'listPaths').mockResolvedValueOnce('Connection established');

      await smbProtocol.validateConnection(traceId, payload);

      expect(mockLogger.info).toHaveBeenCalledWith(`[${traceId}] Getting list paths for ${payload.hostname} of type SMB from ${smbProtocol.workerId}`);
      expect(smbProtocol.listPaths).toHaveBeenCalledWith(traceId, payload);
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

      const options: ProtocolPayload = {
        hostname: 'localhost', username: 'user', password: 'pass',
        protocolVersion: ''
      };

      await expect(smbProtocol.validateConnection('traceId', options)).rejects.toThrow('');
      //expect(mockLogger.error).toHaveBeenCalledWith('Error during connection: Connection error');
    });

    it('should handle connection timeout', async () => {
      jest.useFakeTimers();
      const options: ProtocolPayload = {
        hostname: 'localhost', username: 'user', password: 'pass',
        protocolVersion: ''
      };

      const promise = smbProtocol.validateConnection('traceId', options);
      jest.advanceTimersByTime(2000);

      await expect(promise).rejects.toThrow('');
      jest.useRealTimers();
    });
  });

  describe('listShares', () => {
    it('should list shares successfully for windows', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost', username: 'user', password: 'pass',
        protocolVersion: ''
      };
      jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
        if (key == CommandPattern.LIST_PATHS) {
          return CommandPattern.LIST_PATHS;
        } else if (key == CommandPattern.VALIDATE_CRED) {
          return CommandPattern.VALIDATE_CRED;
        }
      });

      jest.spyOn(smbProtocol, 'executeCommand').mockImplementation((traceId: string, p: any, pl: any, command: string, cd: string) => {
        if (command.includes(CommandPattern.VALIDATE_CRED)) {
          return Promise.resolve("Connected successfully.");
        } else if (command.includes(CommandPattern.LIST_PATHS)) {
          return Promise.resolve({ message: 'share1\nshare2' });
        }
      });
  
      (smbProtocol as any).workerId = 'defaultWorkerId';
      (parseWindowsShares as any).mockReturnValue(['share1', 'share2']);

      const result = await smbProtocol.listPathWindows('traceId', payload);

      expect(result).toEqual(['share1', 'share2']);
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type SMB from defaultWorkerId');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] share1\nshare2');
    });
  });

  describe('listSharesforLinMac', () => {
    it('should list shares successfully for linux and mac', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost', username: 'user', password: 'pass',
        protocolVersion: ''
      };
      jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
        if (key == CommandPattern.LIST_PATHS) {
          return CommandPattern.LIST_PATHS;
        } else if (key == CommandPattern.VALIDATE_CRED) {
          return CommandPattern.VALIDATE_CRED;
        }
      });

      jest.spyOn(smbProtocol, 'executeCommand').mockImplementation((traceId: string, p: any, pl: any, command: string, cd: string) => {
        if (command.includes(CommandPattern.VALIDATE_CRED)) {
          return Promise.resolve("Connected successfully.");
        } else if (command.includes(CommandPattern.LIST_PATHS)) {
          return Promise.resolve({ message: 'share1\nshare2', status: 'success' });
        }
      });
  
      (smbProtocol as any).workerId = 'defaultWorkerId';
      (parseLinMacShares as any).mockReturnValue(['share1', 'share2']);

      const result = await smbProtocol.listPathLinMac('traceId', payload);

      expect(result).toEqual(['share1', 'share2']);
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type SMB from defaultWorkerId');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] share1\nshare2 success');
    });

    describe('getProtocolVersions', () => {
      it('should get protocol versions successfully', async () => {
        const payload: ProtocolPayload = {
          hostname: 'localhost', username: 'user', password: 'pass',
          protocolVersion: ''
        };
        jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
          if (key == CommandPattern.VERSION_DETAIL) {
            return CommandPattern.VERSION_DETAIL;
          }
        });

        jest.spyOn(smbProtocol, 'executeCommand').mockResolvedValue({ message: 'SMB1\nSMB2' });
        (parseProtocolVersions as any).mockReturnValue(['SMB1', 'SMB2']);

        const result = await smbProtocol.getProtocolVersions('traceId', payload);

        expect(result).toEqual(['SMB1', 'SMB2']);
        expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting protocols for localhost of type SMB from defaultWorkerId');
        expect(mockLogger.info).toHaveBeenCalledWith('[traceId] SMB1\nSMB2');
      });

      it('should handle error during getting protocol versions', async () => {
        const payload: ProtocolPayload = {
          hostname: 'localhost', username: 'user', password: 'pass',
          protocolVersion: ''
        };
        jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
          if (key == CommandPattern.VERSION_DETAIL) {
            return CommandPattern.VERSION_DETAIL;
          }
        });

        jest.spyOn(smbProtocol, 'executeCommand').mockRejectedValue(new Error('Command execution failed'));

        await expect(smbProtocol.getProtocolVersions('traceId', payload)).rejects.toThrow('Command execution failed');
        expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting protocols for localhost of type SMB from defaultWorkerId');
      });
    });
  describe('listPathLinMac', () => {
    it('should list shares successfully for linux and mac', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost', username: 'user', password: 'pass',
        protocolVersion: ''
      };
      jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
        if (key == CommandPattern.LIST_PATHS) {
          return CommandPattern.LIST_PATHS;
        }
      });

      jest.spyOn(smbProtocol, 'executeCommand').mockResolvedValue({ message: 'share1\nshare2', status: 'success' });
      (parseLinMacShares as any).mockReturnValue(['share1', 'share2']);

      const result = await smbProtocol.listPathLinMac('traceId', payload);

      expect(result).toEqual(['share1', 'share2']);
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type SMB from defaultWorkerId');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] share1\nshare2 success');
    });

    it('should handle error during listing shares', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost', username: 'user', password: 'pass',
        protocolVersion: ''
      };
      jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
        if (key == CommandPattern.LIST_PATHS) {
          return CommandPattern.LIST_PATHS;
        }
      });

      jest.spyOn(smbProtocol, 'executeCommand').mockRejectedValue(new Error('NT_STATUS_ACCESS_DENIED'));
      (handleConnectionError as any).mockReturnValue('Handled connection error');

      await expect(smbProtocol.listPathLinMac('traceId', payload)).rejects.toThrow('Handled connection error');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type SMB from defaultWorkerId');
      expect(mockLogger.error).toHaveBeenCalledWith('Error during SMB connection: NT_STATUS_ACCESS_DENIED');
    });
  });

  describe('listPaths', () => {
    const payload: ProtocolPayload = {
      hostname: 'localhost', username: 'user', password: 'pass',
      protocolVersion: ''
    };

    it('should list paths for darwin platform', async () => {
      jest.spyOn(smbProtocol, 'listPathLinMac').mockResolvedValue(['share1', 'share2']);
      (smbProtocol as any).platform = 'darwin';

      const result = await smbProtocol.listPaths('traceId', payload);

      expect(result).toEqual(['share1', 'share2']);
      expect(smbProtocol.listPathLinMac).toHaveBeenCalledWith('traceId', payload);
    });

    it('should list paths for linux platform', async () => {
      jest.spyOn(smbProtocol, 'listPathLinMac').mockResolvedValue(['share1', 'share2']);
      (smbProtocol as any).platform = 'linux';

      const result = await smbProtocol.listPaths('traceId', payload);

      expect(result).toEqual(['share1', 'share2']);
      expect(smbProtocol.listPathLinMac).toHaveBeenCalledWith('traceId', payload);
    });

    it('should list paths for win32 platform', async () => {
      jest.spyOn(smbProtocol, 'listPathWindows').mockResolvedValue(['share1', 'share2']);
      (smbProtocol as any).platform = 'win32';

      const result = await smbProtocol.listPaths('traceId', payload);

      expect(result).toEqual(['share1', 'share2']);
      expect(smbProtocol.listPathWindows).toHaveBeenCalledWith('traceId', payload);
    });

    it('should throw error for unsupported platform', async () => {
      (smbProtocol as any).platform = 'unsupported';

      await expect(smbProtocol.listPaths('traceId', payload)).rejects.toThrow('Unsupported platform unsupported');
    });
  });

  describe('listPathLinMac', () => {
    it('should list shares successfully for linux and mac', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost', username: 'user', password: 'pass',
        protocolVersion: ''
      };
      jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
        if (key == CommandPattern.LIST_PATHS) {
          return CommandPattern.LIST_PATHS;
        }
      });

      jest.spyOn(smbProtocol, 'executeCommand').mockResolvedValue({ message: 'share1\nshare2', status: 'success' });
      (parseLinMacShares as any).mockReturnValue(['share1', 'share2']);

      const result = await smbProtocol.listPathLinMac('traceId', payload);

      expect(result).toEqual(['share1', 'share2']);
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type SMB from defaultWorkerId');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] share1\nshare2 success');
    });

    it('should handle error during listing shares', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost', username: 'user', password: 'pass',
        protocolVersion: ''
      };
      jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
        if (key == CommandPattern.LIST_PATHS) {
          return CommandPattern.LIST_PATHS;
        }
      });

      jest.spyOn(smbProtocol, 'executeCommand').mockRejectedValue(new Error('NT_STATUS_ACCESS_DENIED'));
      (handleConnectionError as any).mockReturnValue('Handled connection error');

      await expect(smbProtocol.listPathLinMac('traceId', payload)).rejects.toThrow('Handled connection error');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type SMB from defaultWorkerId');
      expect(mockLogger.error).toHaveBeenCalledWith('Error during SMB connection: NT_STATUS_ACCESS_DENIED');
    });
    describe('listPathWindows', () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost', username: 'user', password: 'pass',
        protocolVersion: ''
      };

      it('should list shares successfully for windows', async () => {
        jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
          if (key == CommandPattern.VALIDATE_CRED) {
            return CommandPattern.VALIDATE_CRED;
          } else if (key == CommandPattern.LIST_PATHS) {
            return CommandPattern.LIST_PATHS;
          }
        });

        jest.spyOn(smbProtocol, 'executeCommand').mockImplementation((traceId: string, p: any, pl: any, command: string, cd: string) => {
          if (command.includes(CommandPattern.VALIDATE_CRED)) {
            return Promise.resolve("Connected successfully.");
          } else if (command.includes(CommandPattern.LIST_PATHS)) {
            return Promise.resolve({ message: 'share1\nshare2' });
          }
        });

        (parseWindowsShares as any).mockReturnValue(['share1', 'share2']);

        const result = await smbProtocol.listPathWindows('traceId', payload);

        expect(result).toEqual(['share1', 'share2']);
        expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type SMB from defaultWorkerId');
        expect(mockLogger.info).toHaveBeenCalledWith('[traceId] share1\nshare2');
      });

      it('should handle error during listing shares', async () => {
        jest.spyOn(CommandConfig, 'getSMBCommand').mockImplementation((platform: string, key: string) => {
          if (key == CommandPattern.VALIDATE_CRED) {
            return CommandPattern.VALIDATE_CRED;
          } else if (key == CommandPattern.LIST_PATHS) {
            return CommandPattern.LIST_PATHS;
          }
        });

        jest.spyOn(smbProtocol, 'executeCommand').mockImplementation((traceId: string, p: any, pl: any, command: string, cd: string) => {
          if (command.includes(CommandPattern.VALIDATE_CRED)) {
            return Promise.resolve("Connected successfully.");
          } else if (command.includes(CommandPattern.LIST_PATHS)) {
            return Promise.reject(new Error('NT_STATUS_ACCESS_DENIED\nAdditional error info'));
          }
        });

        await expect(smbProtocol.listPathWindows('traceId', payload)).rejects.toThrow('Additional error info');
        expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type SMB from defaultWorkerId');
      });
    });

  });
  });
});
