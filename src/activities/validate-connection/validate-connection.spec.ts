import { WorkersConfig } from 'src/config/app.config';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { Logger } from 'src/logger/logger.service';
import { validate } from './validate-connection';

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
    SMB: 'SMB',
    FTP: 'FTP',
  },
}));

jest.mock('src/logger/logger.service');

describe('validate', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
  };
  (Logger as unknown as jest.Mock).mockImplementation(() => mockLogger);

  beforeEach(() => {
    jest.clearAllMocks();
    (WorkersConfig.get as jest.Mock).mockReturnValue('test-worker');
  });

  it('should validate connection and return paths and protocol versions', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn().mockResolvedValue(['/path1', '/path2']),
      getProtocolVersions: jest.fn().mockResolvedValue(['v1.0', 'v2.0']),
    };
    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const payload = { hostname: 'test-hostname', protocols: [] };
    const feature = { enablePreListPath: true, enableVersionFetch: true };

    const result = await validate('test-trace', 'SMB', payload, feature);

    expect(result).toEqual({
      traceId: 'test-trace',
      status: 'success',
      protocolType: 'SMB',
      hostname: 'test-hostname',
      workerId: 'test-worker',
      paths: ['/path1', '/path2'],
      protocolVersions: ['v1.0', 'v2.0'],
      message: '[SMB] Connection to test-hostname from test-worker validated successfully',
    });
    expect(mockProtocol.validateConnection).toHaveBeenCalledWith('test-trace', payload);
    expect(mockProtocol.listPaths).toHaveBeenCalledWith('test-trace', payload);
    expect(mockProtocol.getProtocolVersions).toHaveBeenCalledWith('test-trace', payload);
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it('should validate connection but not fetch paths or protocol versions if feature flags are disabled', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn().mockResolvedValue(['/path1', '/path2']),
      getProtocolVersions: jest.fn().mockResolvedValue(['v1.0', 'v2.0']),
    };
    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const payload = { hostname: 'test-hostname', protocols: [] };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const result = await validate('test-trace', 'SMB', payload, feature);

    expect(result).toEqual({
      traceId: 'test-trace',
      status: 'success',
      protocolType: 'SMB',
      hostname: 'test-hostname',
      workerId: 'test-worker',
      paths: [],
      protocolVersions: [],
      message: '[SMB] Connection to test-hostname from test-worker validated successfully',
    });
    expect(mockProtocol.validateConnection).toHaveBeenCalledWith('test-trace', payload);
    expect(mockProtocol.listPaths).not.toHaveBeenCalled();
    expect(mockProtocol.getProtocolVersions).not.toHaveBeenCalled();
  });

  it('should return an error response if protocol methods fail', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockRejectedValue(new Error('Mock validation error')),
      listPaths: jest.fn(),
      getProtocolVersions: jest.fn(),
    };
    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const feature = { enablePreListPath: true, enableVersionFetch: true };
    const result = await validate('test-trace', 'SMB', { hostname: 'test-hostname' }, feature);

    expect(result).toEqual({
      traceId: 'test-trace',
      status: 'error',
      protocolType: 'SMB',
      hostname: 'test-hostname',
      workerId: 'test-worker',
      paths: [],
      protocolVersions: [],
      message: 'Failed to validate connection for test-hostname of type SMB: Error: Mock validation error',
    });
  });
});
