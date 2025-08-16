import { Test, TestingModule } from '@nestjs/testing';
import { ValidateConnectionActivity } from './validate-connection.service';
import { ConfigService } from '@nestjs/config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';

jest.mock('src/protocols/protocols'); // Mock Protocols module

describe('ValidateConnectionActivity', () => {
  let service: ValidateConnectionActivity;
  let mockConfigService: Partial<ConfigService>;
  let protocols: Protocols;
  let configService: ConfigService;
  let loggerFactory: LoggerFactory;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn().mockReturnValue('test-worker-id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateConnectionActivity,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLogger),
          },
        },
        {
          provide: Protocols,
          useValue: {
            getProtocol: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ValidateConnectionActivity>(ValidateConnectionActivity);
    configService = module.get<ConfigService>(ConfigService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    protocols = module.get<Protocols>(Protocols);
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

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

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

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

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

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

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

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

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

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('error');
    expect(response.message).toContain('Failed to validate connection for localhost of type HTTP: Error: Fetch versions error');
  });
}); 