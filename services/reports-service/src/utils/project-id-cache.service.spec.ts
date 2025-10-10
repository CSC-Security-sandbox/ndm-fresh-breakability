import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProjectIdCacheService, SQL_QUERIES } from './project-id-cache.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

describe('ProjectIdCacheService', () => {
  let service: ProjectIdCacheService;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockLogger: any;
  let mockLoggerFactory: jest.Mocked<LoggerFactory>;

  beforeEach(async () => {
    // Mock logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    // Mock LoggerFactory
    mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    } as any;

    // Mock DataSource
    mockDataSource = {
      query: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectIdCacheService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    service = module.get<ProjectIdCacheService>(ProjectIdCacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Clear cache after each test
    service.clearProjectIdCache();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should create service with LoggerFactory', () => {
      expect(mockLoggerFactory.create).toHaveBeenCalledWith('ProjectIdCacheService');
    });

    it('should fallback to NestJS Logger when LoggerFactory is not provided', async () => {
      const moduleWithoutLogger: TestingModule = await Test.createTestingModule({
        providers: [
          ProjectIdCacheService,
          {
            provide: DataSource,
            useValue: mockDataSource,
          },
        ],
      }).compile();

      const serviceWithoutLogger = moduleWithoutLogger.get<ProjectIdCacheService>(ProjectIdCacheService);
      expect(serviceWithoutLogger).toBeDefined();
    });
  });

  describe('getProjectIdFromCache', () => {
    const mockJobRunId = 'test-job-run-id';
    const mockProjectId = 'test-project-id';

    describe('cache hit scenarios', () => {
      it('should return projectId from cache when available', async () => {
        // Pre-populate cache
        service.setProjectIdInCache(mockJobRunId, mockProjectId);

        const result = await service.getProjectIdFromCache(mockJobRunId);

        expect(result).toBe(mockProjectId);
        expect(mockLogger.log).toHaveBeenCalledWith(
          `Retrieved projectId: ${mockProjectId} from cache for jobRunId: ${mockJobRunId}`
        );
        expect(mockDataSource.query).not.toHaveBeenCalled();
      });
    });

    describe('cache miss scenarios - database lookup', () => {
      it('should fetch from database when not in cache and cache the result', async () => {
        mockDataSource.query.mockResolvedValue([{ project_id: mockProjectId }]);

        const result = await service.getProjectIdFromCache(mockJobRunId);

        expect(result).toBe(mockProjectId);
        expect(mockLogger.log).toHaveBeenCalledWith(
          `ProjectId not found in cache for jobRunId: ${mockJobRunId}, attempting database lookup`
        );
        expect(mockDataSource.query).toHaveBeenCalledWith(
          SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN,
          [mockJobRunId]
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
          `Retrieved projectId: ${mockProjectId} from database for jobRunId: ${mockJobRunId}`
        );
        expect(mockLogger.log).toHaveBeenCalledWith(
          `Cached projectId: ${mockProjectId} for jobRunId: ${mockJobRunId}`
        );

        // Verify it's now cached
        const cachedResult = await service.getProjectIdFromCache(mockJobRunId);
        expect(cachedResult).toBe(mockProjectId);
        expect(mockDataSource.query).toHaveBeenCalledTimes(1); // Should not call database again
      });

      it('should return null when no result found in database', async () => {
        mockDataSource.query.mockResolvedValue([]);

        const result = await service.getProjectIdFromCache(mockJobRunId);

        expect(result).toBeNull();
        expect(mockLogger.log).toHaveBeenCalledWith(
          `No projectId found in database for jobRunId ${mockJobRunId}`
        );
      });

      it('should return null when database returns empty result', async () => {
        mockDataSource.query.mockResolvedValue(null);

        const result = await service.getProjectIdFromCache(mockJobRunId);

        expect(result).toBeNull();
        expect(mockLogger.log).toHaveBeenCalledWith(
          `No projectId found in database for jobRunId ${mockJobRunId}`
        );
      });

      it('should return null when database returns result without project_id', async () => {
        mockDataSource.query.mockResolvedValue([{ other_field: 'value' }]);

        const result = await service.getProjectIdFromCache(mockJobRunId);

        expect(result).toBeNull();
        expect(mockLogger.log).toHaveBeenCalledWith(
          `No projectId found in database for jobRunId ${mockJobRunId}`
        );
      });

      it('should handle database errors gracefully', async () => {
        const dbError = new Error('Database connection failed');
        mockDataSource.query.mockRejectedValue(dbError);

        const result = await service.getProjectIdFromCache(mockJobRunId);

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          `Error getting projectId from database for jobRunId ${mockJobRunId}: `,
          dbError
        );
      });
    });

    describe('edge cases', () => {
      it('should handle empty jobRunId', async () => {
        const result = await service.getProjectIdFromCache('');

        expect(result).toBeNull();
      });

      it('should handle null jobRunId', async () => {
        const result = await service.getProjectIdFromCache(null as any);

        expect(result).toBeNull();
      });

      it('should handle undefined jobRunId', async () => {
        const result = await service.getProjectIdFromCache(undefined as any);

        expect(result).toBeNull();
      });
    });
  });

  describe('setProjectIdInCache', () => {
    const mockJobRunId = 'test-job-run-id';
    const mockProjectId = 'test-project-id';

    it('should cache projectId for jobRunId', () => {
      service.setProjectIdInCache(mockJobRunId, mockProjectId);

      expect(mockLogger.log).toHaveBeenCalledWith(
        `Cached projectId: ${mockProjectId} for jobRunId: ${mockJobRunId}`
      );

      // Verify it's cached by checking stats
      const stats = service.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries).toEqual([{ jobRunId: mockJobRunId, projectId: mockProjectId }]);
    });

    it('should not cache when projectId is empty', () => {
      service.setProjectIdInCache(mockJobRunId, '');

      expect(mockLogger.log).not.toHaveBeenCalled();
      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should not cache when jobRunId is empty', () => {
      service.setProjectIdInCache('', mockProjectId);

      expect(mockLogger.log).not.toHaveBeenCalled();
      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should not cache when both parameters are null', () => {
      service.setProjectIdInCache(null as any, null as any);

      expect(mockLogger.log).not.toHaveBeenCalled();
      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should update existing cache entry', () => {
      const newProjectId = 'new-project-id';
      
      // Set initial cache
      service.setProjectIdInCache(mockJobRunId, mockProjectId);
      
      // Update with new value
      service.setProjectIdInCache(mockJobRunId, newProjectId);

      const stats = service.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries[0].projectId).toBe(newProjectId);
    });
  });

  describe('clearProjectIdCache', () => {
    const mockJobRunId1 = 'job-run-1';
    const mockJobRunId2 = 'job-run-2';
    const mockProjectId1 = 'project-1';
    const mockProjectId2 = 'project-2';

    beforeEach(() => {
      // Populate cache with test data
      service.setProjectIdInCache(mockJobRunId1, mockProjectId1);
      service.setProjectIdInCache(mockJobRunId2, mockProjectId2);
    });

    it('should clear specific jobRunId from cache', () => {
      service.clearProjectIdCache(mockJobRunId1);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Cleared projectId cache for jobRunId: ${mockJobRunId1}`
      );

      const stats = service.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries[0].jobRunId).toBe(mockJobRunId2);
    });

    it('should clear all cache entries when no jobRunId provided', () => {
      service.clearProjectIdCache();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Cleared all projectId cache entries: 2 items'
      );

      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });

    it('should handle clearing non-existent jobRunId gracefully', () => {
      service.clearProjectIdCache('non-existent-job-run');

      // Should not log anything for non-existent entries
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Cleared projectId cache for jobRunId: non-existent-job-run')
      );

      const stats = service.getCacheStats();
      expect(stats.size).toBe(2); // Original entries should remain
    });

    it('should handle clearing empty cache', () => {
      service.clearProjectIdCache(); // Clear first time
      service.clearProjectIdCache(); // Clear again when empty

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Cleared all projectId cache entries: 0 items'
      );
    });
  });

  describe('logWithProjectId', () => {
    const mockJobRunId = 'test-job-run-id';
    const mockProjectId = 'test-project-id';
    const testMessage = 'Test message';

    it('should log with project context when projectId is found', async () => {
      service.setProjectIdInCache(mockJobRunId, mockProjectId);

      await service.logWithProjectId(mockJobRunId, testMessage);

      expect(mockLogger.log).toHaveBeenCalledWith(`projectId: ${mockProjectId} ${testMessage}`);
    });

    it('should log without project context when projectId is not found', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await service.logWithProjectId(mockJobRunId, testMessage);

      expect(mockLogger.log).toHaveBeenCalledWith(testMessage);
    });

    it('should support different log levels', async () => {
      service.setProjectIdInCache(mockJobRunId, mockProjectId);

      await service.logWithProjectId(mockJobRunId, testMessage, 'warn');
      expect(mockLogger.warn).toHaveBeenCalledWith(`projectId: ${mockProjectId} ${testMessage}`);

      await service.logWithProjectId(mockJobRunId, testMessage, 'error');
      expect(mockLogger.error).toHaveBeenCalledWith(`projectId: ${mockProjectId} ${testMessage}`);

      await service.logWithProjectId(mockJobRunId, testMessage, 'debug');
      expect(mockLogger.debug).toHaveBeenCalledWith(`projectId: ${mockProjectId} ${testMessage}`);
    });

    it('should default to log level when not specified', async () => {
      service.setProjectIdInCache(mockJobRunId, mockProjectId);

      await service.logWithProjectId(mockJobRunId, testMessage);

      expect(mockLogger.log).toHaveBeenCalledWith(`projectId: ${mockProjectId} ${testMessage}`);
    });
  });

  describe('getCacheStats', () => {
    it('should return empty stats for empty cache', () => {
      const stats = service.getCacheStats();

      expect(stats).toEqual({
        size: 0,
        entries: [],
      });
    });

    it('should return correct stats for populated cache', () => {
      const mockJobRunId1 = 'job-run-1';
      const mockJobRunId2 = 'job-run-2';
      const mockProjectId1 = 'project-1';
      const mockProjectId2 = 'project-2';

      service.setProjectIdInCache(mockJobRunId1, mockProjectId1);
      service.setProjectIdInCache(mockJobRunId2, mockProjectId2);

      const stats = service.getCacheStats();

      expect(stats.size).toBe(2);
      expect(stats.entries).toHaveLength(2);
      expect(stats.entries).toContainEqual({ jobRunId: mockJobRunId1, projectId: mockProjectId1 });
      expect(stats.entries).toContainEqual({ jobRunId: mockJobRunId2, projectId: mockProjectId2 });
    });

    it('should return updated stats after cache modifications', () => {
      const mockJobRunId = 'job-run-id';
      const mockProjectId = 'project-id';

      // Initially empty
      expect(service.getCacheStats().size).toBe(0);

      // Add entry
      service.setProjectIdInCache(mockJobRunId, mockProjectId);
      expect(service.getCacheStats().size).toBe(1);

      // Clear entry
      service.clearProjectIdCache(mockJobRunId);
      expect(service.getCacheStats().size).toBe(0);
    });
  });

  describe('SQL_QUERIES constant', () => {
    it('should have correct SQL query structure', () => {
      expect(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN).toBeDefined();
      expect(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN).toContain('SELECT c.project_id');
      expect(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN).toContain('FROM datamigrator.jobrun jr');
      expect(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN).toContain('JOIN datamigrator.jobconfig jc');
      expect(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN).toContain('JOIN datamigrator.volume v');
      expect(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN).toContain('JOIN datamigrator.file_server fs');
      expect(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN).toContain('JOIN datamigrator.config c');
      expect(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN).toContain('WHERE jr.id = $1');
    });
  });

  describe('integration scenarios', () => {
    const mockJobRunId = 'integration-job-run-id';
    const mockProjectId = 'integration-project-id';

    it('should handle complete cache lifecycle', async () => {
      // 1. Cache miss - should query database
      mockDataSource.query.mockResolvedValue([{ project_id: mockProjectId }]);
      
      const result1 = await service.getProjectIdFromCache(mockJobRunId);
      expect(result1).toBe(mockProjectId);
      expect(mockDataSource.query).toHaveBeenCalledTimes(1);

      // 2. Cache hit - should not query database
      const result2 = await service.getProjectIdFromCache(mockJobRunId);
      expect(result2).toBe(mockProjectId);
      expect(mockDataSource.query).toHaveBeenCalledTimes(1); // Still only 1 call

      // 3. Clear specific cache entry
      service.clearProjectIdCache(mockJobRunId);

      // 4. Cache miss again - should query database
      const result3 = await service.getProjectIdFromCache(mockJobRunId);
      expect(result3).toBe(mockProjectId);
      expect(mockDataSource.query).toHaveBeenCalledTimes(2); // Now 2 calls
    });

    it('should handle concurrent requests for same jobRunId', async () => {
      mockDataSource.query.mockResolvedValue([{ project_id: mockProjectId }]);

      // Simulate concurrent requests
      const promises = [
        service.getProjectIdFromCache(mockJobRunId),
        service.getProjectIdFromCache(mockJobRunId),
        service.getProjectIdFromCache(mockJobRunId),
      ];

      const results = await Promise.all(promises);

      // All should return the same result
      results.forEach(result => expect(result).toBe(mockProjectId));
      
      // Database might be called multiple times due to race condition, but results should be consistent
      expect(mockDataSource.query).toHaveBeenCalled();
    });

    it('should maintain separate cache entries for different jobRunIds', async () => {
      const jobRunId1 = 'job-1';
      const jobRunId2 = 'job-2';
      const projectId1 = 'project-1';
      const projectId2 = 'project-2';

      service.setProjectIdInCache(jobRunId1, projectId1);
      service.setProjectIdInCache(jobRunId2, projectId2);

      const result1 = await service.getProjectIdFromCache(jobRunId1);
      const result2 = await service.getProjectIdFromCache(jobRunId2);

      expect(result1).toBe(projectId1);
      expect(result2).toBe(projectId2);

      const stats = service.getCacheStats();
      expect(stats.size).toBe(2);
    });
  });

  describe('error scenarios', () => {
    it('should handle database timeout gracefully', async () => {
      const timeoutError = new Error('Connection timeout');
      mockDataSource.query.mockRejectedValue(timeoutError);

      const result = await service.getProjectIdFromCache('timeout-job-run');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error getting projectId from database for jobRunId timeout-job-run: ',
        timeoutError
      );
    });

    it('should handle malformed database response', async () => {
      mockDataSource.query.mockResolvedValue('invalid-response');

      const result = await service.getProjectIdFromCache('malformed-job-run');

      expect(result).toBeNull();
      expect(mockLogger.log).toHaveBeenCalledWith(
        'No projectId found in database for jobRunId malformed-job-run'
      );
    });
  });
});