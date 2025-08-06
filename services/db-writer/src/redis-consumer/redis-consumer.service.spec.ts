import { Test, TestingModule } from '@nestjs/testing';
import { RedisConsumerService } from './redis-consumer.service';
import { InventoryService } from '../inventory/inventory.service';
import { WorkflowService } from '../workflow/workflow.service';
import { ConsumerType } from '../enum/redis-consumer.enum';
import { JobContextFactory, JobManagerContext } from '@netapp-cloud-datamigrate/jobs-lib';
import { RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib/dist/redis/redis-utils';

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
  Column: jest.fn(() => (_target: any, _propertyKey: string) => {}),
  PrimaryGeneratedColumn: jest.fn(() => (_target: any, _propertyKey: string) => {}),
  CreateDateColumn: jest.fn(() => (_target: any, _propertyKey: string) => {}),
  UpdateDateColumn: jest.fn(() => (_target: any, _propertyKey: string) => {}),
  OneToMany: jest.fn(() => (_target: any, _propertyKey: string) => {}),
  ManyToOne: jest.fn(() => (_target: any, _propertyKey: string) => {}),
  JoinColumn: jest.fn(() => (_target: any, _propertyKey: string) => {}),
}));

// Mock NestJS TypeORM module
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: jest.fn(() => (_target: any, _propertyKey: string | symbol | undefined, _parameterIndex: number) => {}),
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
jest.mock('@netapp-cloud-datamigrate/jobs-lib/dist/redis/redis-utils', () => ({
  RedisUtils: {
    getClient: jest.fn(),
  },
}));
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
  let _workflowService: jest.Mocked<WorkflowService>;
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
      isOpen: true, // Add isOpen property for isValidRedisClient check
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
    (RedisUtils.getClient as jest.Mock).mockResolvedValue(mockRedisClient);

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
    _workflowService = module.get(WorkflowService);

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
      (RedisUtils.getClient as jest.Mock).mockResolvedValue(mockRedisClient);

      await service.initializeRedisConnection();

      expect(RedisUtils.getClient).toHaveBeenCalled();
      expect(service['redisClient']).toBe(mockRedisClient);
    });

    it('should reinitialize Redis client if not available', async () => {
      service['redisClient'] = null;
      (RedisUtils.getClient as jest.Mock).mockResolvedValue(mockRedisClient);

      await service.updateConsumerStatus(mockJobRunId, ConsumerType.files, 'active');

      expect(RedisUtils.getClient).toHaveBeenCalled();
      expect(mockRedisClient.hSet).toHaveBeenCalled();
    });

    it('should not reinitialize if client already exists and is valid', async () => {
      // Set client to existing mock with isOpen = true
      mockRedisClient.isOpen = true;
      service['redisClient'] = mockRedisClient;
      (RedisUtils.getClient as jest.Mock).mockClear(); // Clear previous calls

      await service.initializeRedisConnection();

      expect(RedisUtils.getClient).toHaveBeenCalledTimes(0);
      expect(service['redisClient']).toBe(mockRedisClient);
    });
  });

  describe('Redis operations', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
      mockRedisClient.isOpen = true;
    });

    describe('updateConsumerStatus', () => {
      it('should update consumer status in Redis', async () => {
        await service.updateConsumerStatus(mockJobRunId, ConsumerType.files, 'active');

        expect(mockRedisClient.hSet).toHaveBeenCalledWith(
          `db-writer:${mockJobRunId}:`,
          ConsumerType.files,
          'active'
        );
      });
    });

    describe('getConsumerStatus', () => {
      it('should get consumer status from Redis', async () => {
        mockRedisClient.hGet.mockResolvedValue('active');

        const result = await service.getConsumerStatus(mockJobRunId, ConsumerType.files);

        expect(mockRedisClient.hGet).toHaveBeenCalledWith(
          `db-writer:${mockJobRunId}:`,
          ConsumerType.files
        );
        expect(result).toBe('active');
      });

      it('should return null when Redis client is not available', async () => {
        // Mock the isValidRedisClient to return false after initialization attempt
        jest.spyOn(service, 'isValidRedisClient').mockReturnValue(false);
        
        // Mock initializeRedisConnection to do nothing (simulating failed initialization)
        jest.spyOn(service, 'initializeRedisConnection').mockResolvedValue(undefined);
        
        service['redisClient'] = null;

        const result = await service.getConsumerStatus(mockJobRunId, ConsumerType.files);

        expect(result).toBeNull();
        
        // Restore mocks
        jest.restoreAllMocks();
      });
    });

    describe('getAllConsumerStatuses', () => {
      it('should get all consumer statuses from Redis', async () => {
        const expectedStatuses = {
          [ConsumerType.files]: 'active',
          [ConsumerType.errors]: 'inactive',
        };
        mockRedisClient.hGetAll.mockResolvedValue(expectedStatuses);

        const result = await service.getAllConsumerStatuses(mockJobRunId);

        expect(mockRedisClient.hGetAll).toHaveBeenCalledWith(`db-writer:${mockJobRunId}:`);
        expect(result).toEqual(expectedStatuses);
      });

      it('should return empty object when Redis operation fails', async () => {
        mockRedisClient.hGetAll.mockRejectedValue(new Error('Redis error'));

        const result = await service.getAllConsumerStatuses(mockJobRunId);

        expect(result).toEqual({});
      });
    });

    describe('isConsumerRunning', () => {
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

      it('should return false when Redis operation fails', async () => {
        mockRedisClient.hGet.mockRejectedValue(new Error('Redis error'));

        const result = await service.isConsumerRunning(mockJobRunId, ConsumerType.files);

        expect(result).toBe(false);
      });
    });

    describe('saveJobConsumersToRedis', () => {
      it('should save all consumer types as active', async () => {
        const result = await service.saveJobConsumersToRedis(mockJobRunId);

        expect(result).toBe(true);
        expect(mockRedisClient.hSet).toHaveBeenCalledTimes(Object.keys(ConsumerType).length);
        
        // Verify each consumer type was set to active
        Object.values(ConsumerType).forEach(type => {
          expect(mockRedisClient.hSet).toHaveBeenCalledWith(
            `db-writer:${mockJobRunId}:`,
            type,
            'active'
          );
        });
      });

      it('should throw error when Redis operation fails', async () => {
        mockRedisClient.hSet.mockRejectedValue(new Error('Redis error'));

        await expect(service.saveJobConsumersToRedis(mockJobRunId)).rejects.toThrow('Redis error');
      });
    });

    describe('removeConsumer', () => {
      it('should remove consumer from Redis', async () => {
        await service.removeConsumer(mockJobRunId, ConsumerType.files);

        expect(mockRedisClient.hDel).toHaveBeenCalledWith(
          `db-writer:${mockJobRunId}:`,
          ConsumerType.files
        );
      });

      it('should skip removal when Redis client is not available', async () => {
        service['redisClient'] = null;

        await service.removeConsumer(mockJobRunId, ConsumerType.files);

        expect(mockRedisClient.hDel).not.toHaveBeenCalled();
      });
    });

    describe('removeJobFromRedis', () => {
      it('should remove job from Redis', async () => {
        await service.removeJobFromRedis(mockJobRunId);

        expect(mockRedisClient.del).toHaveBeenCalledWith(`db-writer:${mockJobRunId}:`);
      });

      it('should skip removal when Redis client is not available', async () => {
        service['redisClient'] = null;

        await service.removeJobFromRedis(mockJobRunId);

        expect(mockRedisClient.del).not.toHaveBeenCalled();
      });
    });
  });

  describe('stopConsumer', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
      mockRedisClient.isOpen = true;
    });

    it('should stop a consumer by setting it to inactive', async () => {
      await service.stopConsumer(mockJobRunId, ConsumerType.files);

      expect(mockRedisClient.hSet).toHaveBeenCalledWith(
        `db-writer:${mockJobRunId}:`,
        ConsumerType.files,
        'inactive'
      );
    });
  });

  describe('stopAllConsumers', () => {
    beforeEach(() => {
      service['redisClient'] = mockRedisClient;
      mockRedisClient.isOpen = true;
    });

    it('should stop all consumers for a job', async () => {
      const consumerStatuses = {
        [ConsumerType.files]: 'active',
        [ConsumerType.errors]: 'active',
        [ConsumerType.tasks]: 'inactive',
      };
      mockRedisClient.hGetAll.mockResolvedValue(consumerStatuses);

      await service.stopAllConsumers(mockJobRunId);

      // Should call updateConsumerStatus for each consumer type
      Object.keys(consumerStatuses).forEach(type => {
        expect(mockRedisClient.hSet).toHaveBeenCalledWith(
          `db-writer:${mockJobRunId}:`,
          type,
          'inactive'
        );
      });

      // Should remove the job from Redis
      expect(mockRedisClient.del).toHaveBeenCalledWith(`db-writer:${mockJobRunId}:`);
    });
  });

  describe('cleanupResources', () => {
    it('should cleanup resources properly', async () => {
      const mockContext = {
        records: [{ id: 1 }, { id: 2 }],
        flushTimer: setTimeout(() => {}, 1000),
        errorRecoveryTimers: new Set([setTimeout(() => {}, 1000)]),
        jobRunId: mockJobRunId,
        pathId: mockPathId,
      };

      service['jobConsumerMap'].set(mockJobRunId, mockContext);
      service['activeWorkers'].set(mockJobRunId, true);
      service['redisClient'] = mockRedisClient;

      await service.cleanupResources();

      expect(inventoryService.createInventory).toHaveBeenCalledWith(
        mockContext.records,
        mockJobRunId,
        mockPathId
      );
      expect(service['jobConsumerMap'].size).toBe(0);
      expect(service['activeWorkers'].size).toBe(0);
    });
  });

  describe('isValidRedisClient', () => {
    it('should return true for valid client', () => {
      service['redisClient'] = { isOpen: true };
      expect(service.isValidRedisClient()).toBe(true);
    });

    it('should return false for invalid client', () => {
      service['redisClient'] = { isOpen: false };
      expect(service.isValidRedisClient()).toBe(false);
    });

    it('should return false for null client', () => {
      service['redisClient'] = null;
      expect(service.isValidRedisClient()).toBe(false);
    });
  });
});
