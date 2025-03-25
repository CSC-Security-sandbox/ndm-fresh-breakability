import { Test, TestingModule } from '@nestjs/testing';
import { ListPathActivity } from './list-path.service';
import { ConfigService } from '@nestjs/config';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Logger } from '@nestjs/common';

jest.mock('src/protocols/protocols'); // Mock Protocols module

describe('ListPathActivity', () => {
  let service: ListPathActivity;
  let mockConfigService: Partial<ConfigService>;
  let mockLogger: { log: jest.Mock };

  beforeEach(async () => {
    mockLogger = { log: jest.fn() };
    mockConfigService = {
      get: jest.fn().mockReturnValue('test-worker-id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListPathActivity,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ListPathActivity>(ListPathActivity);
  });

  it('should list paths successfully', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };

    const mockProtocol = {
      listPaths: jest.fn().mockResolvedValue(['path1', 'path2']),
    };

    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.listPath(traceId, protocolType, payload);

    expect(response.status).toBe('success');
    expect(response.paths).toEqual(['path1', 'path2']);
    expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] List Path for ${payload.hostname} of type ${protocolType} from test-worker-id`);
  });

  it('should handle error when listing paths', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };

    const mockProtocol = {
      listPaths: jest.fn().mockRejectedValue(new Error('List paths error')),
    };

    (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.listPath(traceId, protocolType, payload);

    expect(response.status).toBe('error');
    expect(response.message).toContain('Failed to List Path for localhost of type HTTP: Error: List paths error');
  });
}); 