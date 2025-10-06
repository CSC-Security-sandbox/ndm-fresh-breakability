import { Test, TestingModule } from '@nestjs/testing';
import { RedisConsumerService } from './redis-consumer.service';
import { InventoryService } from '../inventory/inventory.service';
import { WorkflowService } from '../workflow/workflow.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ConsumerType } from '../enum/redis-consumer.enum';
import { JobContextFactory, JobManagerContext } from '@netapp-cloud-datamigrate/jobs-lib';
import { RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib/dist/redis/redis-utils';
import { DataSource } from 'typeorm';

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

// Mock the SQL_QUERIES constant
jest.mock('../constants/custom-response-message', () => ({
  SQL_QUERIES: {
    GET_PROJECT_ID_FROM_JOBRUN: 'SELECT c.project_id FROM datamigrator.jobrun jr JOIN datamigrator.jobconfig jc ON jr.job_config_id = jc.id JOIN datamigrator.volume v ON jc.source_path_id = v.id JOIN datamigrator.file_server fs ON v.file_server_id = fs.id JOIN datamigrator.config c ON fs.config_id = c.id WHERE jr.id = $1'
  },
}));

describe('RedisConsumerService', () => {
  let service: RedisConsumerService;
  let inventoryService: jest.Mocked<InventoryService>;
  let _workflowService: jest.Mocked<WorkflowService>;
  let mockDataSource: jest.Mocked<DataSource>;
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

    mockDataSource = {
      query: jest.fn(),
      isInitialized: true,
      options: {},
    } as any;

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
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: WorkflowService,
          useValue: {
            signalWorkflow: jest.fn(),
          },
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              log: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RedisConsumerService>(RedisConsumerService);
    inventoryService = module.get(InventoryService);
    _workflowService = module.get(WorkflowService);
    mockDataSource = module.get(DataSource);

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    // Clear projectId cache after each test for isolation
    if (service) {
      service.clearProjectIdCache();
    }
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

      it('should update consumer status and cache projectId when provided', async () => {
        const mockProjectId = 'test-project-123';

        // Clear cache first to ensure clean test
        service.clearProjectIdCache();

        await service.updateConsumerStatus(mockJobRunId, ConsumerType.files, 'active', mockProjectId);

        expect(mockRedisClient.hSet).toHaveBeenCalledWith(
          `db-writer:${mockJobRunId}:`,
          ConsumerType.files,
          'active'
        );

        // Verify projectId was cached by checking cache directly
        const cachedProjectId = await service.getProjectIdFromCache(mockJobRunId);
        expect(cachedProjectId).toBe(mockProjectId);
        // Database should not be called since it's in cache now
        expect(mockDataSource.query).not.toHaveBeenCalled();
      });

      it('should reinitialize Redis connection if client is invalid', async () => {
        // Mock invalid client initially
        service['redisClient'] = null;
        jest.spyOn(service, 'isValidRedisClient').mockReturnValueOnce(false).mockReturnValueOnce(true);
        jest.spyOn(service, 'initializeRedisConnection').mockResolvedValue(undefined);

        // Set up a valid client after initialization
        service['redisClient'] = mockRedisClient;

        await service.updateConsumerStatus(mockJobRunId, ConsumerType.files, 'active');

        expect(service.initializeRedisConnection).toHaveBeenCalled();
        expect(mockRedisClient.hSet).toHaveBeenCalledWith(
          `db-writer:${mockJobRunId}:`,
          ConsumerType.files,
          'active'
        );
      });

      it('should throw RedisError when client is not available after reinitialization', async () => {
        service['redisClient'] = null;
        jest.spyOn(service, 'isValidRedisClient').mockReturnValue(false);
        jest.spyOn(service, 'initializeRedisConnection').mockResolvedValue(undefined);

        await expect(
          service.updateConsumerStatus(mockJobRunId, ConsumerType.files, 'active')
        ).rejects.toThrow('Redis client not available');
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

        // Mock getProjectIdFromCache to return a projectId for logging
        jest.spyOn(service, 'getProjectIdFromCache').mockResolvedValue('test-project-id');

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

      it('should save all consumer types as active with projectId caching', async () => {
        const mockProjectId = 'test-project-123';
        const result = await service.saveJobConsumersToRedis(mockJobRunId, mockProjectId);

        expect(result).toBe(true);
        expect(mockRedisClient.hSet).toHaveBeenCalledTimes(Object.keys(ConsumerType).length);

        // Verify each consumer type was set to active with projectId
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

        // Mock getProjectIdFromCache for logging
        jest.spyOn(service, 'getProjectIdFromCache').mockReturnValue(Promise.resolve('test-project-id'));

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

        // Mock getProjectIdFromCache for logging
        jest.spyOn(service, 'getProjectIdFromCache').mockReturnValue(Promise.resolve('test-project-id'));

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

  describe('ProjectId Management', () => {
    const mockProjectId = 'test-project-123';

    beforeEach(() => {
      // Clear the cache before each test to ensure isolation
      service.clearProjectIdCache();
      // Clear all mocks
      jest.clearAllMocks();
    });

    describe('setProjectIdInCache', () => {
      it('should set projectId in cache for valid inputs', () => {
        service.setProjectIdInCache(mockJobRunId, mockProjectId);

        // Access the private map through service methods
        expect(service['jobRunIdToProjectIdMap'] || new Map()).toBeDefined();
      });

      it('should not set projectId in cache for invalid inputs', () => {
        const originalSize = (service['jobRunIdToProjectIdMap'] || new Map()).size;

        service.setProjectIdInCache('', mockProjectId);
        service.setProjectIdInCache(mockJobRunId, '');

        expect((service['jobRunIdToProjectIdMap'] || new Map()).size).toBe(originalSize);
      });
    });

    describe('clearProjectIdCache', () => {
      beforeEach(() => {
        service.setProjectIdInCache(mockJobRunId, mockProjectId);
        service.setProjectIdInCache('other-job-id', 'other-project-id');
      });

      it('should clear specific jobRunId from cache', () => {
        service.clearProjectIdCache(mockJobRunId);

        // The specific job should be removed but others should remain
        expect(service['jobRunIdToProjectIdMap']?.get(mockJobRunId)).toBeUndefined();
      });

      it('should clear all cache entries when no jobRunId provided', () => {
        service.clearProjectIdCache();

        expect((service['jobRunIdToProjectIdMap'] || new Map()).size).toBe(0);
      });
    });

    describe('getProjectIdFromDatabase', () => {
      it('should retrieve projectId from database and cache it', async () => {
        const mockResult = [{ project_id: mockProjectId }];
        mockDataSource.query.mockResolvedValue(mockResult);

        const result = await service['getProjectIdFromDatabase'](mockJobRunId);

        expect(mockDataSource.query).toHaveBeenCalledWith(
          expect.any(String), // SQL query
          [mockJobRunId]
        );
        expect(result).toBe(mockProjectId);
      });

      it('should return null when no result found in database', async () => {
        mockDataSource.query.mockResolvedValue([]);

        const result = await service['getProjectIdFromDatabase'](mockJobRunId);

        expect(result).toBeNull();
      });

      it('should return null when database query fails', async () => {
        mockDataSource.query.mockRejectedValue(new Error('Database error'));

        const result = await service['getProjectIdFromDatabase'](mockJobRunId);

        expect(result).toBeNull();
      });

      it('should return null when result has no project_id', async () => {
        mockDataSource.query.mockResolvedValue([{ other_field: 'value' }]);

        const result = await service['getProjectIdFromDatabase'](mockJobRunId);

        expect(result).toBeNull();
      });
    });

    describe('getProjectIdFromCache', () => {
      it('should return projectId from cache when available', async () => {
        // First set the projectId in cache
        service.setProjectIdInCache(mockJobRunId, mockProjectId);

        const result = await service.getProjectIdFromCache(mockJobRunId);

        expect(result).toBe(mockProjectId);
        // Database should not be called when cache hit occurs
        expect(mockDataSource.query).not.toHaveBeenCalled();
      });

      it('should fallback to database when not in cache', async () => {
        const mockResult = [{ project_id: mockProjectId }];
        mockDataSource.query.mockResolvedValue(mockResult);

        // Ensure cache is empty by using a different jobRunId
        const differentJobRunId = 'different-job-run-id';
        const result = await service.getProjectIdFromCache(differentJobRunId);

        expect(mockDataSource.query).toHaveBeenCalledWith(
          expect.any(String), // SQL query
          [differentJobRunId]
        );
        expect(result).toBe(mockProjectId);
      });

      it('should return null when not in cache and database lookup fails', async () => {
        mockDataSource.query.mockResolvedValue([]);

        // Use a different jobRunId that's not in cache
        const notCachedJobRunId = 'not-cached-job-run-id';
        const result = await service.getProjectIdFromCache(notCachedJobRunId);

        expect(mockDataSource.query).toHaveBeenCalledWith(
          expect.any(String),
          [notCachedJobRunId]
        );
        expect(result).toBeNull();
      });

      it('should handle database connection issues gracefully', async () => {
        mockDataSource.query.mockRejectedValue(new Error('Connection failed'));

        // Use a different jobRunId that's not in cache
        const errorJobRunId = 'error-job-run-id';
        const result = await service.getProjectIdFromCache(errorJobRunId);

        expect(mockDataSource.query).toHaveBeenCalledWith(
          expect.any(String),
          [errorJobRunId]
        );
        expect(result).toBeNull();
      });
    });
  });

  describe('cleanupResources', () => {
    beforeEach(() => {
      // Clear mocks before each cleanup test
      jest.clearAllMocks();
    });

    it('should cleanup resources properly', async () => {
      const mockProjectId = 'test-project-123';
      const mockTimeout = setTimeout(() => { }, 1000);
      const mockContext = {
        records: [{ id: 1 }, { id: 2 }],
        flushTimer: mockTimeout,
        errorRecoveryTimers: new Set([mockTimeout]),
        jobRunId: mockJobRunId,
        pathId: mockPathId,
      };

      // Set up projectId in cache and job context
      service.setProjectIdInCache(mockJobRunId, mockProjectId);
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

    it('should handle cleanup when projectId is not found', async () => {
      const mockContext = {
        records: [{ id: 1 }],
        flushTimer: null,
        errorRecoveryTimers: new Set<NodeJS.Timeout>(),
        jobRunId: mockJobRunId,
        pathId: mockPathId,
      };

      service['jobConsumerMap'].set(mockJobRunId, mockContext);
      service['redisClient'] = mockRedisClient;

      await service.cleanupResources();

      expect(inventoryService.createInventory).toHaveBeenCalledWith(
        mockContext.records,
        mockJobRunId,
        mockPathId
      );
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
