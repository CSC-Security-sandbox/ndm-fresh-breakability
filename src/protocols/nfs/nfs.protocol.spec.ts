import { NFSProtocol } from './nfs.protocol';
import { ProtocolPayload } from 'src/protocols/protocol/protocol.type';
import * as net from 'net';
import { handleConnectionError, parseExports, parseProtocolVersions } from './nfs.utils';
import { ConfigService } from '@nestjs/config';
import { WorkersConfig } from 'src/config/app.config';
import { CommandConfig } from 'src/config/command.config';
import { Logger, Runtime, RuntimeOptions } from '@temporalio/worker';
import { ProtocolTypes } from '../protocols';
import { CommandPattern } from 'src/config/command.config';
import * as ffs from 'fast-folder-size';

jest.mock('net');
jest.mock('./nfs.utils');
jest.mock('fast-folder-size');

describe('NFSProtocol', () => {
  let nfsProtocol: NFSProtocol;
  let mockLogger: Partial<Logger>;

  beforeEach(() => {
    jest.spyOn(Runtime, 'install').mockImplementation((options: RuntimeOptions) => {
      return null;
    });
    const configService = new ConfigService();
    jest.spyOn(configService, 'get').mockReturnValue('test-worker');
    WorkersConfig.configService = configService;
    CommandConfig.configService = configService;

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };
    nfsProtocol = new NFSProtocol();
    (nfsProtocol as any).logger = mockLogger;
  });

  describe('validateConnection', () => {
    it('should establish a connection successfully', async () => {
      const mockSocket = {
        connect: jest.fn((port, hostname, callback) => callback()),
        destroy: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      };
      (net.Socket as any).mockImplementation(() => mockSocket);

      const options: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: ''
      };
      const result = await nfsProtocol.validateConnection('traceId', options);

      expect(result).toBe('Connection established');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Attempting to connect... Protocol: NFS');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Connection established for Protocol: NFS');
    });

    it('should handle connection error', async () => {
      const mockSocket = {
        connect: jest.fn(),
        destroy: jest.fn(),
        end: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Connection error'));
          }
        }),
      };
      (net.Socket as any).mockImplementation(() => mockSocket);
      (handleConnectionError as any).mockImplementation((error) => {
        if (error.message === 'Connection error') {
          return 'Handled connection error';
        } else if (error.message === 'Connection timed out') {
          return 'Connection timed out';
        }
        return 'Unhandled error';
      });

      const options: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: ''
      };

      await expect(nfsProtocol.validateConnection('traceId', options)).rejects.toThrow('Handled connection error');
      expect(mockLogger.error).toHaveBeenCalledWith('Error during connection: Connection error');
    });

    it('should handle connection timeout', async () => {
      jest.useFakeTimers();
      const mockSocket = {
        connect: jest.fn(),
        destroy: jest.fn(),
        error: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      };
      (net.Socket as any).mockImplementation(() => mockSocket);

      const options: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: ''
      };

      const promise = nfsProtocol.validateConnection('traceId', options);
      jest.advanceTimersByTime(2000);

      await expect(promise).rejects.toThrow('Connection timed out');
      jest.useRealTimers();
    });
  });

  describe('getProtocolVersions', () => {
    it('should get protocol versions successfully', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: ''
      };
      const mockResponse = { message: 'NFSv3\nNFSv4' };
      (nfsProtocol as any).executeCommand = jest.fn().mockResolvedValue(mockResponse);
      (parseProtocolVersions as any).mockReturnValue(['NFSv3', 'NFSv4']);

      const result = await nfsProtocol.getProtocolVersions('traceId', payload);

      expect(result).toEqual(['NFSv3', 'NFSv4']);
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting protocols for localhost of type NFS from test-worker');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] NFSv3\nNFSv4');
    });
  });

  describe('listPaths', () => {
    it('should list paths successfully', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: ''
      };
      const mockResponse = { message: '/export/path1\n/export/path2' };
      (nfsProtocol as any).executeCommand = jest.fn().mockResolvedValue(mockResponse);
      (parseExports as any).mockReturnValue(['/export/path1', '/export/path2']);

      const result = await nfsProtocol.listPaths('traceId', payload);

      expect(result).toEqual(['/export/path1', '/export/path2']);
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type NFS from test-worker');
      expect(mockLogger.info).toHaveBeenCalledWith('[traceId] /export/path1\n/export/path2');
    });
  });

  describe('unmountPath', () => {
    it('should unmount path successfully', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: '',
        path: '/path1',
        mountBasePath: '/mnt'
      };
      const mockResponse = { message: 'Successfully unmounted', status: 'success' };
      (nfsProtocol as any).executeCommand = jest.fn().mockResolvedValue(mockResponse);

      const result = await nfsProtocol.unmountPath('traceId', payload);
      expect(mockLogger.info).toHaveBeenCalled();
      expect(result).toBe(mockResponse);
    });
  })

  describe('NFSProtocol - getAvailableDiskSpace', () => {
    let nfsProtocol: NFSProtocol;
    let loggerMock: jest.Mocked<Logger>;
  
    const mockTraceId = 'test-trace-id';
    const mockPayload: ProtocolPayload = {
      hostname: 'test-host',
      username: 'test-user',
      protocolVersion: '4.2',
      path: '/test/path'
    };
  
    beforeEach(async () => {
      loggerMock = {
        log: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn()
      } as unknown as jest.Mocked<Logger>;
  
      nfsProtocol = new NFSProtocol();
      (nfsProtocol as any).logger = loggerMock;
      (nfsProtocol as any).platform = 'linux';
      (nfsProtocol as any).workerId = 'test-worker-id';
      
      jest.spyOn(nfsProtocol as any, 'executeCommand').mockImplementation();
      jest.spyOn(nfsProtocol as any, 'getCommandPattern').mockReturnValue('mock-command-pattern');
      jest.spyOn(console, 'log').mockImplementation();
    });
  
    afterEach(() => {
      jest.clearAllMocks();
    });
  
    it('should successfully return available disk space', async () => {
      const mockResponse = { message: '1024000' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);
  
      const result = await nfsProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);
  
      expect((nfsProtocol as any).executeCommand).toHaveBeenCalledWith(
        mockTraceId,
        ProtocolTypes.NFS,
        mockPayload,
        'mock-command-pattern',
        'NFS path Available Disk Space'
      );
  
      expect((nfsProtocol as any).getCommandPattern).toHaveBeenCalledWith(CommandPattern.AVAILABLE_DISK_SPACE);
  
      expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] Checking available disk space at path: ${mockPayload.path}`);
      expect(loggerMock.info).toHaveBeenCalledWith(`[${mockTraceId}] ${mockResponse.message}`);
      expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] Available space at ${mockPayload.path}: 1024000 bytes`);
  
      expect(loggerMock.log).toHaveBeenCalledWith(`response of getAvailableDiskSpace in nfs.protocol ${JSON.stringify(mockResponse)}`);
      expect(result).toEqual({ size: 1024000 });
    });
  
    it('should handle string with whitespace', async () => {
      const mockResponse = { message: '  2048000  ' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);
  
      const result = await nfsProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);
      expect(result).toEqual({ size: 2048000 });
    });
  
    it('should handle undefined path in payload', async () => {
      const payloadWithoutPath: ProtocolPayload = {
        hostname: 'test-host',
        username: 'test-user',
        protocolVersion: '4.2'
      };
  
      const mockResponse = { message: '3072000' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);
  
      const result = await nfsProtocol.getAvailableDiskSpace(mockTraceId, payloadWithoutPath);
  
      expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] Checking available disk space at path: undefined`);
      expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] Available space at undefined: 3072000 bytes`);
  
      expect(result).toEqual({ size: 3072000 });
    });
  
    it('should handle non-numeric response from executeCommand', async () => {
      const mockResponse = { message: 'not a number' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);
  
      const result = await nfsProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);
      expect(result.size).toBeNaN();
    });
  
    it('should handle empty response from executeCommand', async () => {
      const mockResponse = { message: '' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);
  
      const result = await nfsProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);
      expect(result.size).toBeNaN();
    });
  
    it('should gracefully handle null response', async () => {
      (nfsProtocol as any).executeCommand.mockResolvedValue(null);
  
      await expect(nfsProtocol.getAvailableDiskSpace(mockTraceId, mockPayload)).rejects.toThrow();
    });
  
    it('should correctly get command pattern for disk space', async () => {
      const mockResponse = { message: '1024000' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);
      
      await nfsProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);
      
      expect((nfsProtocol as any).getCommandPattern).toHaveBeenCalledWith(CommandPattern.AVAILABLE_DISK_SPACE);
    });
  });

  describe('getTotalSizeLinux', () => {
    const mockTraceId = 'test-trace-id';
    const mockPayload: ProtocolPayload = {
      hostname: 'test-host',
      username: 'test-user',
      protocolVersion: '4.2',
      path: '/test/path'
    };

    beforeEach(() => {
      (nfsProtocol as any).logger = {
        log: jest.fn(),
        error: jest.fn(),
        info: jest.fn()
      };
    });

    it('should return correct folder size', async () => {
      const expectedSize = 1024000;
      
      (ffs as any).mockImplementation((path, callback) => {
        callback(null, expectedSize);
      });

      const result = await nfsProtocol.getTotalUsedMemory(mockTraceId, mockPayload);
      
      expect(result).toBe(expectedSize);
      expect(ffs).toHaveBeenCalledWith('/test/path', expect.any(Function));
      expect((nfsProtocol as any).logger.log).toHaveBeenCalledWith(
        `[${mockTraceId}] Calculated data size for ${mockPayload.path}: ${expectedSize} bytes`
      );
    });

    it('should return 0 when bytes is null', async () => {
      (ffs as any).mockImplementation((path, callback) => {
        callback(null, null);
      });

      const result = await nfsProtocol.getTotalUsedMemory(mockTraceId, mockPayload);
      
      expect(result).toBe(0);
      expect(ffs).toHaveBeenCalledWith('/test/path', expect.any(Function));
    });

    it('should throw error when fast-folder-size fails', async () => {
      const errorMsg = 'Failed to calculate folder size';
      
      (ffs as any).mockImplementation((path, callback) => {
        callback(new Error(errorMsg), null);
      });

      await expect(nfsProtocol.getTotalUsedMemory(mockTraceId, mockPayload)).rejects.toThrow(
        `Size calculation failed: ${errorMsg}`
      );
      
      expect(ffs).toHaveBeenCalledWith('/test/path', expect.any(Function));
      expect((nfsProtocol as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Error calculating size for ${mockPayload.path}`)
      );
    });

    it('should handle payload with different path value', async () => {
      const customPath = '/custom/path';
      const customPayload = {
        ...mockPayload,
        path: customPath
      };
      const expectedSize = 5000000;
      
      (ffs as any).mockImplementation((path, callback) => {
        callback(null, expectedSize);
      });

      const result = await nfsProtocol.getTotalUsedMemory(mockTraceId, customPayload);
      
      expect(result).toBe(expectedSize);
      expect(ffs).toHaveBeenCalledWith(customPath, expect.any(Function));
      expect((nfsProtocol as any).logger.log).toHaveBeenCalledWith(
        `[${mockTraceId}] Calculated data size for ${customPath}: ${expectedSize} bytes`
      );
    });
  });
});