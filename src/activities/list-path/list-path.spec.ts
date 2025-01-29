import { listPath } from './list-path';
import { WorkersConfig } from 'src/config/app.config';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { Logger } from 'src/logger/logger.service';

jest.mock('src/config/app.config', () => ({
  WorkersConfig: {
    get: jest.fn(),
  },
}));

jest.mock('src/protocols/protocols', () => ({
  Protocols: {
    getProtocol: jest.fn(),
  },
  ProtocolTypes: {
    HTTP: 'HTTP',
    FTP: 'FTP',
  },
}));

jest.mock('src/logger/logger.service');

describe('listPath', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
  };
  (Logger as unknown as jest.Mock).mockImplementation(() => mockLogger);

  beforeEach(() => {
    jest.clearAllMocks();
    (WorkersConfig.get as jest.Mock).mockReturnValue('test-worker');
  });

  it('should list paths successfully', async () => {
    const mockProtocol = {
      listPaths: jest.fn().mockResolvedValue(['/path1', '/path2']),
    };
    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const payload = { hostname: 'test-hostname', protocols: [] };
    const result = await listPath('test-trace', 'SMB', payload);

    expect(result).toEqual({
      traceId: 'test-trace',
      status: 'success',
      protocolType: 'SMB',
      hostname: 'test-hostname',
      workerId: 'test-worker',
      paths: ['/path1', '/path2'],
      message: '[SMB] Connection to test-hostname from test-worker validated successfully',
    });
    expect(mockLogger.info).toHaveBeenCalled();
    expect(mockProtocol.listPaths).toHaveBeenCalledWith('test-trace', payload);
  });

  it('should return an error response if protocol.listPaths fails', async () => {
    const mockProtocol = {
      listPaths: jest.fn().mockRejectedValue(new Error('Mock error')),
    };
    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const result = await listPath('test-trace', 'SMB', { hostname: 'test-hostname' });

    expect(result).toEqual({
      traceId: 'test-trace',
      status: 'error',
      protocolType: 'SMB',
      hostname: 'test-hostname',
      workerId: 'test-worker',
      paths: [],
      message: 'Failed to List Path for test-hostname of type SMB: Error: Mock error',
    });
  });
});
