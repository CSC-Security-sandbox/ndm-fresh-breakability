import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';
import { RedisUtils, JobContextFactory } from '@netapp-cloud-datamigrate/jobs-lib';


jest.mock('@netapp-cloud-datamigrate/jobs-lib');
jest.mock('@nestjs/common/services/logger.service');

describe('RedisService', () => {
  let service: RedisService;
  let redisUtilsMock: jest.Mocked<RedisUtils>;
  let mockClient: any;

  beforeEach(async () => {
    redisUtilsMock = new RedisUtils() as jest.Mocked<RedisUtils>;
    mockClient = {
      isOpen: true,
      quit: jest.fn(),
      set: jest.fn(),
      hGet: jest.fn(),
      info: jest.fn(),
    };
    redisUtilsMock.getClient = jest.fn().mockResolvedValue(mockClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: RedisUtils, useValue: redisUtilsMock },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    (service as any).redisUtils = redisUtilsMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize the Redis client', async () => {
      // Ensure the service uses the mocked redisUtils
      await service.onModuleInit();
      expect(redisUtilsMock.getClient).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should close the Redis client connection', async () => {
      await service.onModuleDestroy();
      expect(redisUtilsMock.closePool).toHaveBeenCalled();
    });

    it('should not disconnect if the client is not open', async () => {
      mockClient.isOpen = false;
      await service.onModuleDestroy();
      expect(mockClient.quit).not.toHaveBeenCalled();
    });
  });

  describe('JobContext operations', () => {
    it('getJobContext should return from provider', async () => {
      const fakeProvider = { getJobContext: jest.fn().mockResolvedValue('ctx') };
      (JobContextFactory.getProvider as jest.Mock).mockImplementation(() => fakeProvider);
      service['client'] = mockClient;
      const ctx = await service.getJobContext('id');
      expect(JobContextFactory.getProvider).toHaveBeenCalledWith('redis', service['client']);
      expect(ctx).toBe('ctx');
    });

    it('getSpeedTestJobContext should return from speed test provider', async () => {
      const fakeProvider = { getJobContext: jest.fn().mockResolvedValue('ctx2') };
      (JobContextFactory.getSpeedTestProvider as jest.Mock).mockImplementation(() => fakeProvider);
      service['client'] = mockClient;
      const ctx = await service.getSpeedTestJobContext('id2');
      expect(JobContextFactory.getSpeedTestProvider).toHaveBeenCalledWith('redis', service['client']);
      expect(ctx).toBe('ctx2');
    });

    it('setJobContext should serialize and set', async () => {
      (service as any).client = mockClient;
      const jobContext = { serialize: jest.fn().mockReturnValue('data') };
      await service.setJobContext('trace', jobContext);
      expect(jobContext.serialize).toHaveBeenCalled();
      expect(mockClient.set).toHaveBeenCalledWith('trace', 'data');
    });

    it('getJobState happy path', async () => {
      (service as any).getJobContext = jest.fn().mockResolvedValue({ getJobState: jest.fn().mockResolvedValue('ok') });
      const state = await service.getJobState('t');
      expect(state).toBe('ok');
    });

    it('getJobState error path', async () => {
      (service as any).getJobContext = jest.fn().mockRejectedValue(new Error('fail'));
      const state = await service.getJobState('t2');
      expect(state).toEqual({ message: 'Error while getting the job state : t2' });
    });

    it('setJobState happy path', async () => {
      (service as any).getJobContext = jest.fn().mockResolvedValue({ setJobState: jest.fn().mockResolvedValue(undefined), getJobState: jest.fn().mockResolvedValue('new') });
      const res = await service.setJobState('t3', 'state' as any);
      expect(res).toBe('new');
    });

    it('setJobState error path', async () => {
      (service as any).getJobContext = jest.fn().mockRejectedValue(new Error('oops'));
      const res = await service.setJobState('t4', 'state' as any);
      expect(res).toEqual({ message: 'Error while updating the job state : t4' });
    });

    it('getOwnerIdentity should hGet mapping', async () => {
      (service as any).client = mockClient;
      mockClient.hGet.mockResolvedValue('identity');
      const jobCtx = { jobRunId: 'runId' } as any;
      const result = service.getOwnerIdentity(jobCtx, '123', 'UID');
      await expect(result).resolves.toBe('identity');
    });
  });

  describe('setJobContext', () => {
    it('should set job context in Redis', async () => {
      (service as any).client = mockClient;
      const mockJobContext = { serialize: jest.fn().mockReturnValue('serializedContext') };
      await service.setJobContext('traceId', mockJobContext);

      expect(mockClient.set).toHaveBeenCalledWith('traceId', 'serializedContext');
    });
  });

  describe('getJobState', () => {
    it('getJobState happy path', async () => {
      (service as any).getJobContext = jest.fn().mockResolvedValue({ getJobState: jest.fn().mockResolvedValue('ok') });
      const state = await service.getJobState('t');
      expect(state).toBe('ok');
    });

    it('getJobState error path', async () => {
      (service as any).getJobContext = jest.fn().mockRejectedValue(new Error('fail'));
      const state = await service.getJobState('t2');
      expect(state).toEqual({ message: 'Error while getting the job state : t2' });
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(service, 'getJobContext').mockRejectedValue(new Error('Error'));

      const result = await service.getJobState('traceId');
      expect(result).toEqual({ message: 'Error while getting the job state : traceId' });
    });
  });

  describe('setJobState', () => {
    it('setJobState happy path', async () => {
      (service as any).getJobContext = jest.fn().mockResolvedValue({ setJobState: jest.fn().mockResolvedValue(undefined), getJobState: jest.fn().mockResolvedValue('new') });
      const res = await service.setJobState('t3', 'state' as any);
      expect(res).toBe('new');
    });

    it('setJobState error path', async () => {
      (service as any).getJobContext = jest.fn().mockRejectedValue(new Error('oops'));
      const res = await service.setJobState('t4', 'state' as any);
      expect(res).toEqual({ message: 'Error while updating the job state : t4' });
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(service, 'getJobContext').mockRejectedValue(new Error('Error'));

      const result = await service.setJobState('traceId', 'jobState' as any);
      expect(result).toEqual({ message: 'Error while updating the job state : traceId' });
    });
  });

  describe('getOwnerIdentity', () => {
    it('should return owner identity', async () => {
      (service as any).client = mockClient;
      mockClient.hGet.mockResolvedValue('ownerIdentity');

      const result = await service.getOwnerIdentity('jobRunId', 'id', 'SID');
      expect(mockClient.hGet).toHaveBeenCalledWith('jobRunId:mapping', 'SID:id');
      expect(result).toBe('ownerIdentity');
    });
  });

  describe('getMemoryInfo', () => {
    it('should return memory info', async () => {
      mockClient.info.mockResolvedValue('used_memory:1024\ntotal_system_memory:2048\n');

      const result = await service.getMemoryInfo();
      expect(mockClient.info).toHaveBeenCalledWith('memory');
      expect(result).toEqual({ used_memory: 1024, total_system_memory: 2048 });
    });
  });
});
