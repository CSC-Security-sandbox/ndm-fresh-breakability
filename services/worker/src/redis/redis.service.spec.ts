import { RedisService } from './redis.service';
import { JobContextFactory } from '@netapp-cloud-datamigrate/jobs-lib';
import { createClient, RedisClientType } from 'redis';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
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
      info: jest.fn().mockResolvedValue(
        'used_memory:1024\ntotal_system_memory:4096\n'
      ),
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
      const logSpy = jest.spyOn(
        (service as any).logger,
        'log'
      );
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
        expect.objectContaining({ url: 'redis://127.0.0.1:6379' })
      );
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function)
      );
      expect(mockClient.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function)
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
        })
      );
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
        'Redis client is not initialized yet.'
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
      const fakeProvider = { getJobContext: jest.fn().mockResolvedValue('ctx') };
      (JobContextFactory.getProvider as jest.Mock).mockReturnValue(fakeProvider);
      (service as any).client = mockClient;
      const ctx = await service.getJobContext('id');
      expect(JobContextFactory.getProvider).toHaveBeenCalledWith('redis', mockClient);
      expect(ctx).toBe('ctx');
    });

    it('getSpeedTestJobContext should return from speed test provider', async () => {
      const fakeProvider = { getJobContext: jest.fn().mockResolvedValue('ctx2') };
      (JobContextFactory.getSpeedTestProvider as jest.Mock).mockReturnValue(fakeProvider);
      (service as any).client = mockClient;
      const ctx = await service.getSpeedTestJobContext('id2');
      expect(JobContextFactory.getSpeedTestProvider).toHaveBeenCalledWith('redis', mockClient);
      expect(ctx).toBe('ctx2');
    });

	@@ -206,49 +109,84 @@ describe('RedisService', () => {

    it('getOwnerIdentity should hGet mapping', async () => {
      (service as any).client = mockClient;
      const jobCtx = { jobRunId: 'runId' } as any;
      const result = service.getOwnerIdentity(jobCtx, '123', 'UID');
      await expect(result).resolves.toBe('identity');
    });
  });

  describe('Memory info', () => {
    it('parseMemoryStats extracts values', () => {
      const stats = 'used_memory:256\ntotal_system_memory:1024\nother:foo';
      const parsed = service.parseMemoryStats(stats);
      expect(parsed).toEqual({ used_memory: 256, total_system_memory: 1024 });
    });

    it('getMemoryInfo calls info and returns parsed', async () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = true;
      const info = await service.getMemoryInfo();
      expect(mockClient.info).toHaveBeenCalledWith('memory');
      expect(info).toEqual({ used_memory: 1024, total_system_memory: 4096 });
    });

    it('getJobManagerContext should return from job manager provider', async () => {
      const fakeProvider = { getContext: jest.fn().mockResolvedValue('mgrCtx') };
      // Patch getJobManagerProvider since it is not mocked above
      (JobContextFactory as any).getJobManagerProvider = jest.fn().mockReturnValue(fakeProvider);
      (service as any).client = mockClient;
      jest.spyOn(service as any, 'ensureClient').mockResolvedValue(undefined);
      const ctx = await service.getJobManagerContext('mgrId');
      expect(JobContextFactory.getJobManagerProvider).toHaveBeenCalledWith('redis', mockClient);
      expect(ctx).toBe('mgrCtx');
    });

    it('getOwnerIdentity should call hGet with correct args', async () => {
      (service as any).client = mockClient;
      const result = await service.getOwnerIdentity('runId', '456', 'GID');
      expect(mockClient.hGet).toHaveBeenCalledWith('runId:mapping', 'GID:456');
      expect(result).toBe('identity');
    });

    it('parseMemoryStats returns zeros if keys missing', () => {
      const stats = 'foo:bar\nbaz:qux';
      const parsed = service.parseMemoryStats(stats);
      expect(parsed).toEqual({ used_memory: 0, total_system_memory: 0 });
    });
  });
});
