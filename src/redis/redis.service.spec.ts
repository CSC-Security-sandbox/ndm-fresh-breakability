import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';
import * as redis from 'redis'; // Import the 'redis' module
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import { FileServerDetails, JobContext, JobStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { RedisClientType } from 'redis';

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RedisService],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a Redis client on module initialization', async () => {
    await service.onModuleInit();
    expect(service['client']).toBeDefined();
  });

  it('should disconnect the Redis client on module destruction', async () => {
    await service.onModuleDestroy();
    expect(service['client']).toBeUndefined();
  });

  it('should ensure the Redis client is initialized', async () => {
    await service.ensureClient();
    expect(service['client']).toBeDefined();
  });

  it('should get the Redis client', async () => {
    const client = await service.getClient();
    expect(client).toBeDefined();
  });

it('should set the job context in Redis', async () => {
  const traceId = 'test-trace-id';
  const jobContext = { data: 'test-data', serialize: () => JSON.stringify(this) };

  const mockRedisClient: Partial<RedisClientType> = {
    set: jest.fn().mockResolvedValue('OK'),
  };

  service['client'] = mockRedisClient as RedisClientType;

  await service.setJobContext(traceId, jobContext);

  expect(service['client'].set).toHaveBeenCalledWith("test-trace-id", "{}");
});

it('should set the job context in Redis and handle uninitialized client', async () => {
  const traceId = 'test-trace-id';
  const jobContext = { data: 'test-data', serialize: () => JSON.stringify(this) };

  const mockRedisClient: Partial<RedisClientType> = {
    set: jest.fn().mockResolvedValue('OK'),
  };

  service['client'] = undefined;

  jest.spyOn(service, 'getClient').mockResolvedValue(mockRedisClient as RedisClientType);

  const errorSpy = jest.spyOn(service['logger'], 'error');
  const logSpy = jest.spyOn(service['logger'], 'log');

  await service.setJobContext(traceId, jobContext);

  expect(errorSpy).toHaveBeenCalledWith('[Job-Service] Redis client is not initialized, trying to reconnect');
  expect(service['getClient']).toHaveBeenCalled();
  expect(service['client']).toBe(mockRedisClient);
  expect(logSpy).toHaveBeenCalledWith('[Job-Service] Redis client reconnected');
  expect(service['client'].set).toHaveBeenCalledWith("test-trace-id", "{}");
  expect(logSpy).toHaveBeenCalledWith(`[Job-Service] [${traceId}] Job context saved to Redis.`);
});

it('should disconnect the Redis client on module destruction', async () => {
  const mockRedisClient: Partial<RedisClientType> = {
    isOpen: true,
    quit: jest.fn().mockResolvedValue(undefined),
  };

  service['client'] = mockRedisClient as RedisClientType;

  const logSpy = jest.spyOn(service['logger'], 'log');

  await service.onModuleDestroy();

  expect(service['client'].quit).toHaveBeenCalled();
  expect(logSpy).toHaveBeenCalledWith('Redis client disconnected');
});



it('should create a Redis client and handle connection events', async () => {
  // Mock the Redis client
  const mockRedisClient: Partial<RedisClientType> = {
    isOpen: false,
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((event, callback) => {
      if (event === 'error') {
        callback(new Error('Test error'));
      } else if (event === 'connect') {
        callback();
      }
      return mockRedisClient as RedisClientType;
    }),
  };

  service['client'] = undefined; // Simulate uninitialized client

  // Mock logger methods
  const logSpy = jest.spyOn(service['logger'], 'log');
  const errorSpy = jest.spyOn(service['logger'], 'error');

  // Mock createClient to return the mock Redis client
  jest.spyOn(redis, 'createClient').mockReturnValue(mockRedisClient as RedisClientType);

  await service.createClient();

  expect(redis.createClient).toHaveBeenCalled();
  expect(service['client']).toBe(mockRedisClient);
  expect(logSpy).toHaveBeenCalledWith(`Connecting to Redis at redis://127.0.0.1:6379`);
  expect(mockRedisClient.connect).toHaveBeenCalled();
  expect(errorSpy).toHaveBeenCalledWith('Redis connection error: Error: Test error');
  expect(logSpy).toHaveBeenCalledWith('Connected to Redis');
});


it('should create a Redis client with authentication options', async () => {
  // Set environment variables
  process.env.REDIS_USERNAME = 'test-username';
  process.env.REDIS_PASSWORD = 'test-password';

  // Mock the Redis client
  const mockRedisClient: Partial<RedisClientType> = {
    isOpen: false,
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((event, callback) => {
      if (event === 'error') {
        callback(new Error('Test error'));
      } else if (event === 'connect') {
        callback();
      }
      return mockRedisClient as RedisClientType;
    }),
  };

  service['client'] = undefined; // Simulate uninitialized client

  // Mock logger methods
  const logSpy = jest.spyOn(service['logger'], 'log');
  const errorSpy = jest.spyOn(service['logger'], 'error');

  // Mock createClient to return the mock Redis client
  jest.spyOn(redis, 'createClient').mockReturnValue(mockRedisClient as RedisClientType);

  await service.createClient();

  expect(redis.createClient).toHaveBeenCalledWith({
    url: 'redis://127.0.0.1:6379',
    username: 'test-username',
    password: 'test-password',
  });
  expect(service['client']).toBe(mockRedisClient);
  expect(logSpy).toHaveBeenCalledWith(`Connecting to Redis at redis://127.0.0.1:6379`);
  expect(mockRedisClient.connect).toHaveBeenCalled();
  expect(errorSpy).toHaveBeenCalledWith('Redis connection error: Error: Test error');
  expect(logSpy).toHaveBeenCalledWith('Connected to Redis');

  // Clean up environment variables
  delete process.env.REDIS_USERNAME;
  delete process.env.REDIS_PASSWORD;
});

  // it('should get the job context from Redis', async () => {
  //   const traceId = 'test-trace-id';
  //   const jobContext = await service.getJobContext(traceId);
  //   expect(jobContext).toBeDefined();
  // });

  // it('should set the job context in Redis', async () => {
  //   const traceId = 'test-trace-id';
  //   const jobContext = { data: 'test-data', serialize: () => JSON.stringify(this) };
  //   await service.setJobContext(traceId, jobContext);
  //   const storedContext = await service.getJobContext(traceId);
  //   expect(storedContext).toEqual(jobContext);
  // });

  it('should set the job state in Redis', async () => {
    const traceId = 'test-trace-id';
    const jobState: JobState = { 
      status: JobStatus.Completed,
      workers: ['worker1', 'worker2'],
      tasks_completed: 0,
      tasks_total: 0,
      workers_agreed: ['worker1'],
      failedWorkers: [],
      serialize: () => '',
      deserialize: () => {},
      toJSON: jest.fn(),
    };
    const newJobState = await service.setJobState(traceId, jobState);
    expect(newJobState).toBeTruthy();
  });
  it('should create a Redis client', async () => {
    const redisClientOptions = {
      url: 'redis://127.0.0.1:6379',
    };
  
    const createClientSpy = jest.spyOn(redis, 'createClient')
  
    await service.createClient();
  
    expect(createClientSpy).toHaveBeenCalledWith(redisClientOptions);
    expect(service['client']).toBeDefined();
  });
  it('should get the job state from Redis', async () => {
    const traceId = 'test-trace-id';
    const jobContext: any = { 
      getJobState: jest.fn().mockResolvedValue({ status: JobStatus.Completed }),
      jobRunId: '',
      jobConfig: {
        jobId: '',
        jobType: '',
        sourceFileServer: undefined,
        sourcePath: '',
        serialize: function (): string {
          throw new Error('Function not implemented.');
        },
        deserialize: function (json: string): void {
          throw new Error('Function not implemented.');
        }
      },
      jobState: {
        workers: [],
        tasks_completed: 0,
        tasks_total: 0,
        workers_agreed: [],
        status: JobStatus.Ready,
        failedWorkers: [],
        serialize: jest.fn(),
        deserialize:jest.fn(),
        toJSON: jest.fn(),
      },
      jobRunStatus:'IN_PROGRESS',
      serialize: jest.fn(),
      deserialize: jest.fn(),
    };
    jest.spyOn(service, 'getJobContext').mockResolvedValue(jobContext);
  
    const result = await service.getJobState(traceId);
  
    expect(service.getJobContext).toHaveBeenCalledWith(traceId);
    expect(jobContext.getJobState).toHaveBeenCalled();
    expect(result).toEqual({ status: JobStatus.Completed });
  });
  it('should set the job state in Redis', async () => {
    const traceId = 'test-trace-id';
    const jobState: JobState = { 
      status: JobStatus.Completed,
      workers: ['worker1', 'worker2'],
      tasks_completed: 0,
      tasks_total: 0,
      workers_agreed: ['worker1'],
      failedWorkers: [],
      serialize: () => '',
      deserialize: () => {},
      toJSON: jest.fn(),
    };
    const jobContextMock: any = {
      jobRunId: '',
      jobConfig: {
        jobId: '',
        jobType: '',
        sourceFileServer: undefined,
        sourcePath: '',
        serialize: function (): string {
          throw new Error('Function not implemented.');
        },
        deserialize: function (json: string): void {
          throw new Error('Function not implemented.');
        }
      },
      jobState: {
        workers: [],
        tasks_completed: 0,
        tasks_total: 0,
        workers_agreed: [],
        status: JobStatus.Ready,
        failedWorkers: [],
        serialize: jest.fn(),
        deserialize: jest.fn(),
        toJSON: jest.fn(),
      },
      jobRunStatus: 'IN_PROGRESS',
      getJobState: jest.fn().mockResolvedValue(jobState),
      setJobState: jest.fn().mockResolvedValue(jobState),
    };
    jest.spyOn(service, 'getJobContext').mockResolvedValue(jobContextMock);
  
    const newJobState = await service.setJobState(traceId, jobState);
  
    expect(service.getJobContext).toHaveBeenCalledWith(traceId);
    expect(jobContextMock.setJobState).toHaveBeenCalledWith(jobState);
    expect(jobContextMock.getJobState).toHaveBeenCalled();
    expect(newJobState).toEqual(jobState);
  });
});