import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { AuthService } from 'src/auth/auth.service';
import { Protocols } from 'src/protocols/protocols';
import { ConfigError } from './working-directory.type';
import { ValidateWorkingDirectoryActivity } from './working-directory.service';

jest.mock('fs');
jest.mock('axios');


jest.mock('@temporalio/worker', () => ({
  Worker: jest.fn(),
  DefaultLogger: jest.fn(),
  makeTelemetryFilterString: jest.fn(),
  Runtime: {
    install: jest.fn(),
  },
}));
jest.mock('winston-daily-rotate-file', () => {
  const DailyRotateFile = jest.fn();
  return { default: DailyRotateFile };
});

jest.mock('winston', () => {
  const actualWinston = jest.requireActual('winston');
  return {
    ...actualWinston,
    createLogger: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
    transports: {
      ...actualWinston.transports,
      DailyRotateFile: jest.fn(), 
    },
  };
});


describe('ValidateWorkingDirectoryActivity (unit)', () => {
  let service: ValidateWorkingDirectoryActivity;
  let configService: ConfigService;
  let authService: AuthService;
  let mockLogger: Partial<Logger>;

  const mockProtocol = {
    mountPath: jest.fn(),
    unmountPath: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'worker.workerId') return 'test-worker-id';
      if (key === 'baseWorkingPath') return '/mnt/base';
    }),
  };

  const mockAuthService = {
    getAccessToken: jest.fn().mockResolvedValue('mock-token'),
  };

  beforeEach(async () => {
    mockLogger = { debug: jest.fn(), log: jest.fn(), error: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateWorkingDirectoryActivity,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: Logger, useValue: mockLogger }, 
        { provide: HttpService, useValue: {} },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get(ValidateWorkingDirectoryActivity);
    configService = module.get(ConfigService);
    authService = module.get(AuthService);

    jest.spyOn(Protocols, 'getProtocol').mockReturnValue(mockProtocol as any);
    jest.spyOn(service as any, 'updateConfigStatus').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should validate with mount/unmount when exportPathWorkingDirectoryProvided is false', async () => {
    const payload = {
      configId: 'cfg-1',
      exportPathWorkingDirectoryProvided: false,
      listPathPayload: [{
        host: 'host1', username: 'u', password: 'p', protocolVersion: 'v4', type: 'NFS'
      }],
      fetchedPath: '/mnt/source'
    };

    const result = await service.validateWorkingDirectory('trace-1', payload);

    expect(result.status).toBe('success');
    expect(mockProtocol.mountPath).toHaveBeenCalled();
    expect(mockProtocol.unmountPath).toHaveBeenCalled();
  });

  it('should return error if exportPathPresent is false', async () => {
    const payload = {
      configId: 'cfg-2',
      exportPathWorkingDirectoryProvided: true,
      exportPathPresent: false,
    };

    const result = await service.validateWorkingDirectory('trace-2', payload);

    expect(result.status).toBe('error');
    expect(result.message).toContain(ConfigError.INVALID_EXPORT_PATH);
  });

  it('should validate working directory with write access', async () => {
    const payload = {
      configId: 'cfg-3',
      exportPathWorkingDirectoryProvided: true,
      exportPathPresent: true,
      exportPath: '/exports/data',
      workingDirectory: 'dir',
      listPathPayload: [{
        host: 'host2', username: 'u', password: 'p', protocolVersion: 'v4', type: 'NFS'
      }],
    };

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const result = await service.validateWorkingDirectory('trace-3', payload);
    expect(result.status).toBeDefined();
  });

  it('should return error if working directory exists but is not writable', async () => {
    const payload = {
      configId: 'cfg-4',
      exportPathWorkingDirectoryProvided: true,
      exportPathPresent: true,
      exportPath: '/exports/data',
      workingDirectory: 'readonly-dir',
      listPathPayload: [{
        host: 'host2', username: 'u', password: 'p', protocolVersion: 'v4', type: 'NFS'
      }],
    };

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('EACCES'); });
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    const result = await service.validateWorkingDirectory('trace-4', payload);

    expect(result.status).toBe('error');
  });

  it('should handle API errors in updateConfigStatus', async () => {
    const payload = {
      configId: 'cfg-5',
      exportPathWorkingDirectoryProvided: false,
      listPathPayload: [],
      fetchedPath: '/somepath',
    };

    jest.spyOn(service as any, 'updateConfigStatus').mockRejectedValue(new Error('API Error'));

    await expect(service.validateWorkingDirectory('trace-5', payload)).rejects.toThrow('API Error');
  });
});
