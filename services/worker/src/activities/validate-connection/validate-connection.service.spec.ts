import { Test, TestingModule } from '@nestjs/testing';
import { ValidateConnectionActivity } from './validate-connection.service';
import { ConfigService } from '@nestjs/config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { Logger } from '@nestjs/common';

jest.mock('src/protocols/protocols'); // Mock Protocols module

describe('ValidateConnectionActivity', () => {
  let service: ValidateConnectionActivity;
  let mockConfigService: Partial<ConfigService>;
  let mockLogger: { log: jest.Mock };

  beforeEach(async () => {
    mockLogger = { log: jest.fn() };
    mockConfigService = {
      get: jest.fn().mockReturnValue('test-worker-id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateConnectionActivity,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ValidateConnectionActivity>(ValidateConnectionActivity);
  });

  it('should validate connection successfully and fetch paths and versions', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: true, enableVersionFetch: true };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn().mockResolvedValue(['path1', 'path2']),
      getProtocolVersions: jest.fn().mockResolvedValue(['v1', 'v2']),
    };

    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('success');
    expect(response.paths).toEqual(['path1', 'path2']);
    expect(response.protocolVersions).toEqual(['v1', 'v2']);
    expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Validating connection for ${payload.hostname} of type ${protocolType} from test-worker-id`);
  });

  it('should validate connection successfully without fetching paths and versions', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn(),
      getProtocolVersions: jest.fn(),
    };

    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('success');
    expect(response.paths).toEqual([]);
    expect(response.protocolVersions).toEqual([]);
  });

  it('should handle error during validation', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockRejectedValue(new Error('Validation error')),
    };

    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('error');
    expect(response.message).toContain('Failed to validate connection for localhost of type HTTP: Error: Validation error');
  });

  it('should handle error when fetching paths', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: true, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn().mockRejectedValue(new Error('Fetch paths error')),
    };

    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('error');
    expect(response.message).toContain('Failed to validate connection for localhost of type HTTP: Error: Fetch paths error');
  });

  it('should handle error when fetching protocol versions', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: true };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      getProtocolVersions: jest.fn().mockRejectedValue(new Error('Fetch versions error')),
    };

    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('error');
    expect(response.message).toContain('Failed to validate connection for localhost of type HTTP: Error: Fetch versions error');
  });
}); 