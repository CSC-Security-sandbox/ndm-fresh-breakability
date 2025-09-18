import { NFSProtocol } from './nfs.protocol';
import { ProtocolPayload } from 'src/protocols/protocol/protocol.type';
import * as net from 'net';
import {
  handleConnectionError,
  parseExports,
  parseProtocolVersions,
} from './nfs.utils';
import { ConfigService } from '@nestjs/config';
import { WorkersConfig } from 'src/config/app.config';
import { CommandConfig } from 'src/config/command.config';
import { Logger, Runtime, RuntimeOptions } from '@temporalio/worker';
import { ProtocolTypes } from '../protocols';
import { CommandPattern } from 'src/config/command.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from 'src/auth/auth.service.spec';
import { Test, TestingModule } from '@nestjs/testing';
import { mockLogger } from 'src/auth/auth.service.spec';
import * as fs from 'fs';
import { isPathExists } from 'src/activities/core/utils/utils';

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
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    loggerFactory = module.get<LoggerFactory>(LoggerFactory);

    jest
      .spyOn(Runtime, 'install')
      .mockImplementation((options: RuntimeOptions) => {
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
        protocolVersion: '',
      };
      const result = await nfsProtocol.validateConnection('traceId', options);

      expect(result).toBe('Connection established');
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[traceId] Attempting to connect... Protocol: NFS',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[traceId] Connection established for Protocol: NFS',
      );
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
        protocolVersion: '',
      };

      await expect(
        nfsProtocol.validateConnection('traceId', options),
      ).rejects.toThrow('Handled connection error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during connection: Connection error',
      );
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
        protocolVersion: '',
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
        protocolVersion: '',
      };
      const mockResponse = { message: 'NFSv3\nNFSv4' };
      (nfsProtocol as any).executeCommand = jest
        .fn()
        .mockResolvedValue(mockResponse);
      (parseProtocolVersions as any).mockReturnValue(['NFSv3', 'NFSv4']);

      const result = await nfsProtocol.getProtocolVersions('traceId', payload);

      expect(result).toEqual(['NFSv3', 'NFSv4']);
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[traceId] Getting protocols for localhost of type NFS from test-worker',
      );
      expect(mockLogger.log).toHaveBeenCalledWith('[traceId] NFSv3\nNFSv4');
    });
  });

  describe('listPaths', () => {
    it('should list paths successfully', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: '',
      };
      const mockResponse = { message: '/export/path1\n/export/path2' };
      (nfsProtocol as any).executeCommand = jest
        .fn()
        .mockResolvedValue(mockResponse);
      (parseExports as any).mockReturnValue(['/export/path1', '/export/path2']);

      const result = await nfsProtocol.listPaths('traceId', payload);

      expect(result).toEqual(['/export/path1', '/export/path2']);
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[traceId] Getting list paths for localhost of type NFS from test-worker',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[traceId] /export/path1\n/export/path2',
      );
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
        pathId: 'path456',
      };
      const mockResponse = {
        message: 'Successfully unmounted',
        status: 'success',
      };
      (nfsProtocol as any).executeCommand = jest
        .fn()
        .mockResolvedValue(mockResponse);
      (isPathExists as jest.Mock).mockResolvedValue(true);

      // Mock fs.promises.rmdir
      const mockRmdir = jest
        .spyOn(fs.promises, 'rmdir')
        .mockResolvedValue(undefined);

      const result = await nfsProtocol.unmountPath('traceId', payload, false);

      expect(mockLogger.log).toHaveBeenCalled();
      expect(isPathExists).toHaveBeenCalledWith('/mnt/job123/path456');
      expect(mockRmdir).toHaveBeenCalledWith('/mnt/job123/path456', {
        recursive: true,
      });
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
        pathId: 'path456',
      };
      const mockResponse = {
        message: 'Successfully unmounted',
        status: 'success',
      };
      (nfsProtocol as any).executeCommand = jest
        .fn()
        .mockResolvedValue(mockResponse);
      (isPathExists as jest.Mock).mockResolvedValue(false);

      // Mock fs.promises.rmdir
      const mockRmdir = jest
        .spyOn(fs.promises, 'rmdir')
        .mockResolvedValue(undefined);

      const result = await nfsProtocol.unmountPath('traceId', payload, false);

      expect(mockLogger.log).toHaveBeenCalled();
      expect(isPathExists).toHaveBeenCalledWith('/mnt/job123/path456');
      expect(mockRmdir).not.toHaveBeenCalled(); // Should not be called when directory doesn't exist
      expect(result).toBe(mockResponse);

      // Restore the mocks
      mockRmdir.mockRestore();
    });
  });

  describe('NFSProtocol - getAvailableDiskSpace', () => {
    let nfsProtocol: NFSProtocol;
    let loggerMock: jest.Mocked<Logger>;

    const mockTraceId = 'test-trace-id';
    const mockPayload: ProtocolPayload = {
      hostname: 'test-host',
      username: 'test-user',
      protocolVersion: '4.2',
      path: '/test/path',
    };

    beforeEach(async () => {
      loggerMock = {
        log: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      } as unknown as jest.Mocked<Logger>;

      nfsProtocol = new NFSProtocol(loggerFactory);
      (nfsProtocol as any).logger = loggerMock;
      (nfsProtocol as any).platform = 'linux';
      (nfsProtocol as any).workerId = 'test-worker-id';

      jest.spyOn(nfsProtocol as any, 'executeCommand').mockImplementation();
      jest
        .spyOn(nfsProtocol as any, 'getCommandPattern')
        .mockReturnValue('mock-command-pattern');
      jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully return available disk space', async () => {
      const mockResponse = { message: '1024000' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);

      const result = await nfsProtocol.getAvailableDiskSpace(
        mockTraceId,
        mockPayload,
      );

      expect((nfsProtocol as any).executeCommand).toHaveBeenCalledWith(
        mockTraceId,
        ProtocolTypes.NFS,
        mockPayload,
        'mock-command-pattern',
        'NFS path Available Disk Space',
      );

      expect((nfsProtocol as any).getCommandPattern).toHaveBeenCalledWith(
        CommandPattern.AVAILABLE_DISK_SPACE,
      );

      expect(loggerMock.log).toHaveBeenCalledWith(
        `[${mockTraceId}] Checking available disk space at path: ${mockPayload.path}`,
      );
      expect(loggerMock.log).toHaveBeenCalledWith(
        `[${mockTraceId}] ${mockResponse.message}`,
      );
      expect(loggerMock.log).toHaveBeenCalledWith(
        `[${mockTraceId}] Available space at ${mockPayload.path}: 1024000 bytes`,
      );

      expect(loggerMock.log).toHaveBeenCalledWith(
        `response of getAvailableDiskSpace in nfs.protocol ${JSON.stringify(mockResponse)}`,
      );
      expect(result).toEqual({ size: 1024000 });
    });

    it('should handle string with whitespace', async () => {
      const mockResponse = { message: '  2048000  ' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);

      const result = await nfsProtocol.getAvailableDiskSpace(
        mockTraceId,
        mockPayload,
      );
      expect(result).toEqual({ size: 2048000 });
    });

    it('should handle undefined path in payload', async () => {
      const payloadWithoutPath: ProtocolPayload = {
        hostname: 'test-host',
        username: 'test-user',
        protocolVersion: '4.2',
      };

      const mockResponse = { message: '3072000' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);

      const result = await nfsProtocol.getAvailableDiskSpace(
        mockTraceId,
        payloadWithoutPath,
      );

      expect(loggerMock.log).toHaveBeenCalledWith(
        `[${mockTraceId}] Checking available disk space at path: undefined`,
      );
      expect(loggerMock.log).toHaveBeenCalledWith(
        `[${mockTraceId}] Available space at undefined: 3072000 bytes`,
      );

      expect(result).toEqual({ size: 3072000 });
    });

    it('should handle non-numeric response from executeCommand', async () => {
      const mockResponse = { message: 'not a number' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);

      const result = await nfsProtocol.getAvailableDiskSpace(
        mockTraceId,
        mockPayload,
      );
      expect(result.size).toBeNaN();
    });

    it('should handle empty response from executeCommand', async () => {
      const mockResponse = { message: '' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);

      const result = await nfsProtocol.getAvailableDiskSpace(
        mockTraceId,
        mockPayload,
      );
      expect(result.size).toBeNaN();
    });

    it('should gracefully handle null response', async () => {
      (nfsProtocol as any).executeCommand.mockResolvedValue(null);

      await expect(
        nfsProtocol.getAvailableDiskSpace(mockTraceId, mockPayload),
      ).rejects.toThrow();
    });

    it('should correctly get command pattern for disk space', async () => {
      const mockResponse = { message: '1024000' };
      (nfsProtocol as any).executeCommand.mockResolvedValue(mockResponse);

      await nfsProtocol.getAvailableDiskSpace(mockTraceId, mockPayload);

      expect((nfsProtocol as any).getCommandPattern).toHaveBeenCalledWith(
        CommandPattern.AVAILABLE_DISK_SPACE,
      );
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

  it('should successfully return total used memory for Linux', async () => {
    nfsProtocol['platform'] = 'linux';
    const response = {
      message: '/dev/sda1 1000000 500000 450000 53% /mnt/test',
    };

    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(response);

    const result = await nfsProtocol.getTotalUsedMemory(traceId, payload);

    expect(result).toBe(500000);
    expect(nfsProtocol['logger'].log).toHaveBeenCalledWith(
      `[${traceId}] Checking total size of a mounted path: ${payload.path}`,
    );
    expect(nfsProtocol['logger'].log).toHaveBeenCalledWith(
      `[${traceId}] Calculated data size for ${payload.path}: 500000 bytes`,
    );
  });

  it('should successfully return total used memory for Darwin (macOS)', async () => {
    nfsProtocol['platform'] = 'darwin';
    const response = {
      message: '/dev/disk1 2000000 1000000 900000 53% /mnt/test',
    };

    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(response);

    const result = await nfsProtocol.getTotalUsedMemory(traceId, payload);

    expect(result).toBe(1024000000); // 1000000 * 1024
    expect(nfsProtocol['logger'].log).toHaveBeenCalledWith(
      `[${traceId}] Checking total size of a mounted path: ${payload.path}`,
    );
    expect(nfsProtocol['logger'].log).toHaveBeenCalledWith(
      `[${traceId}] Calculated data size for ${payload.path}: 1024000000 bytes`,
    );
  });

  it('should throw error if df output is malformed', async () => {
    nfsProtocol['platform'] = 'linux';
    const response = { message: 'unexpected output' };

    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(response);

    await expect(
      nfsProtocol.getTotalUsedMemory(traceId, payload),
    ).rejects.toThrow(/Unexpected df output/);
  });

  it('should handle error in getTotalUsedMemory', async () => {
    const errorMessage = 'Command execution failed';
    (nfsProtocol['executeCommand'] as jest.Mock).mockRejectedValue(
      new Error(errorMessage),
    );

    await expect(
      nfsProtocol.getTotalUsedMemory(traceId, payload),
    ).rejects.toThrow(errorMessage);
    // The error logging happens in the catch block, but since executeCommand is in a Promise chain
    // the error is propagated directly without going through the catch
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

  it('should handle error in getAvailableDiskSpace', async () => {
    const errorMessage = 'Command execution failed';
    (nfsProtocol['executeCommand'] as jest.Mock).mockRejectedValue(
      new Error(errorMessage),
    );

    await expect(
      nfsProtocol.getAvailableDiskSpace(traceId, payload),
    ).rejects.toThrow(errorMessage);
    // The error logging happens in the catch block, but since executeCommand is in a Promise chain
    // the error is propagated directly without going through the catch
  });
});

describe('NFSProtocol - mountPath', () => {
  let nfsProtocol: NFSProtocol;
  const traceId = 'test-trace-id';
  const payload = {
    hostname: 'localhost',
    path: '/export/path',
    mountBasePath: '/mnt',
    jobRunId: 'job123',
    pathId: 'path456',
  };

  beforeEach(() => {
    // Use real timers to avoid timeout issues
    jest.useRealTimers();
    nfsProtocol = new NFSProtocol(loggerFactory);
    nfsProtocol['executeCommand'] = jest.fn();
    nfsProtocol['updateBootMounts'] = jest.fn();
    Object.defineProperty(nfsProtocol, 'logger', {
      value: {
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      },
      writable: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should handle directory already exists error', async () => {
    const mockAccess = jest
      .spyOn(fs.promises, 'access')
      .mockResolvedValue(undefined);

    const result = await nfsProtocol.mountPath(traceId, payload, false);

    expect(result).toEqual({
      traceId,
      status: 'error',
      protocolType: 'NFS',
      hostname: payload.hostname,
      workerId: 'test-worker',
      message: `[${traceId}] Directory already exists: /mnt/job123/path456`,
    });

    mockAccess.mockRestore();
  });

  it('should create directory and mount successfully', async () => {
    const mockAccess = jest
      .spyOn(fs.promises, 'access')
      .mockRejectedValue({ code: 'ENOENT' });
    const mockMkdir = jest
      .spyOn(fs.promises, 'mkdir')
      .mockResolvedValue(undefined);
    const mockResponse = { status: 'success', message: 'Mounted successfully' };
    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(
      mockResponse,
    );

    const result = await nfsProtocol.mountPath(traceId, payload, true);

    expect(mockAccess).toHaveBeenCalledWith(
      '/mnt/job123/path456',
      fs.constants.F_OK,
    );
    expect(mockMkdir).toHaveBeenCalledWith('/mnt/job123/path456', {
      recursive: true,
    });
    expect(nfsProtocol['updateBootMounts']).toHaveBeenCalledWith(
      {
        platform: nfsProtocol['platform'],
        fstabPath: 'test-worker',
        workerId: nfsProtocol['workerId'],
      },
      { ...payload, mountDir: '/mnt/job123/path456' },
      'insert',
      traceId,
    );
    expect(result).toBe(mockResponse);

    mockAccess.mockRestore();
    mockMkdir.mockRestore();
  }, 15000);

  it('should handle mkdir error', async () => {
    const mockAccess = jest
      .spyOn(fs.promises, 'access')
      .mockRejectedValue({ code: 'ENOENT' });
    const mkdirError = new Error('Permission denied');
    const mockMkdir = jest
      .spyOn(fs.promises, 'mkdir')
      .mockRejectedValue(mkdirError);

    const result = await nfsProtocol.mountPath(traceId, payload, false);

    expect(result).toEqual({
      traceId,
      status: 'error',
      protocolType: 'NFS',
      hostname: payload.hostname,
      workerId: 'test-worker',
      message: `[${traceId}] Error creating directory: Permission denied`,
    });

    mockAccess.mockRestore();
    mockMkdir.mockRestore();
  });

  it('should not call updateBootMounts when manageMount is false', async () => {
    const mockAccess = jest
      .spyOn(fs.promises, 'access')
      .mockRejectedValue({ code: 'ENOENT' });
    const mockMkdir = jest
      .spyOn(fs.promises, 'mkdir')
      .mockResolvedValue(undefined);
    const mockResponse = { status: 'success', message: 'Mounted successfully' };
    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(
      mockResponse,
    );

    const result = await nfsProtocol.mountPath(traceId, payload, false);

    expect(nfsProtocol['updateBootMounts']).not.toHaveBeenCalled();
    expect(result).toBe(mockResponse);

    mockAccess.mockRestore();
    mockMkdir.mockRestore();
  }, 15000);
});

describe('NFSProtocol - updateBootMounts', () => {
  let nfsProtocol: NFSProtocol;
  const traceId = 'test-trace-id';
  const payload = {
    hostname: 'localhost',
    path: '/export/path',
    mountDir: '/mnt/job123/path456',
  };
  const context = {
    platform: 'linux',
    fstabPath: '/etc/fstab',
    workerId: 'test-worker',
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

  it('should insert entry when action is insert and entry does not exist', () => {
    const mockReadFileSync = jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('existing content\n');
    const mockAppendFileSync = jest
      .spyOn(fs, 'appendFileSync')
      .mockImplementation();

    nfsProtocol.updateBootMounts(context, payload, 'insert', traceId);

    expect(mockReadFileSync).toHaveBeenCalledWith('/etc/fstab', 'utf-8');
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      '/etc/fstab',
      `${payload.hostname}:${payload.path} ${payload.mountDir} nfs defaults 0 0\n`,
    );
    expect(nfsProtocol['logger'].log).toHaveBeenCalledWith(
      `[${traceId}] Added entry to /etc/fstab`,
    );

    mockReadFileSync.mockRestore();
    mockAppendFileSync.mockRestore();
  });

  it('should not insert entry when entry already exists', () => {
    const existingContent = `${payload.hostname}:${payload.path} ${payload.mountDir} nfs defaults 0 0\n`;
    const mockReadFileSync = jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(existingContent);
    const mockAppendFileSync = jest
      .spyOn(fs, 'appendFileSync')
      .mockImplementation();

    nfsProtocol.updateBootMounts(context, payload, 'insert', traceId);

    expect(mockReadFileSync).toHaveBeenCalledWith('/etc/fstab', 'utf-8');
    expect(mockAppendFileSync).not.toHaveBeenCalled();
    expect(nfsProtocol['logger'].log).toHaveBeenCalledWith(
      `[${traceId}] Entry already exists in /etc/fstab`,
    );

    mockReadFileSync.mockRestore();
    mockAppendFileSync.mockRestore();
  });

  it('should delete entry when action is delete and entry exists', () => {
    const fstabEntry = `${payload.hostname}:${payload.path} ${payload.mountDir} nfs defaults 0 0`;
    const existingContent = `other entry\n${fstabEntry}\nanother entry`;
    const mockReadFileSync = jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(existingContent);
    const mockWriteFileSync = jest
      .spyOn(fs, 'writeFileSync')
      .mockImplementation();

    nfsProtocol.updateBootMounts(context, payload, 'delete', traceId);

    const expectedContent = `other entry\nanother entry`;
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/etc/fstab',
      expectedContent,
    );
    expect(nfsProtocol['logger'].log).toHaveBeenCalledWith(
      `[${traceId}] Removed entry from /etc/fstab`,
    );

    mockReadFileSync.mockRestore();
    mockWriteFileSync.mockRestore();
  });

  it('should not delete entry when entry does not exist', () => {
    const mockReadFileSync = jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('other content');
    const mockWriteFileSync = jest
      .spyOn(fs, 'writeFileSync')
      .mockImplementation();

    nfsProtocol.updateBootMounts(context, payload, 'delete', traceId);

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(nfsProtocol['logger'].log).toHaveBeenCalledWith(
      `[${traceId}] Entry not found in /etc/fstab`,
    );

    mockReadFileSync.mockRestore();
    mockWriteFileSync.mockRestore();
  });

  it('should handle unknown action', () => {
    const mockReadFileSync = jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('content');

    const result = nfsProtocol.updateBootMounts(
      context,
      payload,
      'unknown',
      traceId,
    );

    expect(result).toEqual({
      traceId,
      status: 'error',
      protocolType: 'NFS',
      hostname: payload.hostname,
      workerId: context.workerId,
      message: `[${traceId}] Unknown action: unknown`,
    });
    expect(nfsProtocol['logger'].error).toHaveBeenCalledWith(
      `[${traceId}] Unknown action: unknown`,
    );

    mockReadFileSync.mockRestore();
  });

  it('should handle file system errors', () => {
    const mockReadFileSync = jest
      .spyOn(fs, 'readFileSync')
      .mockImplementation(() => {
        throw new Error('File not found');
      });

    const result = nfsProtocol.updateBootMounts(
      context,
      payload,
      'insert',
      traceId,
    );

    expect(result).toEqual({
      traceId,
      status: 'error',
      protocolType: 'NFS',
      hostname: payload.hostname,
      workerId: context.workerId,
      message: `[${traceId}] Error updating /etc/fstab: File not found`,
    });
    expect(nfsProtocol['logger'].error).toHaveBeenCalledWith(
      `[${traceId}] Error updating /etc/fstab: File not found`,
    );

    mockReadFileSync.mockRestore();
  });

  it('should skip processing for non-linux platforms', () => {
    const nonLinuxContext = { ...context, platform: 'darwin' };
    const mockReadFileSync = jest.spyOn(fs, 'readFileSync');

    nfsProtocol.updateBootMounts(nonLinuxContext, payload, 'insert', traceId);

    expect(mockReadFileSync).not.toHaveBeenCalled();

    mockReadFileSync.mockRestore();
  });
});

describe('NFSProtocol - unmountPath with manageMount', () => {
  let nfsProtocol: NFSProtocol;
  const traceId = 'test-trace-id';
  const payload = {
    hostname: 'localhost',
    path: '/export/path',
    mountBasePath: '/mnt',
    jobRunId: 'job123',
    pathId: 'path456',
  };

  beforeEach(() => {
    nfsProtocol = new NFSProtocol(loggerFactory);
    nfsProtocol['executeCommand'] = jest.fn();
    nfsProtocol['updateBootMounts'] = jest.fn();
    Object.defineProperty(nfsProtocol, 'logger', {
      value: {
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      },
      writable: false,
    });
  });

  it('should call updateBootMounts when manageMount is true and unmount is successful', async () => {
    const mockResponse = {
      status: 'success',
      message: 'Successfully unmounted',
    };
    (nfsProtocol['executeCommand'] as jest.Mock).mockResolvedValue(
      mockResponse,
    );

    const mockAccess = jest
      .spyOn(fs.promises, 'access')
      .mockResolvedValue(undefined);
    const mockRmdir = jest
      .spyOn(fs.promises, 'rmdir')
      .mockResolvedValue(undefined);

    const result = await nfsProtocol.unmountPath(traceId, payload, true);

    expect(nfsProtocol['updateBootMounts']).toHaveBeenCalledWith(
      {
        platform: nfsProtocol['platform'],
        fstabPath: 'test-worker',
        workerId: nfsProtocol['workerId'],
      },
      payload,
      'delete',
      traceId,
    );
    expect(result).toBe(mockResponse);

    mockAccess.mockRestore();
    mockRmdir.mockRestore();
  });
});

describe('NFSProtocol - getFstabPath', () => {
  let nfsProtocol: NFSProtocol;

  beforeEach(() => {
    nfsProtocol = new NFSProtocol(loggerFactory);
  });

  it('should call CommandConfig.getFstabPath', () => {
    const mockGetFstabPath = jest
      .spyOn(CommandConfig, 'getFstabPath')
      .mockReturnValue('/etc/fstab');
    nfsProtocol['platform'] = 'linux';

    const result = nfsProtocol['getFstabPath']('test-path');

    expect(mockGetFstabPath).toHaveBeenCalledWith('linux', 'test-path');
    expect(result).toBe('/etc/fstab');

    mockGetFstabPath.mockRestore();
  });
});

describe('NFSProtocol - disconnectSession', () => {
  let nfsProtocol: NFSProtocol;

  beforeEach(() => {
    nfsProtocol = new NFSProtocol(loggerFactory);
  });

  it('should throw "Method not implemented." error', () => {
    const traceId = 'test-trace-id';
    const payload: ProtocolPayload = {
      hostname: 'localhost',
      protocolVersion: '',
    };

    expect(() => nfsProtocol.disconnectSession(traceId, payload)).toThrow(
      'Method not implemented.',
    );
  });
});
