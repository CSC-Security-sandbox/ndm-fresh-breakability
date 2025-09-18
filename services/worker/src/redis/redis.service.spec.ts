import { RedisService } from './redis.service';
import { JobContextFactory } from '@netapp-cloud-datamigrate/jobs-lib';
import { createClient } from 'redis';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

jest.mock('@netapp-cloud-datamigrate/jobs-lib', () => ({
  JobContextFactory: {
    getProvider: jest.fn(),
    getSpeedTestProvider: jest.fn(),
  },
}));

describe('RedisService', () => {
  let service: RedisService;
  let mockClient: any;
  let loggerFactory: LoggerFactory;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      isOpen: false,
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      info: jest
        .fn()
        .mockResolvedValue('used_memory:1024\ntotal_system_memory:4096\n'),
      hGet: jest.fn().mockResolvedValue('identity'),
    };
    (createClient as jest.Mock).mockReturnValue(mockClient);

    loggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    } as unknown as LoggerFactory;

    service = new RedisService(loggerFactory);
  });

  describe('onModuleInit', () => {
    it('should create client on init', async () => {
      const spyCreate = jest.spyOn(service, 'createClient');
      await service.onModuleInit();
      expect(spyCreate).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should quit client and log when open', async () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = true;
      const logSpy = jest.spyOn((service as any).logger, 'log');
      await service.onModuleDestroy();
      expect(mockClient.quit).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('Redis client disconnected');
    });

    it('should not quit when client not open', async () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = false;
      await service.onModuleDestroy();
      expect(mockClient.quit).not.toHaveBeenCalled();
    });
  });

  describe('createClient', () => {
    it('should return early if client already open', async () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = true;
      await service.createClient();
      expect(createClient).not.toHaveBeenCalled();
    });

    it('should create client without auth and connect', async () => {
      delete process.env.REDIS_USERNAME;
      delete process.env.REDIS_PASSWORD;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      await service.createClient();
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'redis://127.0.0.1:6379' }),
      );
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function),
      );
    });

    it('should include auth when env vars set', async () => {
      process.env.REDIS_HOST = 'host';
      process.env.REDIS_PORT = '1234';
      process.env.REDIS_USERNAME = 'user';
      process.env.REDIS_PASSWORD = 'pass';
      await service.createClient();
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'redis://host:1234',
          username: 'user',
          password: 'pass',
        }),
      );
    });

    it('should handle Redis client error events', async () => {
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error');
      let errorHandler: (error: any) => void;

      mockClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      await service.createClient();

      // Trigger the error handler
      const testError = new Error('Redis connection failed');
      errorHandler!(testError);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Redis connection error: ${testError}`,
      );
    });

    it('should handle Redis client connect events', async () => {
      const loggerLogSpy = jest.spyOn((service as any).logger, 'log');
      let connectHandler: () => void;

      mockClient.on.mockImplementation((event, handler) => {
        if (event === 'connect') {
          connectHandler = handler;
        }
      });

      await service.createClient();

      // Trigger the connect handler
      connectHandler!();

      expect(loggerLogSpy).toHaveBeenCalledWith('Connected to Redis');
    });
  });

  describe('getClient', () => {
    it('should return client when initialized and open', () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = true;
      const client = service.getClient();
      expect(client).toBe(mockClient);
    });

    it('should throw if client not open', () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = false;
      expect(() => service.getClient()).toThrow(
        'Redis client is not initialized yet.',
      );
    });
  });

  describe('ensureClient', () => {
    it('should call createClient when no client', async () => {
      const spyCreate = jest.spyOn(service as any, 'createClient');
      (service as any).client = undefined;
      await (service as any).ensureClient();
      expect(spyCreate).toHaveBeenCalled();
    });

    it('should call createClient when client not open', async () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = false;
      const spyCreate = jest.spyOn(service as any, 'createClient');
      await (service as any).ensureClient();
      expect(spyCreate).toHaveBeenCalled();
    });
  });

  describe('JobContext operations', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'ensureClient').mockResolvedValue(undefined);
    });

    it('getJobContext should return from provider', async () => {
      const fakeProvider = {
        getJobContext: jest.fn().mockResolvedValue('ctx'),
      };
      (JobContextFactory.getProvider as jest.Mock).mockReturnValue(
        fakeProvider,
      );
      (service as any).client = mockClient;
      const ctx = await service.getJobContext('id');
      expect(JobContextFactory.getProvider).toHaveBeenCalledWith(
        'redis',
        mockClient,
      );
      expect(ctx).toBe('ctx');
    });

    it('getSpeedTestJobContext should return from speed test provider', async () => {
      const fakeProvider = {
        getJobContext: jest.fn().mockResolvedValue('ctx2'),
      };
      (JobContextFactory.getSpeedTestProvider as jest.Mock).mockReturnValue(
        fakeProvider,
      );
      (service as any).client = mockClient;
      const ctx = await service.getSpeedTestJobContext('id2');
      expect(JobContextFactory.getSpeedTestProvider).toHaveBeenCalledWith(
        'redis',
        mockClient,
      );
      expect(ctx).toBe('ctx2');
    });

    it('getJobManagerContext should return from job manager provider', async () => {
      const fakeProvider = {
        getContext: jest.fn().mockResolvedValue('mgrCtx'),
      };
      (JobContextFactory as any).getJobManagerProvider = jest
        .fn()
        .mockReturnValue(fakeProvider);
      (service as any).client = mockClient;
      const ctx = await service.getJobManagerContext('mgrId');
      expect(JobContextFactory.getJobManagerProvider).toHaveBeenCalledWith(
        'redis',
        mockClient,
      );
      expect(ctx).toBe('mgrCtx');
    });

    it('setJobContext should serialize and set context', async () => {
      const mockJobContext = {
        serialize: jest.fn().mockReturnValue('serialized-context'),
      };
      (service as any).client = mockClient;

      await service.setJobContext('trace-123', mockJobContext);

      expect(mockJobContext.serialize).toHaveBeenCalled();
      expect(mockClient.set).toHaveBeenCalledWith(
        'trace-123',
        'serialized-context',
      );
    });

    it('getJobState should return job state from context', async () => {
      const mockJobContext = {
        getJobState: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
      };
      jest
        .spyOn(service, 'getJobContext')
        .mockResolvedValue(mockJobContext as any);

      const result = await service.getJobState('trace-456');

      expect(service.getJobContext).toHaveBeenCalledWith('trace-456');
      expect(mockJobContext.getJobState).toHaveBeenCalled();
      expect(result).toEqual({ status: 'RUNNING' });
    });

    it('getJobState should return error message when exception occurs', async () => {
      jest
        .spyOn(service, 'getJobContext')
        .mockRejectedValue(new Error('Context not found'));

      const result = await service.getJobState('trace-error');

      expect(result).toEqual({
        message: 'Error while getting the job state : trace-error',
      });
    });

    it('setJobState should update and return new job state', async () => {
      const mockJobContext = {
        setJobState: jest.fn().mockResolvedValue(undefined),
        getJobState: jest.fn().mockResolvedValue({ status: 'COMPLETED' }),
      };
      jest
        .spyOn(service, 'getJobContext')
        .mockResolvedValue(mockJobContext as any);

      const result = await service.setJobState('trace-789', {
        status: 'COMPLETED',
      } as any);

      expect(service.getJobContext).toHaveBeenCalledWith('trace-789');
      expect(mockJobContext.setJobState).toHaveBeenCalledWith({
        status: 'COMPLETED',
      });
      expect(mockJobContext.getJobState).toHaveBeenCalled();
      expect(result).toEqual({ status: 'COMPLETED' });
    });

    it('setJobState should return error message when exception occurs', async () => {
      jest
        .spyOn(service, 'getJobContext')
        .mockRejectedValue(new Error('Failed to update'));

      const result = await service.setJobState('trace-fail', {
        status: 'FAILED',
      } as any);

      expect(result).toEqual({
        message: 'Error while updating the job state : trace-fail',
      });
    });
  });

  describe('Owner Identity operations', () => {
    beforeEach(() => {
      (service as any).client = mockClient;
    });

    it('getOwnerIdentity should call hGet with correct parameters', async () => {
      mockClient.hGet.mockResolvedValue('test-identity');

      const result = await service.getOwnerIdentity(
        'job-run-123',
        '456',
        'SID',
      );

      expect(mockClient.hGet).toHaveBeenCalledWith(
        'job-run-123:mapping',
        'SID:456',
      );
      expect(result).toBe('test-identity');
    });

    it('getOwnerIdentity should handle UID type', async () => {
      mockClient.hGet.mockResolvedValue('uid-identity');

      const result = await service.getOwnerIdentity(
        'job-run-456',
        '789',
        'UID',
      );

      expect(mockClient.hGet).toHaveBeenCalledWith(
        'job-run-456:mapping',
        'UID:789',
      );
      expect(result).toBe('uid-identity');
    });

    it('getOwnerIdentity should handle GID type', async () => {
      mockClient.hGet.mockResolvedValue('gid-identity');

      const result = await service.getOwnerIdentity(
        'job-run-789',
        '101',
        'GID',
      );

      expect(mockClient.hGet).toHaveBeenCalledWith(
        'job-run-789:mapping',
        'GID:101',
      );
      expect(result).toBe('gid-identity');
    });

    it('setOwnerIdentity should call hSet with correct parameters', async () => {
      mockClient.hSet = jest.fn().mockResolvedValue(1);

      const result = await service.setOwnerIdentity(
        'job-run-123',
        '456',
        'SID',
        'S-1-5-21-123456789',
      );

      expect(mockClient.hSet).toHaveBeenCalledWith(
        'job-run-123:mapping',
        'SID:456',
        'S-1-5-21-123456789',
      );
      expect(result).toBe(1);
    });

    it('setOwnerIdentity should handle UID type', async () => {
      mockClient.hSet = jest.fn().mockResolvedValue(1);

      const result = await service.setOwnerIdentity(
        'job-run-456',
        '789',
        'UID',
        'user123',
      );

      expect(mockClient.hSet).toHaveBeenCalledWith(
        'job-run-456:mapping',
        'UID:789',
        'user123',
      );
      expect(result).toBe(1);
    });

    it('setOwnerIdentity should handle GID type', async () => {
      mockClient.hSet = jest.fn().mockResolvedValue(0);

      const result = await service.setOwnerIdentity(
        'job-run-789',
        '101',
        'GID',
        'group456',
      );

      expect(mockClient.hSet).toHaveBeenCalledWith(
        'job-run-789:mapping',
        'GID:101',
        'group456',
      );
      expect(result).toBe(0);
    });

    describe('Memory info', () => {
      beforeEach(() => {
        jest.spyOn(service as any, 'ensureClient').mockResolvedValue(undefined);
      });

      it('parseMemoryStats extracts values correctly', () => {
        const stats = 'used_memory:256\ntotal_system_memory:1024\nother:foo';
        const parsed = service.parseMemoryStats(stats);
        expect(parsed).toEqual({ used_memory: 256, total_system_memory: 1024 });
      });

      it('parseMemoryStats returns zeros if keys missing', () => {
        const stats = 'foo:bar\nbaz:qux';
        const parsed = service.parseMemoryStats(stats);
        expect(parsed).toEqual({ used_memory: 0, total_system_memory: 0 });
      });

      it('parseMemoryStats handles empty string', () => {
        const parsed = service.parseMemoryStats('');
        expect(parsed).toEqual({ used_memory: 0, total_system_memory: 0 });
      });

      it('parseMemoryStats handles malformed data', () => {
        const stats = 'used_memory:invalid\ntotal_system_memory:notanumber';
        const parsed = service.parseMemoryStats(stats);
        expect(parsed.used_memory).toBeNaN();
        expect(parsed.total_system_memory).toBeNaN();
      });

      it('getMemoryInfo calls info and returns parsed', async () => {
        (service as any).client = mockClient;
        const info = await service.getMemoryInfo();
        expect(mockClient.info).toHaveBeenCalledWith('memory');
        expect(info).toEqual({ used_memory: 1024, total_system_memory: 4096 });
      });
    });

    describe('Mapping Keys operations', () => {
      beforeEach(() => {
        jest.spyOn(service as any, 'ensureClient').mockResolvedValue(undefined);
        (service as any).client = mockClient;
      });

      it('getMappingKeys should filter and map SID keys correctly', async () => {
        mockClient.hKeys = jest
          .fn()
          .mockResolvedValue([
            'SID:123',
            'SID:456',
            'UID:789',
            'GID:101',
            'SID:999',
          ]);

        const result = await service.getMappingKeys('job-run-123', 'SID');

        expect(mockClient.hKeys).toHaveBeenCalledWith('job-run-123:mapping');
        expect(result).toEqual(['123', '456', '999']);
      });

      it('getMappingKeys should filter and map UID keys correctly', async () => {
        mockClient.hKeys = jest
          .fn()
          .mockResolvedValue(['SID:123', 'UID:456', 'UID:789', 'GID:101']);

        const result = await service.getMappingKeys('job-run-456', 'UID');

        expect(mockClient.hKeys).toHaveBeenCalledWith('job-run-456:mapping');
        expect(result).toEqual(['456', '789']);
      });

      it('getMappingKeys should filter and map GID keys correctly', async () => {
        mockClient.hKeys = jest
          .fn()
          .mockResolvedValue([
            'SID:123',
            'UID:456',
            'GID:789',
            'GID:101',
            'OTHER:999',
          ]);

        const result = await service.getMappingKeys('job-run-789', 'GID');

        expect(mockClient.hKeys).toHaveBeenCalledWith('job-run-789:mapping');
        expect(result).toEqual(['789', '101']);
      });

      it('getMappingKeys should return empty array when no matching keys', async () => {
        mockClient.hKeys = jest
          .fn()
          .mockResolvedValue(['OTHER:123', 'INVALID:456']);

        const result = await service.getMappingKeys('job-run-empty', 'SID');

        expect(result).toEqual([]);
      });

      it('getMappingKeys should handle empty hash', async () => {
        mockClient.hKeys = jest.fn().mockResolvedValue([]);

        const result = await service.getMappingKeys('job-run-empty', 'UID');

        expect(result).toEqual([]);
      });
    });
  });
});
