import { Protocol } from './protocol';
import { exec } from 'child_process';
import { WorkersConfig } from 'src/config/app.config';
import { Logger } from 'src/logger/logger.service';
import { ProtocolPayload } from './protocol.type';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('src/config/app.config', () => ({
  WorkersConfig: {
    get: jest.fn(),
  },
}));

jest.mock('src/logger/logger.service', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
  })),
}));

class TestProtocol extends Protocol {
  listPaths(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    return Promise.resolve([]);
  }
  getProtocolVersions(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    return Promise.resolve([]);
  }
  validateConnection(traceId: string, payload: ProtocolPayload): Promise<any> {
    return Promise.resolve();
  }
}

describe('Protocol', () => {
  let protocol: TestProtocol;
  let mockLogger: any;

  beforeEach(() => {
    (WorkersConfig.get as jest.Mock).mockImplementation((key: string) => {
      switch (key) {
        case 'workerId':
          return 'test-worker';
        case 'baseMountDir':
          return '/mnt';
        case 'platform':
          return 'linux';
        default:
          return null;
      }
    });

    protocol = new TestProtocol();
    mockLogger = (protocol as any).logger;
  });

  describe('executeCommand', () => {
    it('should execute command successfully', async () => {
      const payload: ProtocolPayload = { hostname: 'localhost' };
      const commandPattern = 'echo ${HOST}';
      const commandDescription = 'Test Command';
      (exec as unknown as jest.Mock).mockImplementation((command, callback) => {
        callback(null, 'Command executed successfully', '');
      });

      const result = await protocol.executeCommand('traceId', 'TestProtocol', payload, commandPattern, commandDescription);

      expect(result).toEqual({
        traceId: 'traceId',
        status: 'success',
        protocolType: 'TestProtocol',
        hostname: 'localhost',
        workerId: 'test-worker',
        message: 'Command executed successfully',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[traceId] command: echo localhost, stdout: Command executed successfully, stderr: , error: null',
      );
    });

    it('should handle command execution error', async () => {
      const payload: ProtocolPayload = { hostname: 'localhost' };
      const commandPattern = 'echo ${HOST}';
      const commandDescription = 'Test Command';

      (exec as unknown as jest.Mock).mockImplementation((command, callback) => {
        callback(new Error('Execution error'), '', '');
      });

      await expect(
        protocol.executeCommand('traceId', 'TestProtocol', payload, commandPattern, commandDescription),
      ).rejects.toThrow('Execution error');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[traceId] command: echo localhost, stdout: , stderr: , error: Error: Execution error',
      );
    });

    it('should handle command execution stderr', async () => {
      const payload: ProtocolPayload = { hostname: 'localhost' };
      const commandPattern = 'echo ${HOST}';
      const commandDescription = 'Test Command';

      (exec as unknown as jest.Mock).mockImplementation((command, callback) => {
        callback(null, '', 'Execution stderr');
      });

      await expect(
        protocol.executeCommand('traceId', 'TestProtocol', payload, commandPattern, commandDescription),
      ).rejects.toBe('Execution stderr');

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[traceId] command: echo localhost, stdout: , stderr: Execution stderr, error: null',
      );
    });
  });
});