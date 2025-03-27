import { NFSProtocol } from './nfs.protocol';
import { ProtocolPayload } from 'src/protocols/protocol/protocol.type';
import * as net from 'net';
import { handleConnectionError, parseExports, parseProtocolVersions } from './nfs.utils';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { WorkersConfig } from 'src/config/app.config';
import { CommandConfig } from 'src/config/command.config';
import { Logger, Runtime, RuntimeOptions } from '@temporalio/worker';

jest.mock('net');
jest.mock('./nfs.utils');

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
});