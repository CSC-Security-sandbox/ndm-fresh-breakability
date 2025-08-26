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
import * as os from 'os';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from 'src/auth/auth.service.spec';
import { Test, TestingModule } from '@nestjs/testing';
import { mockLogger } from 'src/auth/auth.service.spec';
import * as fs from 'fs';

let loggerFactory: LoggerFactory;

jest.mock('net');
jest.mock('./nfs.utils');
jest.mock('src/activities/core/utils/utils', () => ({
  isPathExists: jest.fn(),
}));

describe('NFSProtocol', () => {
  let nfsProtocol: NFSProtocol;

  beforeEach(async () => {
    const configService = new ConfigService();
    jest.spyOn(configService, 'get').mockReturnValue('test-worker');
    WorkersConfig.configService = configService;
    CommandConfig.configService = configService;

    mockLoggerFactory.create = jest.fn().mockReturnValue(mockLogger); 

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NFSProtocol,
        { provide: LoggerFactory,
          useValue: mockLoggerFactory
        },
      ],
    }).compile();

    loggerFactory = module.get<LoggerFactory>(LoggerFactory); 

    jest.spyOn(Runtime, 'install').mockImplementation((options: RuntimeOptions) => {
      return null;
    });

    nfsProtocol = new NFSProtocol(loggerFactory);
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
      expect(mockLogger.log).toHaveBeenCalledWith('[traceId] Attempting to connect... Protocol: NFS');
      expect(mockLogger.log).toHaveBeenCalledWith('[traceId] Connection established for Protocol: NFS');
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
      expect(mockLogger.log).toHaveBeenCalledWith('[traceId] Getting protocols for localhost of type NFS from test-worker');
      expect(mockLogger.log).toHaveBeenCalledWith('[traceId] NFSv3\nNFSv4');
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
      expect(mockLogger.log).toHaveBeenCalledWith('[traceId] Getting list paths for localhost of type NFS from test-worker');
      expect(mockLogger.log).toHaveBeenCalledWith('[traceId] /export/path1\n/export/path2');
    });
  });

  describe('unmountPath', () => {
    it('should unmount path successfully', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: '',
        path: '/path1',
        mountBasePath: '/mnt',
        jobRunId: 'job123',
        pathId: 'path456'
      };
      const mockResponse = { message: 'Successfully unmounted', status: 'success' };
      (nfsProtocol as any).executeCommand = jest.fn().mockResolvedValue(mockResponse);

      // Mock isPathExists to return true (directory exists)
      const { isPathExists } = require('src/activities/core/utils/utils');
      isPathExists.mockResolvedValue(true);
      
      // Mock fs.promises.rmdir
      const mockRmdir = jest.spyOn(fs.promises, 'rmdir').mockResolvedValue(undefined);

      const result = await nfsProtocol.unmountPath('traceId', payload, false);
      
      expect(mockLogger.log).toHaveBeenCalled();
      expect(isPathExists).toHaveBeenCalledWith('/mnt/job123/path456');
      expect(mockRmdir).toHaveBeenCalledWith('/mnt/job123/path456', { recursive: true });
      expect(result).toBe(mockResponse);
      
      // Restore the mocks
      mockRmdir.mockRestore();
    });

    it('should handle case when directory does not exist', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: '',
        path: '/path1',
        mountBasePath: '/mnt',
        jobRunId: 'job123',
        pathId: 'path456'
      };
      const mockResponse = { message: 'Successfully unmounted', status: 'success' };
      (nfsProtocol as any).executeCommand = jest.fn().mockResolvedValue(mockResponse);

      // Mock isPathExists to return false (directory doesn't exist)
      const { isPathExists } = require('src/activities/core/utils/utils');
      isPathExists.mockResolvedValue(false);
      
      // Mock fs.promises.rmdir
      const mockRmdir = jest.spyOn(fs.promises, 'rmdir').mockResolvedValue(undefined);

      const result = await nfsProtocol.unmountPath('traceId', payload, false);
      
      expect(mockLogger.log).toHaveBeenCalled();
      expect(isPathExists).toHaveBeenCalledWith('/mnt/job123/path456');
      expect(mockRmdir).not.toHaveBeenCalled(); // Should not be called when directory doesn't exist
      expect(result).toBe(mockResponse);
      
      // Restore the mocks
      mockRmdir.mockRestore();
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
  
      nfsProtocol = new NFSProtocol(loggerFactory);
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
      expect(loggerMock.log).toHaveBeenCalledWith(`[${mockTraceId}] ${mockResponse.message}`);
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
});

describe('NFSProtocol - getTotalUsedMemory', () => {
  let nfsProtocol: NFSProtocol;
  const traceId = 'test-trace-id';
  const payload: ProtocolPayload = {
    hostname: 'localhost',
    path: '/mnt/test',
  } as ProtocolPayload;

  beforeEach(() => {
    nfsProtocol = new NFSProtocol(loggerFactory);
    nfsProtocol['executeCommand'] = jest.fn();
    Object.defineProperty(nfsProtocol, 'logger', {
      value: {
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      },
      writable: false,
    });
  });

  it('should throw error if df output is malformed', async () => {
    nfsProtocol['platform'] = 'linux';
    const response = { message: 'unexpected output' };

    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(response);

    await expect(nfsProtocol.getTotalUsedMemory(traceId, payload)).rejects.toThrow(
      /Unexpected df output/
    );
  });

  it('should handle linux platform with valid df output', async () => {
    nfsProtocol['platform'] = 'linux';
    const response = { message: '/dev/sda1 1000000 500000 400000 56% /mnt/test' };

    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(response);

    const result = await nfsProtocol.getTotalUsedMemory(traceId, payload);
    expect(result).toBe(500000);
  });

  it('should handle darwin platform with valid df output', async () => {
    nfsProtocol['platform'] = 'darwin';
    const response = { message: '/dev/disk1s1 1000000 500000 400000 56% /mnt/test' };

    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(response);

    const result = await nfsProtocol.getTotalUsedMemory(traceId, payload);
    expect(result).toBe(500000 * 1024); // darwin multiplies by 1024
  });

  it('should handle executeCommand errors', async () => {
    nfsProtocol['platform'] = 'linux';
    const errorMessage = 'Command execution failed';

    (nfsProtocol['executeCommand'] as jest.Mock).mockRejectedValue(new Error(errorMessage));

    await expect(nfsProtocol.getTotalUsedMemory(traceId, payload)).rejects.toThrow(
      /Command execution failed/
    );
  });

});

describe('NFSProtocol - getAvailableDiskSpace error handling', () => {
  let nfsProtocol: NFSProtocol;
  const traceId = 'test-trace-id';
  const payload: ProtocolPayload = {
    hostname: 'localhost',
    path: '/mnt/test',
  } as ProtocolPayload;

  beforeEach(() => {
    nfsProtocol = new NFSProtocol(loggerFactory);
    nfsProtocol['executeCommand'] = jest.fn();
    Object.defineProperty(nfsProtocol, 'logger', {
      value: {
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      },
      writable: false,
    });
  });

  it('should handle executeCommand errors', async () => {
    const errorMessage = 'Command execution failed';
    (nfsProtocol['executeCommand'] as jest.Mock).mockRejectedValue(new Error(errorMessage));

    await expect(nfsProtocol.getAvailableDiskSpace(traceId, payload)).rejects.toThrow(
      /Command execution failed/
    );
  });
});

describe('NFSProtocol - mountPath', () => {
  let nfsProtocol: NFSProtocol;
  const traceId = 'test-trace-id';
  const payload = {
    hostname: 'localhost',
    path: '/export/test',
    mountBasePath: '/mnt',
    jobRunId: 'job123',
    pathId: 'path456'
  };

  beforeEach(() => {
    nfsProtocol = new NFSProtocol(loggerFactory);
    nfsProtocol['executeCommand'] = jest.fn();
    nfsProtocol['updateBootMounts'] = jest.fn();
    nfsProtocol['workerId'] = 'test-worker';
    Object.defineProperty(nfsProtocol, 'logger', {
      value: {
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      },
      writable: false,
    });
  });

  it('should return error if directory already exists', async () => {
    const mockAccess = jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
    
    const result = await nfsProtocol.mountPath(traceId, payload, false);
    
    expect(result.status).toBe('error');
    expect(result.message).toContain('Directory already exists');
    mockAccess.mockRestore();
  });

  it('should create directory and mount successfully', async () => {
    const mockAccess = jest.spyOn(fs.promises, 'access').mockRejectedValue({ code: 'ENOENT' });
    const mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
    const mockResponse = { status: 'success', message: 'Mounted successfully' };
    
    // Mock setTimeout to avoid 5-second delay
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((cb) => cb()) as any;
    
    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(mockResponse);

    const result = await nfsProtocol.mountPath(traceId, payload, false);
    
    expect(mockMkdir).toHaveBeenCalledWith('/mnt/job123/path456', { recursive: true });
    expect(result).toBe(mockResponse);
    
    // Restore setTimeout
    global.setTimeout = originalSetTimeout;
    mockAccess.mockRestore();
    mockMkdir.mockRestore();
  });

  it('should handle mkdir error', async () => {
    const mockAccess = jest.spyOn(fs.promises, 'access').mockRejectedValue({ code: 'ENOENT' });
    const mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockRejectedValue(new Error('Permission denied'));
    
    const result = await nfsProtocol.mountPath(traceId, payload, false);
    
    expect(result.status).toBe('error');
    expect(result.message).toContain('Error creating directory');
    
    mockAccess.mockRestore();
    mockMkdir.mockRestore();
  });

  it('should call updateBootMounts when manageMount is true and mount is successful', async () => {
    const mockAccess = jest.spyOn(fs.promises, 'access').mockRejectedValue({ code: 'ENOENT' });
    const mockMkdir = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
    const mockResponse = { status: 'success', message: 'Mounted successfully' };
    
    // Mock setTimeout to avoid 5-second delay
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn((cb) => cb()) as any;
    
    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(mockResponse);

    await nfsProtocol.mountPath(traceId, payload, true);
    
    expect(nfsProtocol['updateBootMounts']).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: nfsProtocol['platform'],
        workerId: 'test-worker'
      }),
      expect.objectContaining({
        mountDir: '/mnt/job123/path456'
      }),
      'insert',
      traceId
    );
    
    // Restore setTimeout
    global.setTimeout = originalSetTimeout;
    mockAccess.mockRestore();
    mockMkdir.mockRestore();
  });
});

describe('NFSProtocol - updateBootMounts', () => {
  let nfsProtocol: NFSProtocol;
  const traceId = 'test-trace-id';
  const config = {
    platform: 'linux',
    fstabPath: '/etc/fstab',
    workerId: 'test-worker'
  };
  const payload = {
    hostname: 'localhost',
    path: '/export/test',
    mountDir: '/mnt/job123/path456'
  };

  beforeEach(() => {
    nfsProtocol = new NFSProtocol(loggerFactory);
    Object.defineProperty(nfsProtocol, 'logger', {
      value: {
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      },
      writable: false,
    });
  });

  it('should add entry to fstab when action is insert and entry does not exist', () => {
    const existingContent = '# /etc/fstab\n';
    const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue(existingContent);
    const mockAppendFileSync = jest.spyOn(fs, 'appendFileSync').mockImplementation();

    nfsProtocol.updateBootMounts(config, payload, 'insert', traceId);

    expect(mockAppendFileSync).toHaveBeenCalledWith(
      '/etc/fstab',
      'localhost:/export/test /mnt/job123/path456 nfs defaults 0 0\n'
    );

    mockReadFileSync.mockRestore();
    mockAppendFileSync.mockRestore();
  });

  it('should not add entry to fstab when action is insert and entry already exists', () => {
    const existingContent = 'localhost:/export/test /mnt/job123/path456 nfs defaults 0 0\n';
    const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue(existingContent);
    const mockAppendFileSync = jest.spyOn(fs, 'appendFileSync').mockImplementation();

    nfsProtocol.updateBootMounts(config, payload, 'insert', traceId);

    expect(mockAppendFileSync).not.toHaveBeenCalled();

    mockReadFileSync.mockRestore();
    mockAppendFileSync.mockRestore();
  });

  it('should remove entry from fstab when action is delete and entry exists', () => {
    // Include the exact entry that will be matched: "localhost:/export/test /mnt/job123/path456 nfs defaults 0 0\n"
    const existingContent = '# /etc/fstab\nlocalhost:/export/test /mnt/job123/path456 nfs defaults 0 0\nother:/path /mount nfs defaults 0 0\n';
    const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue(existingContent);
    const mockWriteFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation();

    nfsProtocol.updateBootMounts(config, payload, 'delete', traceId);

    // The actual result preserves the original newline structure
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/etc/fstab', 
      expect.stringContaining('# /etc/fstab')
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/etc/fstab', 
      expect.stringContaining('other:/path /mount nfs defaults 0 0')
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/etc/fstab', 
      expect.not.stringContaining('localhost:/export/test')
    );

    mockReadFileSync.mockRestore();
    mockWriteFileSync.mockRestore();
  });

  it('should not remove entry from fstab when action is delete and entry does not exist', () => {
    // Content without any trace of the target entry
    const existingContent = 'proc /proc proc defaults 0 0\ntmpfs /tmp tmpfs defaults 0 0\n';
    const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue(existingContent);
    const mockWriteFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation();

    nfsProtocol.updateBootMounts(config, payload, 'delete', traceId);

    expect(mockWriteFileSync).not.toHaveBeenCalled();

    mockReadFileSync.mockRestore();
    mockWriteFileSync.mockRestore();
  });

  it('should return error for unknown action', () => {
    const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue('# /etc/fstab\n');
    
    const result = nfsProtocol.updateBootMounts(config, payload, 'unknown', traceId);

    expect(result.status).toBe('error');
    expect(result.message).toContain('Unknown action: unknown');
    
    mockReadFileSync.mockRestore();
  });

  it('should handle file system errors', () => {
    const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = nfsProtocol.updateBootMounts(config, payload, 'insert', traceId);

    expect(result.status).toBe('error');
    expect(result.message).toContain('Error updating /etc/fstab: Permission denied');

    mockReadFileSync.mockRestore();
  });

  it('should skip processing when platform is not linux', () => {
    const configNonLinux = { ...config, platform: 'windows' };
    const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockImplementation();

    nfsProtocol.updateBootMounts(configNonLinux, payload, 'insert', traceId);

    expect(mockReadFileSync).not.toHaveBeenCalled();

    mockReadFileSync.mockRestore();
  });
});

describe('NFSProtocol - disconnectSession', () => {
  let nfsProtocol: NFSProtocol;

  beforeEach(() => {
    nfsProtocol = new NFSProtocol(loggerFactory);
  });

  it('should throw error for unimplemented method', () => {
    const payload: ProtocolPayload = { hostname: 'localhost', protocolVersion: '' };
    
    expect(() => nfsProtocol.disconnectSession('traceId', payload)).toThrow('Method not implemented.');
  });
});

describe('NFSProtocol - unmountPath error handling', () => {
  let nfsProtocol: NFSProtocol;
  const payload = {
    hostname: 'localhost',
    path: '/export/test',
    mountBasePath: '/mnt',
    jobRunId: 'job123',
    pathId: 'path456'
  };

  beforeEach(() => {
    nfsProtocol = new NFSProtocol(loggerFactory);
    nfsProtocol['executeCommand'] = jest.fn();
    nfsProtocol['updateBootMounts'] = jest.fn();
    nfsProtocol['workerId'] = 'test-worker';
    Object.defineProperty(nfsProtocol, 'logger', {
      value: {
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      },
      writable: false,
    });
  });

  it('should handle non-success response from executeCommand', async () => {
    const mockResponse = { status: 'error', message: 'Unmount failed' };
    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(mockResponse);

    const result = await nfsProtocol.unmountPath('traceId', payload, false);

    expect(result).toBeUndefined(); // Method returns undefined when status is not 'success'
  });

  it('should call updateBootMounts when manageMount is true', async () => {
    const mockResponse = { status: 'success', message: 'Unmounted successfully' };
    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(mockResponse);
    
    // Mock isPathExists to return false (directory doesn't exist)
    const { isPathExists } = require('src/activities/core/utils/utils');
    isPathExists.mockResolvedValue(false);

    await nfsProtocol.unmountPath('traceId', payload, true);

    expect(nfsProtocol['updateBootMounts']).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: nfsProtocol['platform'],
        workerId: 'test-worker'
      }),
      payload,
      'delete',
      'traceId'
    );
  });
});