import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { RedisConsumerService } from './redis-consumer.service';
import { InventoryService } from '../inventory/inventory.service';
import { WorkflowService } from '../workflow/workflow.service';
import { ConsumerType } from '../enum/redis-consumer.enum';
import { GroupReaderType, JobContextFactory, JobManagerContext } from '@netapp-cloud-datamigrate/jobs-lib';
import { Worker } from 'worker_threads';
import { redisUtils, ReaderStatus, getWorkflowId } from './utils';

// Mock problematic modules first
jest.mock('app-root-path', () => ({
  toString: () => '/mock/root/path',
  path: '/mock/root/path',
  resolve: (pathToResolve: string) => `/mock/root/path/${pathToResolve}`,
}));

jest.mock('typeorm', () => ({
  DataSource: jest.fn(),
  EntitySchema: jest.fn(),
  Repository: jest.fn(),
  Connection: jest.fn(),
  createConnection: jest.fn(),
  getConnection: jest.fn(),
  getRepository: jest.fn(),
  Entity: jest.fn(() => (target: any) => target),
  Column: jest.fn(() => (target: any, propertyKey: string) => {}),
  PrimaryGeneratedColumn: jest.fn(() => (target: any, propertyKey: string) => {}),
  CreateDateColumn: jest.fn(() => (target: any, propertyKey: string) => {}),
  UpdateDateColumn: jest.fn(() => (target: any, propertyKey: string) => {}),
  OneToMany: jest.fn(() => (target: any, propertyKey: string) => {}),
  ManyToOne: jest.fn(() => (target: any, propertyKey: string) => {}),
  JoinColumn: jest.fn(() => (target: any, propertyKey: string) => {}),
}));

// Mock NestJS TypeORM module
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: jest.fn(() => (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {}),
  TypeOrmModule: {
    forRoot: jest.fn(),
    forFeature: jest.fn(),
  },
}));

// Mock the inventory service module
jest.mock('../inventory/inventory.service', () => ({
  InventoryService: jest.fn().mockImplementation(() => ({
    createInventory: jest.fn(),
    saveTasks: jest.fn(),
    saveOperationError: jest.fn(),
    saveTaskError: jest.fn(),
  })),
}));

// Mock the workflow service module
jest.mock('../workflow/workflow.service', () => ({
  WorkflowService: jest.fn().mockImplementation(() => ({
    signalWorkflow: jest.fn(),
  })),
}));

// Mock external dependencies
jest.mock('@netapp-cloud-datamigrate/jobs-lib');
jest.mock('@temporalio/common', () => ({
  defaultDataConverter: {
    payloadConverter: {
      toPayload: jest.fn((data: any) => ({
        data: new Uint8Array(Buffer.from(JSON.stringify(data))),
        metadata: {
          encoding: new Uint8Array(Buffer.from('json/plain'))
        }
      }))
    }
  }
}));
jest.mock('./utils', () => ({
  redisUtils: {
    getClient: jest.fn(),
    releaseClient: jest.fn(),
  },
  getWorkflowId: jest.fn((jobRunId: string, jobType: string) => `${jobType}Workflow-${jobRunId}`),
  ReaderStatus: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
  },
}));
jest.mock('worker_threads');
jest.mock('path');

describe('RedisConsumerService', () => {
  let service: RedisConsumerService;
  let inventoryService: jest.Mocked<InventoryService>;
  let workflowService: jest.Mocked<WorkflowService>;
  let mockRedisClient: jest.Mocked<any>;
  let mockJobContext: jest.Mocked<JobManagerContext>;
  let mockContextProvider: jest.Mocked<any>;

  const mockJobRunId = 'test-job-run-id-123';
  const mockPathId = 'test-path-id-456';

  beforeEach(async () => {
    // Setup mocks
    mockRedisClient = {
      hSet: jest.fn(),
      hGet: jest.fn(),
      hDel: jest.fn(),
      del: jest.fn(),
      hGetAll: jest.fn(),
      keys: jest.fn(),
    };

    mockJobContext = {
      jobConfig: {
        sourceFileServer: { pathId: mockPathId },
        jobType: 'MIGRATE',
      },
      groupReadFileStream: jest.fn(),
      groupReadErrorStream: jest.fn(),
      groupReadTaskStream: jest.fn(),
      groupAckFileStream: jest.fn(),
      groupAckErrorStream: jest.fn(),
      groupAckTaskStream: jest.fn(),
    } as any;

    mockContextProvider = {
      getContext: jest.fn().mockResolvedValue(mockJobContext),
    };

    (JobContextFactory.getJobManagerProvider as jest.Mock).mockReturnValue(mockContextProvider);
    (redisUtils.getClient as jest.Mock).mockResolvedValue(mockRedisClient);
    (redisUtils.releaseClient as jest.Mock).mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisConsumerService,
        {
          provide: InventoryService,
          useValue: {
            createInventory: jest.fn(),
            saveTasks: jest.fn(),
            saveOperationError: jest.fn(),
            saveTaskError: jest.fn(),
          },
        },
        {
          provide: WorkflowService,
          useValue: {
            signalWorkflow: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RedisConsumerService>(RedisConsumerService);
    inventoryService = module.get(InventoryService);
    workflowService = module.get(WorkflowService);

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('initializeRedisConnection', () => {
    it('should initialize Redis connection successfully', async () => {
      // Reset the client to null to test initialization
      service['redisClient'] = null;
      (redisUtils.getClient as jest.Mock).mockResolvedValue(mockRedisClient);

      await service.initializeRedisConnection();

      expect(redisUtils.getClient).toHaveBeenCalled();
      expect(service['redisClient']).toBe(mockRedisClient);
    });

    it('should handle Redis connection failure', async () => {
      // Reset the client to null to test initialization
      service['redisClient'] = null;
      (redisUtils.getClient as jest.Mock).mockResolvedValue(null);

      await expect(service.initializeRedisConnection()).rejects.toThrow('Redis client is not initialized');
    });

    it('should handle Redis connection error', async () => {
      // Reset the client to null to test initialization
      service['redisClient'] = null;
      const error = new Error('Connection failed');
      (redisUtils.getClient as jest.Mock).mockRejectedValue(error);

      await expect(service.initializeRedisConnection()).rejects.toThrow('Connection failed');
      expect(service['redisClient']).toBeNull();
    });

    it('should not reinitialize if client already exists', async () => {
      // Set client to existing mock
      service['redisClient'] = mockRedisClient;
      (redisUtils.getClient as jest.Mock).mockClear();

      await service.initializeRedisConnection();

      expect(redisUtils.getClient).not.toHaveBeenCalled();
      expect(service['redisClient']).toBe(mockRedisClient);
    });
  });

  describe('cleanupResources', () => {
    it('should clean up all resources successfully', async () => {
      const mockTimer = setTimeout(() => {}, 1000);
      const mockContext = {
        jobRunId: mockJobRunId,
        pathId: mockPathId,
        records: [{ id: 1 }, { id: 2 }],
        flushTimer: mockTimer,
        errorRecoveryTimers: new Set([mockTimer]),
      };

      service['jobConsumerMap'].set(mockJobRunId, mockContext);
      service['activeWorkers'].set(mockJobRunId, true);
      service['redisClient'] = mockRedisClient;

      await service.cleanupResources();

      expect(service['jobConsumerMap'].size).toBe(0);
      expect(service['activeWorkers'].size).toBe(0);
      expect(redisUtils.releaseClient).toHaveBeenCalledWith(mockRedisClient);
      expect(service['redisClient']).toBeNull();
    });

    it('should handle cleanup errors gracefully', async () => {
      const error = new Error('Cleanup failed');
      (redisUtils.releaseClient as jest.Mock).mockRejectedValue(error);
      service['redisClient'] = mockRedisClient;

      await expect(service.cleanupResources()).resolves.not.toThrow();
    });
  });

  describe('buildRedisKey', () => {
    it('should build correct Redis key with prefix', () => {
      const result = service['buildRedisKey'](mockJobRunId);
      expect(result).toBe(`db-writer:${mockJobRunId}:`);
    });
  });

  describe('updateConsumerStatus', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should update consumer status successfully', async () => {
      await service.updateConsumerStatus(mockJobRunId, ConsumerType.files, 'active');

      expect(mockRedisClient.hSet).toHaveBeenCalledWith(
        `db-writer:${mockJobRunId}:`,
        ConsumerType.files,
        'active'
      );
    });

    it('should reinitialize Redis client if not available', async () => {
      service['redisClient'] = null;
      (redisUtils.getClient as jest.Mock).mockResolvedValue(mockRedisClient);

      await service.updateConsumerStatus(mockJobRunId, ConsumerType.files, 'active');

      expect(redisUtils.getClient).toHaveBeenCalled();
      expect(mockRedisClient.hSet).toHaveBeenCalled();
    });

   
  });

  describe('getConsumerStatus', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should get consumer status successfully', async () => {
      mockRedisClient.hGet.mockResolvedValue('active');

      const result = await service.getConsumerStatus(mockJobRunId, ConsumerType.files);

      expect(result).toBe('active');
      expect(mockRedisClient.hGet).toHaveBeenCalledWith(
        `db-writer:${mockJobRunId}:`,
        ConsumerType.files
      );
    });

    
  });

  describe('removeConsumer', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should remove consumer successfully', async () => {
      await service.removeConsumer(mockJobRunId, ConsumerType.files);

      expect(mockRedisClient.hDel).toHaveBeenCalledWith(
        `db-writer:${mockJobRunId}:`,
        ConsumerType.files
      );
    });

    it('should skip removal if Redis client not available', async () => {
      service['redisClient'] = null;

      await service.removeConsumer(mockJobRunId, ConsumerType.files);

      expect(mockRedisClient.hDel).not.toHaveBeenCalled();
    });
  });

  describe('removeJobFromRedis', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should remove job from Redis successfully', async () => {
      await service.removeJobFromRedis(mockJobRunId);

      expect(mockRedisClient.del).toHaveBeenCalledWith(`db-writer:${mockJobRunId}:`);
    });

    it('should skip removal if Redis client not available', async () => {
      service['redisClient'] = null;

      await service.removeJobFromRedis(mockJobRunId);

      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });
  });

  describe('getAllConsumerStatuses', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should get all consumer statuses successfully', async () => {
      const expectedStatuses = {
        [ConsumerType.files]: 'active',
        [ConsumerType.tasks]: 'inactive',
        [ConsumerType.errors]: 'active',
      };
      mockRedisClient.hGetAll.mockResolvedValue(expectedStatuses);

      const result = await service.getAllConsumerStatuses(mockJobRunId);

      expect(result).toEqual(expectedStatuses);
      expect(mockRedisClient.hGetAll).toHaveBeenCalledWith(`db-writer:${mockJobRunId}:`);
    });

    it('should return empty object on error', async () => {
      mockRedisClient.hGetAll.mockRejectedValue(new Error('Redis error'));

      const result = await service.getAllConsumerStatuses(mockJobRunId);

      expect(result).toEqual({});
    });

    it('should reinitialize Redis client if not available', async () => {
      service['redisClient'] = null;
      (redisUtils.getClient as jest.Mock).mockResolvedValue(mockRedisClient);
      mockRedisClient.hGetAll.mockResolvedValue({});

      const result = await service.getAllConsumerStatuses(mockJobRunId);

      expect(redisUtils.getClient).toHaveBeenCalled();
      expect(result).toEqual({});
    });
  });

  describe('isConsumerRunning', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should return true when consumer is active', async () => {
      mockRedisClient.hGet.mockResolvedValue('active');

      const result = await service.isConsumerRunning(mockJobRunId, ConsumerType.files);

      expect(result).toBe(true);
    });

    it('should return false when consumer is inactive', async () => {
      mockRedisClient.hGet.mockResolvedValue('inactive');

      const result = await service.isConsumerRunning(mockJobRunId, ConsumerType.files);

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockRedisClient.hGet.mockRejectedValue(new Error('Redis error'));

      const result = await service.isConsumerRunning(mockJobRunId, ConsumerType.files);

      expect(result).toBe(false);
    });
  });

  describe('saveJobConsumersToRedis', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should save all consumer types as active', async () => {
      jest.spyOn(service, 'updateConsumerStatus').mockResolvedValue();

      const result = await service.saveJobConsumersToRedis(mockJobRunId);

      expect(result).toBe(true);
      expect(service.updateConsumerStatus).toHaveBeenCalledTimes(Object.values(ConsumerType).length);
      
      Object.values(ConsumerType).forEach(type => {
        expect(service.updateConsumerStatus).toHaveBeenCalledWith(mockJobRunId, type, 'active');
      });
    });

    it('should throw error when Redis operations fail', async () => {
      const error = new Error('Redis operation failed');
      jest.spyOn(service, 'updateConsumerStatus').mockRejectedValue(error);

      await expect(service.saveJobConsumersToRedis(mockJobRunId)).rejects.toThrow('Redis operation failed');
    });
  });

  describe('checkAndStartActiveConsumers', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should start consumers for jobs with active status', async () => {
      const keys = [`db-writer:${mockJobRunId}:`];
      const consumerStatuses: Record<string, ReaderStatus> = { [ConsumerType.files]: 'active' };
      
      mockRedisClient.keys.mockResolvedValue(keys);
      jest.spyOn(service, 'getAllConsumerStatuses').mockResolvedValue(consumerStatuses);
      jest.spyOn(service, 'createConsumerWorkerThread').mockResolvedValue();

      await service.checkAndStartActiveConsumers();

      expect(mockRedisClient.keys).toHaveBeenCalledWith('db-writer:*');
      expect(service.getAllConsumerStatuses).toHaveBeenCalledWith(mockJobRunId);
      expect(service.createConsumerWorkerThread).toHaveBeenCalledWith(mockJobRunId);
    });

    it('should not start duplicate workers', async () => {
      const keys = [`db-writer:${mockJobRunId}:`];
      const consumerStatuses: Record<string, ReaderStatus> = { [ConsumerType.files]: 'active' };
      
      service['activeWorkers'].set(mockJobRunId, true);
      mockRedisClient.keys.mockResolvedValue(keys);
      jest.spyOn(service, 'getAllConsumerStatuses').mockResolvedValue(consumerStatuses);
      jest.spyOn(service, 'createConsumerWorkerThread').mockResolvedValue();

      await service.checkAndStartActiveConsumers();

      expect(service.createConsumerWorkerThread).not.toHaveBeenCalled();
    });

    it('should clean up jobs with no active consumers', async () => {
      const keys = [`db-writer:${mockJobRunId}:`];
      const consumerStatuses: Record<string, ReaderStatus> = { [ConsumerType.files]: 'inactive' };
      
      mockRedisClient.keys.mockResolvedValue(keys);
      jest.spyOn(service, 'getAllConsumerStatuses').mockResolvedValue(consumerStatuses);
      jest.spyOn(service, 'removeJobFromRedis').mockResolvedValue();

      await service.checkAndStartActiveConsumers();

      expect(service.removeJobFromRedis).toHaveBeenCalledWith(mockJobRunId);
    });

    it('should handle Redis client not available', async () => {
      service['redisClient'] = null;
      (redisUtils.getClient as jest.Mock).mockResolvedValue(null);

      await service.checkAndStartActiveConsumers();

      // Should not throw and should handle gracefully
      expect(mockRedisClient.keys).not.toHaveBeenCalled();
    });
  });

  describe('createConsumerWorkerThread', () => {
    let mockWorker: jest.Mocked<Worker>;

    beforeEach(() => {
      mockWorker = {
        on: jest.fn(),
        removeAllListeners: jest.fn(),
      } as any;
      
      (Worker as jest.MockedClass<typeof Worker>).mockImplementation(() => mockWorker);
    });

    

    it('should reject on worker failure', async () => {
      const workerPromise = service.createConsumerWorkerThread(mockJobRunId);

      // Simulate worker failure
      const messageCallback = mockWorker.on.mock.calls.find(call => call[0] === 'message')?.[1];
      messageCallback?.({ success: false, error: 'Worker failed' });

      await expect(workerPromise).rejects.toThrow('Worker failed');
    });

    it('should reject on worker error', async () => {
      const workerPromise = service.createConsumerWorkerThread(mockJobRunId);

      // Simulate worker error
      const errorCallback = mockWorker.on.mock.calls.find(call => call[0] === 'error')?.[1];
      const error = new Error('Worker error');
      errorCallback?.(error);

      await expect(workerPromise).rejects.toThrow('Worker error');
    });

    it('should handle worker exit with non-zero code', async () => {
      const workerPromise = service.createConsumerWorkerThread(mockJobRunId);

      // Simulate worker exit
      const exitCallback = mockWorker.on.mock.calls.find(call => call[0] === 'exit')?.[1];
      exitCallback?.(1);

      // Should remove listeners
      expect(mockWorker.removeAllListeners).toHaveBeenCalled();
    });
  });

  describe('executeConsumersInParallel', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should execute active consumers in parallel', async () => {
      const consumerStatuses: Record<string, ReaderStatus> = {
        [ConsumerType.files]: 'active',
        [ConsumerType.tasks]: 'active',
        [ConsumerType.errors]: 'inactive',
      };

      jest.spyOn(service, 'getAllConsumerStatuses').mockResolvedValue(consumerStatuses);
      jest.spyOn(service, 'executeConsumerLoop').mockResolvedValue();

      await service.executeConsumersInParallel(mockJobRunId);

      expect(service.executeConsumerLoop).toHaveBeenCalledTimes(2);
      expect(service.executeConsumerLoop).toHaveBeenCalledWith(mockJobRunId, ConsumerType.files);
      expect(service.executeConsumerLoop).toHaveBeenCalledWith(mockJobRunId, ConsumerType.tasks);
    });

    it('should handle no active consumers', async () => {
      const consumerStatuses: Record<string, ReaderStatus> = {
        [ConsumerType.files]: 'inactive',
        [ConsumerType.tasks]: 'inactive',
        [ConsumerType.errors]: 'inactive',
      };

      jest.spyOn(service, 'getAllConsumerStatuses').mockResolvedValue(consumerStatuses);
      jest.spyOn(service, 'executeConsumerLoop').mockResolvedValue();

      await service.executeConsumersInParallel(mockJobRunId);

      expect(service.executeConsumerLoop).not.toHaveBeenCalled();
    });

    it('should throw error if one consumer fails', async () => {
      const consumerStatuses: Record<string, ReaderStatus> = { [ConsumerType.files]: 'active' };
      const error = new Error('Consumer failed');

      jest.spyOn(service, 'getAllConsumerStatuses').mockResolvedValue(consumerStatuses);
      jest.spyOn(service, 'executeConsumerLoop').mockRejectedValue(error);

      await expect(service.executeConsumersInParallel(mockJobRunId)).rejects.toThrow('Consumer failed');
    });
  });

  describe('stopConsumer', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should stop consumer successfully', async () => {
      jest.spyOn(service, 'updateConsumerStatus').mockResolvedValue();

      await service.stopConsumer(mockJobRunId, ConsumerType.files);

      expect(service.updateConsumerStatus).toHaveBeenCalledWith(mockJobRunId, ConsumerType.files, 'inactive');
    });

    it('should handle errors when stopping consumer', async () => {
      const error = new Error('Stop failed');
      jest.spyOn(service, 'updateConsumerStatus').mockRejectedValue(error);

      await expect(service.stopConsumer(mockJobRunId, ConsumerType.files)).resolves.not.toThrow();
    });
  });

  describe('stopAllConsumers', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should stop all consumers and clean up resources', async () => {
      const consumerStatuses: Record<string, ReaderStatus> = {
        [ConsumerType.files]: 'active',
        [ConsumerType.tasks]: 'inactive',
      };

      const mockTimer = setTimeout(() => {}, 1000);
      const mockContext = {
        jobRunId: mockJobRunId,
        pathId: mockPathId,
        records: [{ id: 1 }],
        flushTimer: mockTimer,
        errorRecoveryTimers: new Set([mockTimer]),
      };

      service['jobConsumerMap'].set(mockJobRunId, mockContext);
      service['activeWorkers'].set(mockJobRunId, true);

      jest.spyOn(service, 'getAllConsumerStatuses').mockResolvedValue(consumerStatuses);
      jest.spyOn(service, 'stopConsumer').mockResolvedValue();
      jest.spyOn(service, 'removeJobFromRedis').mockResolvedValue();

      await service.stopAllConsumers(mockJobRunId);

      expect(service.stopConsumer).toHaveBeenCalledTimes(2);
      expect(service.removeJobFromRedis).toHaveBeenCalledWith(mockJobRunId);
      expect(service['jobConsumerMap'].has(mockJobRunId)).toBe(false);
      expect(service['activeWorkers'].has(mockJobRunId)).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Stop all failed');
      jest.spyOn(service, 'getAllConsumerStatuses').mockRejectedValue(error);

      await expect(service.stopAllConsumers(mockJobRunId)).resolves.not.toThrow();
    });
  });

  describe('getStreamReader', () => {
    it('should return correct reader for files consumer type', () => {
      const mockReader = {} as any;
      mockJobContext.groupReadFileStream.mockReturnValue(mockReader);

      const result = service['getStreamReader'](mockJobContext, ConsumerType.files);

      expect(result).toBe(mockReader);
      expect(mockJobContext.groupReadFileStream).toHaveBeenCalledWith('files-reader', 500, GroupReaderType.DB_WRITER);
    });

    it('should return correct reader for errors consumer type', () => {
      const mockReader = {} as any;
      mockJobContext.groupReadErrorStream.mockReturnValue(mockReader);

      const result = service['getStreamReader'](mockJobContext, ConsumerType.errors);

      expect(result).toBe(mockReader);
      expect(mockJobContext.groupReadErrorStream).toHaveBeenCalledWith('errors-reader', 500, GroupReaderType.DB_WRITER);
    });

    it('should return correct reader for tasks consumer type', () => {
      const mockReader = {} as any;
      mockJobContext.groupReadTaskStream.mockReturnValue(mockReader);

      const result = service['getStreamReader'](mockJobContext, ConsumerType.tasks);

      expect(result).toBe(mockReader);
      expect(mockJobContext.groupReadTaskStream).toHaveBeenCalledWith('tasks-reader', 500, GroupReaderType.DB_WRITER);
    });

    it('should throw error for invalid consumer type', () => {
      expect(() => service['getStreamReader'](mockJobContext, 'invalid' as any))
        .toThrow("getReader: Invalid consumer type 'invalid'");
    });

    it('should throw error when jobContext is null', () => {
      expect(() => service['getStreamReader'](null as any, ConsumerType.files))
        .toThrow('getReader: jobContext is null or undefined.');
    });
  });

  describe('processFileDataInBatches', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
      service['batchSize'] = 2;
      service['lastFile'] = 'LAST_FILE';
    });

    it('should process file data and flush when batch size reached', async () => {
      const fileData = { fileName: 'test.txt', size: 1024 };
      jest.spyOn(service as any, 'flushInventory').mockResolvedValue(undefined);

      // First file
      await service['processFileDataInBatches']('stream1', fileData, mockJobRunId, mockPathId, mockJobContext);
      
      const context = service['jobConsumerMap'].get(mockJobRunId);
      expect(context?.records).toHaveLength(1);

      // Second file - should trigger flush
      await service['processFileDataInBatches']('stream2', fileData, mockJobRunId, mockPathId, mockJobContext);
      
      expect(service['flushInventory']).toHaveBeenCalledWith(mockJobRunId, mockJobContext);
    });

    it('should handle last file signal', async () => {
      const lastFileData = { fileName: 'LAST_FILE' };
      jest.spyOn(service as any, 'flushInventory').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'signalWorkflowKill').mockResolvedValue(undefined);
      jest.spyOn(service, 'stopConsumer').mockResolvedValue(undefined);

      await service['processFileDataInBatches']('stream1', lastFileData, mockJobRunId, mockPathId, mockJobContext);

      expect(service['flushInventory']).toHaveBeenCalledWith(mockJobRunId, mockJobContext);
      expect(service['signalWorkflowKill']).toHaveBeenCalledWith(mockJobContext, mockJobRunId);
      expect(service.stopConsumer).toHaveBeenCalledWith(mockJobRunId, ConsumerType.files);
    });

    it('should handle null data gracefully', async () => {
      await service['processFileDataInBatches']('stream1', null, mockJobRunId, mockPathId, mockJobContext);

      const context = service['jobConsumerMap'].get(mockJobRunId);
      expect(context).toBeUndefined();
    });

    it('should set timeout for batch flushing', async () => {
      jest.useFakeTimers();
      const fileData = { fileName: 'test.txt' };
      jest.spyOn(service as any, 'flushInventory').mockResolvedValue(undefined);

      await service['processFileDataInBatches']('stream1', fileData, mockJobRunId, mockPathId, mockJobContext);

      const context = service['jobConsumerMap'].get(mockJobRunId);
      expect(context?.flushTimer).toBeDefined();

      // Fast forward time to trigger timeout
      jest.runAllTimers();
      
      jest.useRealTimers();
    });
  });

  describe('Environment Variables', () => {
    it('should use default values when environment variables are not set', () => {
      delete process.env.REDIS_KEY_PREFIX;
      delete process.env.LAST_FILE_NAME;
      delete process.env.BATCH_SIZE;
      delete process.env.BATCH_TIMEOUT_MS;

      const newService = new RedisConsumerService(inventoryService, workflowService);

      expect(newService['REDIS_KEY_PREFIX']).toBe('db-writer');
      expect(newService['lastFile']).toBe('LAST_FILE');
      expect(newService['batchSize']).toBe(500);
      expect(newService['batchTimeoutMs']).toBe(5000);
    });

    it('should use environment variables when set', () => {
      process.env.REDIS_KEY_PREFIX = 'custom-prefix';
      process.env.LAST_FILE_NAME = 'CUSTOM_LAST';
      process.env.BATCH_SIZE = '200';
      process.env.BATCH_TIMEOUT_MS = '2000';

      const newService = new RedisConsumerService(inventoryService, workflowService);

      expect(newService['REDIS_KEY_PREFIX']).toBe('custom-prefix');
      expect(newService['lastFile']).toBe('CUSTOM_LAST');
      expect(newService['batchSize']).toBe(200);
      expect(newService['batchTimeoutMs']).toBe(2000);
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis connection errors in cron job', async () => {
      service['redisClient'] = null;
      (redisUtils.getClient as jest.Mock).mockResolvedValue(null);

      await expect(service.checkAndStartActiveConsumers()).resolves.not.toThrow();
    });

    it('should handle worker creation errors', async () => {
      const consumerStatuses: Record<string, ReaderStatus> = { [ConsumerType.files]: 'active' };
      const error = new Error('Worker creation failed');
      
      service['redisClient'] = mockRedisClient;
      mockRedisClient.keys.mockResolvedValue([`db-writer:${mockJobRunId}:`]);
      jest.spyOn(service, 'getAllConsumerStatuses').mockResolvedValue(consumerStatuses);
      jest.spyOn(service, 'createConsumerWorkerThread').mockRejectedValue(error);
      jest.spyOn(service, 'stopConsumer').mockResolvedValue();

      await service.checkAndStartActiveConsumers();

      // Wait for the async error handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(service.stopConsumer).toHaveBeenCalledWith(mockJobRunId, ConsumerType.files);
    });
  });

  describe('Memory Management', () => {
    it('should clean up contexts and timers properly', async () => {
      const mockTimer1 = setTimeout(() => {}, 1000);
      const mockTimer2 = setTimeout(() => {}, 2000);
      
      const context = {
        jobRunId: mockJobRunId,
        pathId: mockPathId,
        records: [{ id: 1 }, { id: 2 }],
        flushTimer: mockTimer1,
        errorRecoveryTimers: new Set([mockTimer2]),
      };

      service['jobConsumerMap'].set(mockJobRunId, context);
      service['activeWorkers'].set(mockJobRunId, true);

      await service.cleanupResources();

      expect(service['jobConsumerMap'].size).toBe(0);
      expect(service['activeWorkers'].size).toBe(0);
      clearTimeout(mockTimer1);
      clearTimeout(mockTimer2);
    });
  });

  describe('executeConsumerLoop', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should execute consumer loop successfully', async () => {
      const mockReader = {
        async *[Symbol.asyncIterator]() {
          yield { id: 'stream1', data: { fileName: 'test.txt' } };
          yield { id: 'stream2', data: { fileName: 'test2.txt' } };
        }
      };

      jest.spyOn(service, 'isConsumerRunning')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      
      jest.spyOn(service as any, 'getStreamReader').mockReturnValue(mockReader);
      jest.spyOn(service as any, 'processStreamData').mockResolvedValue(undefined);
      jest.spyOn(service, 'removeConsumer').mockResolvedValue(undefined);

      await service.executeConsumerLoop(mockJobRunId, ConsumerType.files);

      expect(service['processStreamData']).toHaveBeenCalledTimes(4);
      expect(service.removeConsumer).toHaveBeenCalledWith(mockJobRunId, ConsumerType.files);
    });

   


    it('should perform final flush on completion', async () => {
      const mockReader = {
        async *[Symbol.asyncIterator]() {
          // Empty iterator
        }
      };

      const mockContext = {
        jobRunId: mockJobRunId,
        pathId: mockPathId,
        records: [{ id: 1 }, { id: 2 }],
        flushTimer: null,
        errorRecoveryTimers: new Set<NodeJS.Timeout>(),
      };

      service['jobConsumerMap'].set(mockJobRunId, mockContext);

      jest.spyOn(service, 'isConsumerRunning').mockResolvedValue(false);
      jest.spyOn(service as any, 'getStreamReader').mockReturnValue(mockReader);
      jest.spyOn(service as any, 'flushInventory').mockResolvedValue(undefined);
      jest.spyOn(service, 'removeConsumer').mockResolvedValue(undefined);

      await service.executeConsumerLoop(mockJobRunId, ConsumerType.files);

      expect(service['flushInventory']).toHaveBeenCalledWith(mockJobRunId, mockJobContext);
      expect(service['jobConsumerMap'].has(mockJobRunId)).toBe(false);
    });
  });

  describe('processStreamData', () => {
    const mockStream = {
      id: 'stream-123',
      data: { fileName: 'test.txt', size: 1024 }
    };

    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should process files consumer type', async () => {
      jest.spyOn(service as any, 'processFileDataInBatches').mockResolvedValue(undefined);

      await service['processStreamData'](mockStream, ConsumerType.files, mockJobRunId, mockJobContext);

      expect(service['processFileDataInBatches']).toHaveBeenCalledWith(
        mockStream.id,
        mockStream.data,
        mockJobRunId,
        mockPathId,
        mockJobContext
      );
    });

    it('should process tasks consumer type and stop on termination signal', async () => {
      const terminationStream = {
        id: 'stream-123',
        data: { id: '8840625a-b818-42a8-98c8-5c05aaa19106' }
      };

      jest.spyOn(service, 'stopConsumer').mockResolvedValue(undefined);

      await service['processStreamData'](terminationStream, ConsumerType.tasks, mockJobRunId, mockJobContext);

      expect(service.stopConsumer).toHaveBeenCalledWith(mockJobRunId, ConsumerType.tasks);
      expect(mockJobContext.groupAckTaskStream).toHaveBeenCalledWith([terminationStream.id], GroupReaderType.DB_WRITER);
    });

    it('should process regular tasks', async () => {
      const taskStream = {
        id: 'stream-123',
        data: { id: 'regular-task-id', name: 'Test Task' }
      };

      await service['processStreamData'](taskStream, ConsumerType.tasks, mockJobRunId, mockJobContext);

      expect(inventoryService.saveTasks).toHaveBeenCalledWith(taskStream.data);
      expect(mockJobContext.groupAckTaskStream).toHaveBeenCalledWith([taskStream.id], GroupReaderType.DB_WRITER);
    });

    it('should process errors consumer type and stop on termination signal', async () => {
      const terminationStream = {
        id: 'stream-123',
        data: { tasks: { taskId: '8840625a-b818-42a8-98c8-5c05aaa19106' } }
      };

      jest.spyOn(service, 'stopConsumer').mockResolvedValue(undefined);

      await service['processStreamData'](terminationStream, ConsumerType.errors, mockJobRunId, mockJobContext);

      expect(service.stopConsumer).toHaveBeenCalledWith(mockJobRunId, ConsumerType.errors);
      expect(mockJobContext.groupAckErrorStream).toHaveBeenCalledWith([terminationStream.id], GroupReaderType.DB_WRITER);
    });

    it('should process regular errors', async () => {
      const errorStream = {
        id: 'stream-123',
        data: {
          operation: { id: 'op-1', error: 'Operation failed' },
          tasks: { id: 'task-1', error: 'Task failed' }
        }
      };

      jest.spyOn(service as any, 'processErrorData').mockResolvedValue(undefined);

      await service['processStreamData'](errorStream, ConsumerType.errors, mockJobRunId, mockJobContext);

      expect(service['processErrorData']).toHaveBeenCalledWith(errorStream.data);
      expect(mockJobContext.groupAckErrorStream).toHaveBeenCalledWith([errorStream.id], GroupReaderType.DB_WRITER);
    });

    it('should handle unknown consumer type', async () => {
      await service['processStreamData'](mockStream, 'unknown' as any, mockJobRunId, mockJobContext);

      // Should not throw, just log warning
      expect(inventoryService.saveTasks).not.toHaveBeenCalled();
      expect(inventoryService.createInventory).not.toHaveBeenCalled();
    });

  });

  describe('Error Handling in processStreamData', () => {
    const mockStream = {
      id: 'stream-123',
      data: { fileName: 'test.txt', size: 1024 }
    };

    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should handle processing errors gracefully', async () => {
      // Create a completely isolated test environment
      const testError = new Error('Test processing error');
      
      // For the files consumer type, processFileDataInBatches is called without await
      // so errors won't be caught by the outer try-catch in processStreamData
      const processFileDataSpy = jest.spyOn(service as any, 'processFileDataInBatches');
      processFileDataSpy.mockImplementation(() => {
        throw testError;
      });

      try {
        // This should not throw because processFileDataInBatches is called without await
        await service['processStreamData'](mockStream, ConsumerType.files, mockJobRunId, mockJobContext);
        expect(true).toBe(true); // Test passes if no error is thrown
      } catch (error) {
        // This should not happen based on the current implementation
        fail('processStreamData should not throw for files consumer type errors: ' + error.message);
      } finally {
        // Always clean up the spy
        processFileDataSpy.mockRestore();
      }
    });
  });

  describe('processErrorData', () => {
    it('should save operation error', async () => {
      const errorData = {
        operation: { id: 'op-1', error: 'Operation failed' }
      };

      await service['processErrorData'](errorData);

      expect(inventoryService.saveOperationError).toHaveBeenCalledWith(errorData.operation);
    });

    it('should save task error', async () => {
      const errorData = {
        tasks: { id: 'task-1', error: 'Task failed' }
      };

      await service['processErrorData'](errorData);

      expect(inventoryService.saveTaskError).toHaveBeenCalledWith(errorData.tasks);
    });

    it('should handle both operation and task errors', async () => {
      const errorData = {
        operation: { id: 'op-1', error: 'Operation failed' },
        tasks: { id: 'task-1', error: 'Task failed' }
      };

      await service['processErrorData'](errorData);

      expect(inventoryService.saveOperationError).toHaveBeenCalledWith(errorData.operation);
      expect(inventoryService.saveTaskError).toHaveBeenCalledWith(errorData.tasks);
    });

    it('should handle null/undefined data', async () => {
      await service['processErrorData'](null);
      await service['processErrorData'](undefined);

      expect(inventoryService.saveOperationError).not.toHaveBeenCalled();
      expect(inventoryService.saveTaskError).not.toHaveBeenCalled();
    });

    it('should handle processing errors', async () => {
      const error = new Error('Save failed');
      inventoryService.saveOperationError.mockRejectedValue(error);

      const errorData = {
        operation: { id: 'op-1', error: 'Operation failed' }
      };

      await expect(service['processErrorData'](errorData)).resolves.not.toThrow();
    });
  });

  describe('flushInventory', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
    });

    it('should flush inventory records successfully', async () => {
      const originalRecords = [
        { fileName: 'file1.txt', streamId: 'stream1' },
        { fileName: 'file2.txt', streamId: 'stream2' }
      ];
      
      const mockContext = {
        jobRunId: mockJobRunId,
        pathId: mockPathId,
        records: [...originalRecords], // Copy the records
        flushTimer: setTimeout(() => {}, 1000),
        errorRecoveryTimers: new Set<NodeJS.Timeout>(),
      };

      service['jobConsumerMap'].set(mockJobRunId, mockContext);

      await service['flushInventory'](mockJobRunId, mockJobContext);

      expect(inventoryService.createInventory).toHaveBeenCalledWith(
        originalRecords, // Check with the original records
        mockJobRunId,
        mockPathId
      );
      expect(mockJobContext.groupAckFileStream).toHaveBeenCalledWith(
        ['stream1', 'stream2'],
        GroupReaderType.DB_WRITER
      );
      expect(mockContext.records).toHaveLength(0); // Records should be cleared after flush
    });

    it('should handle no context gracefully', async () => {
      await service['flushInventory']('non-existent-job', mockJobContext);

      expect(inventoryService.createInventory).not.toHaveBeenCalled();
    });

    it('should handle empty records', async () => {
      const mockContext = {
        jobRunId: mockJobRunId,
        pathId: mockPathId,
        records: [],
        flushTimer: null,
        errorRecoveryTimers: new Set<NodeJS.Timeout>(),
      };

      service['jobConsumerMap'].set(mockJobRunId, mockContext);

      await service['flushInventory'](mockJobRunId, mockJobContext);

      expect(inventoryService.createInventory).not.toHaveBeenCalled();
    });

    it('should restore records on failure', async () => {
      const records = [
        { fileName: 'file1.txt', streamId: 'stream1' },
        { fileName: 'file2.txt', streamId: 'stream2' }
      ];

      const mockContext = {
        jobRunId: mockJobRunId,
        pathId: mockPathId,
        records: [...records],
        flushTimer: null,
        errorRecoveryTimers: new Set<NodeJS.Timeout>(),
      };

      service['jobConsumerMap'].set(mockJobRunId, mockContext);

      const error = new Error('Database error');
      inventoryService.createInventory.mockRejectedValue(error);

      await service['flushInventory'](mockJobRunId, mockJobContext);

      expect(mockContext.records).toHaveLength(2);
      expect(mockContext.records).toEqual(records);
    });

    it('should handle records without streamId', async () => {
      const mockContext = {
        jobRunId: mockJobRunId,
        pathId: mockPathId,
        records: [
          { fileName: 'file1.txt', streamId: 'stream1' },
          { fileName: 'file2.txt' } // No streamId
        ],
        flushTimer: null,
        errorRecoveryTimers: new Set<NodeJS.Timeout>(),
      };

      service['jobConsumerMap'].set(mockJobRunId, mockContext);

      await service['flushInventory'](mockJobRunId, mockJobContext);

      expect(mockJobContext.groupAckFileStream).toHaveBeenCalledWith(
        ['stream1'],
        GroupReaderType.DB_WRITER
      );
    });
  });

  describe('signalWorkflowKill', () => {
    beforeEach(() => {
      mockJobContext.jobConfig.jobType = 'MIGRATE';
      // Clear all mocks before each test in this describe block
      jest.clearAllMocks();
    });

    it('should signal workflow successfully', async () => {
      workflowService.signalWorkflow.mockResolvedValue(undefined);

      await service['signalWorkflowKill'](mockJobContext, mockJobRunId);

      expect(workflowService.signalWorkflow).toHaveBeenCalledWith({
        namespace: 'default',
        workflowExecution: { workflowId: `MIGRATEWorkflow-${mockJobRunId}` },
        signalName: 'reportingSignal',
        input: {
          payloads: [expect.objectContaining({
            data: expect.any(Uint8Array),
            metadata: expect.objectContaining({
              encoding: expect.any(Uint8Array)
            })
          })]
        },
      });
      expect(workflowService.signalWorkflow).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const error = new Error('Signal failed');
      workflowService.signalWorkflow
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(undefined);

      await service['signalWorkflowKill'](mockJobContext, mockJobRunId);

      expect(workflowService.signalWorkflow).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      const error = new Error('Signal failed');
      workflowService.signalWorkflow.mockRejectedValue(error);

      await expect(service['signalWorkflowKill'](mockJobContext, mockJobRunId))
        .rejects.toThrow('Signal failed');

      expect(workflowService.signalWorkflow).toHaveBeenCalledTimes(3);
    });
  });
});
