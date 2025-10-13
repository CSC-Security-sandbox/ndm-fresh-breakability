import { ProtocolPayload } from './protocol.type';
import { mockLoggerFactory } from '../../auth/auth.service.spec';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

// Mock child_process and util before importing the Protocol class
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExecAsync = jest.fn();
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn(() => mockExecAsync),
}));

// Import Protocol after mocks are set up
import { Protocol } from './protocol';
const utilities = require('src/utils/utilities');

jest.mock('src/config/app.config', () => ({
  WorkersConfig: {
    get: jest.fn((key) => {
      switch (key) {
        case 'workerId':
          return 'test-worker-id';
        case 'baseMountDir':
          return '/test/base/mount/dir';
        case 'platform':
          return 'linux';
        default:
          return null;
      }
    }),
  },
}));

jest.mock('src/utils/utilities', () => ({
  sanitize: (input: string) => input, // bypass sanitization
}));

class TestProtocol extends Protocol {
  getTotalUsedMemory(traceId: string, payload: ProtocolPayload): Promise<any> {
    throw new Error('Method not implemented.');
  }
  getAvailableDiskSpace(traceId: string, payload: ProtocolPayload): Promise<any> {
    throw new Error('Method not implemented.');
  }
  disconnectSession(traceId: string, payload: ProtocolPayload): Promise<any> {
    throw new Error('Method not implemented.');
  }
  mountPath(traceId: string, payload: ProtocolPayload, manageMount: boolean): Promise<any> {
    return Promise.resolve([]);
  }
  unmountPath(traceId: string, payload: ProtocolPayload, manageMount: boolean): Promise<any> {
    return Promise.resolve([]);
  }
  listPaths(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    return Promise.resolve([]);
  }
  getProtocolVersions(traceId: string, payload: ProtocolPayload): Promise<string[]> {
    return Promise.resolve([]);
  }
  validateConnection(traceId: string, payload: ProtocolPayload): Promise<any> {
    return Promise.resolve();
  }
  updateBootMounts({ platform, fstabPath, workerId}, payload, action, traceId){
    return Promise.resolve();
  }
}

describe('Protocol', () => {
  let protocol: TestProtocol;

  beforeEach(() => {
    protocol = new TestProtocol(mockLoggerFactory as unknown as LoggerFactory);
    mockExecAsync.mockReset();
  });

  describe('executeCommand', () => {
    it('should execute command successfully', async () => {
      const payload: ProtocolPayload = {
        mountBasePath: '/test/mount',
        jobRunId: '123',
        pathId: '456',
        hostname: 'localhost',
        username: 'user',
        password: 'pass',
        protocolVersion: '1.0',
      };
      const commandPattern = 'echo ${HOST}';
      const commandDescription = 'Test command';
      
      mockExecAsync.mockResolvedValue({ stdout: 'Command executed successfully', stderr: '' });

      const response = await protocol.executeCommand('trace-123', 'test-protocol', payload, commandPattern, commandDescription);

      expect(response.status).toBe('success');
      expect(response.message).toContain('Command executed successfully');
    });

    it('should handle command execution stderr', async () => {
      const payload: ProtocolPayload = {
        hostname: 'localhost',
        protocolVersion: ''
      };
      const commandPattern = 'echo ${HOST}';
      const commandDescription = 'Test Command';

      mockExecAsync.mockResolvedValue({ stdout: '', stderr: 'Execution stderr' });

      await expect(
        protocol.executeCommand('traceId', 'TestProtocol', payload, commandPattern, commandDescription),
      ).rejects.toBeDefined();
    });

    it('should sanitize password in error message when exec throws error', async () => {
      const payload: ProtocolPayload = {
      mountBasePath: '/test/mount',
      jobRunId: '123',
      pathId: '456',
      hostname: 'localhost',
      username: 'user',
      password: 'secretPassword123',
      protocolVersion: '1.0',
      };
      const commandPattern = 'mount -t cifs //${HOST}/share ${DIR_PATH} -o username=${USERNAME},password=${PASSWORD}';
      const commandDescription = 'Mount command';
      
      // Mock sanitize to replace password
      utilities.sanitize = jest.fn((input: string, fields: string[]) => {
      let sanitized = input;
      fields.forEach(field => {
        sanitized = sanitized.replace(new RegExp(field, 'g'), '***');
      });
      return sanitized;
      });
      
      // Mock execAsync to throw an error containing the password
      const errorWithPassword = new Error('Authentication failed: Invalid password secretPassword123 for user');
      mockExecAsync.mockRejectedValue(errorWithPassword);

      await expect(
      protocol.executeCommand('trace-123', 'test-protocol', payload, commandPattern, commandDescription)
      ).rejects.toThrow('Authentication failed: Invalid password *** for ***');
    });
  });
});
