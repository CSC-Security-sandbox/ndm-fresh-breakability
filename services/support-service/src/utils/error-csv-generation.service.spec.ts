import { OperationErrorService } from './error-csv-generation.service';
import { OperationErrorExportData } from 'src/constants/types';
import { GET_OPERATION_ERRORS_BY_DATE_RANGE } from 'src/constants/sql-queries';

describe('OperationErrorService', () => {
  let service: OperationErrorService;
  let mockQuery: jest.MockedFunction<any>;
  let mockRepository: any;

  beforeEach(() => {
    // Create mock repository with all necessary methods
    mockQuery = jest.fn();
    mockRepository = {
      query: mockQuery,
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    // Instantiate service directly
    service = new OperationErrorService(mockRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should inject repository correctly', () => {
      expect(service).toBeDefined();
      expect(mockRepository).toBeDefined();
    });
  });

  describe('getOperationErrorsByProjectAndDateRange', () => {
    const projectIds = ['project-1', 'project-2'];
    const startDate = '2023-01-01';
    const endDate = '2023-12-31';

    const mockOperationErrors: OperationErrorExportData[] = [
      {
        id: '1',
        operationId: 'op-1',
        errorCode: 'ERR001',
        errorMessage: 'File not found',
        createdAt: '2023-06-15T10:30:00Z',
        errorType: 'FILE_ERROR',
        operationType: 'COPY',
        origin: 'SOURCE',
        projectId: 'project-1',
        projectName: 'Test Project 1',
      },
      {
        id: '2',
        operationId: 'op-2',
        errorCode: 'ERR002',
        errorMessage: 'Permission denied',
        createdAt: '2023-07-20T14:45:00Z',
        errorType: 'PERMISSION_ERROR',
        operationType: 'MOVE',
        origin: 'TARGET',
        projectId: 'project-2',
        projectName: 'Test Project 2',
      },
    ];

    it('should successfully fetch operation errors for given project IDs and date range', async () => {
      mockQuery.mockResolvedValue(mockOperationErrors);

      const result = await service.getOperationErrorsByProjectAndDateRange(
        projectIds,
        startDate,
        endDate,
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        GET_OPERATION_ERRORS_BY_DATE_RANGE,
        [projectIds, startDate, endDate, ['FATAL_ERROR', 'TRANSIENT_ERROR', 'PERM_STAMP_CTIME_ERROR']],
      );

      expect(result).toEqual(mockOperationErrors);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no errors found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await service.getOperationErrorsByProjectAndDateRange(
        projectIds,
        startDate,
        endDate,
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        GET_OPERATION_ERRORS_BY_DATE_RANGE,
        [projectIds, startDate, endDate, ['FATAL_ERROR', 'TRANSIENT_ERROR', 'PERM_STAMP_CTIME_ERROR']],
      );
      expect(result).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      mockQuery.mockRejectedValue(dbError);

      await expect(
        service.getOperationErrorsByProjectAndDateRange(
          projectIds,
          startDate,
          endDate,
        ),
      ).rejects.toThrow('Database connection failed');

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should call the correct SQL query with projectIds, startDate and endDate', async () => {
      mockQuery.mockResolvedValue([]);

      await service.getOperationErrorsByProjectAndDateRange(
        projectIds,
        startDate,
        endDate,
      );

      expect(mockQuery).toHaveBeenCalledWith(
        GET_OPERATION_ERRORS_BY_DATE_RANGE,
        [projectIds, startDate, endDate, ['FATAL_ERROR', 'TRANSIENT_ERROR', 'PERM_STAMP_CTIME_ERROR']],
      );
    });

    it('should propagate errors thrown by the repository', async () => {
      const error = new Error('Unexpected DB error');
      mockQuery.mockRejectedValue(error);

      await expect(
        service.getOperationErrorsByProjectAndDateRange(
          projectIds,
          startDate,
          endDate,
        ),
      ).rejects.toThrow('Unexpected DB error');

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should handle single project ID', async () => {
      const singleProjectId = ['project-1'];
      const singleProjectErrors = [mockOperationErrors[0]];

      mockQuery.mockResolvedValue(singleProjectErrors);

      const result = await service.getOperationErrorsByProjectAndDateRange(
        singleProjectId,
        startDate,
        endDate,
      );

      expect(mockQuery).toHaveBeenCalledWith(
        GET_OPERATION_ERRORS_BY_DATE_RANGE,
        [singleProjectId, startDate, endDate, ['FATAL_ERROR', 'TRANSIENT_ERROR', 'PERM_STAMP_CTIME_ERROR']],
      );
      expect(result).toEqual(singleProjectErrors);
      expect(result).toHaveLength(1);
    });

    it('should handle empty project IDs array', async () => {
      const emptyProjectIds: string[] = [];
      mockQuery.mockResolvedValue([]);

      const result = await service.getOperationErrorsByProjectAndDateRange(
        emptyProjectIds,
        startDate,
        endDate,
      );

      expect(mockQuery).toHaveBeenCalledWith(
        GET_OPERATION_ERRORS_BY_DATE_RANGE,
        [emptyProjectIds, startDate, endDate, ['FATAL_ERROR', 'TRANSIENT_ERROR', 'PERM_STAMP_CTIME_ERROR']],
      );
      expect(result).toEqual([]);
    });

    it('should handle same start and end date', async () => {
      const sameDate = '2023-06-15';
      mockQuery.mockResolvedValue([mockOperationErrors[0]]);

      const result = await service.getOperationErrorsByProjectAndDateRange(
        projectIds,
        sameDate,
        sameDate,
      );

      expect(mockQuery).toHaveBeenCalledWith(
        GET_OPERATION_ERRORS_BY_DATE_RANGE,
        [projectIds, sameDate, sameDate, ['FATAL_ERROR', 'TRANSIENT_ERROR', 'PERM_STAMP_CTIME_ERROR']],
      );
      expect(result).toHaveLength(1);
    });

    it('should handle multiple project IDs with mixed results', async () => {
      const multipleProjectIds = ['project-1', 'project-2', 'project-3'];
      mockQuery.mockResolvedValue(mockOperationErrors);

      const result = await service.getOperationErrorsByProjectAndDateRange(
        multipleProjectIds,
        startDate,
        endDate,
      );

      expect(mockQuery).toHaveBeenCalledWith(
        GET_OPERATION_ERRORS_BY_DATE_RANGE,
        [multipleProjectIds, startDate, endDate, ['FATAL_ERROR', 'TRANSIENT_ERROR', 'PERM_STAMP_CTIME_ERROR']],
      );
      expect(result).toEqual(mockOperationErrors);
    });

    it('should handle large date ranges', async () => {
      const earlyStartDate = '2020-01-01';
      const futureEndDate = '2030-12-31';
      mockQuery.mockResolvedValue([]);

      const result = await service.getOperationErrorsByProjectAndDateRange(
        projectIds,
        earlyStartDate,
        futureEndDate,
      );

      expect(mockQuery).toHaveBeenCalledWith(
        GET_OPERATION_ERRORS_BY_DATE_RANGE,
        [projectIds, earlyStartDate, futureEndDate, ['FATAL_ERROR', 'TRANSIENT_ERROR', 'PERM_STAMP_CTIME_ERROR']],
      );
      expect(result).toEqual([]);
    });

    it('should handle database timeout errors', async () => {
      const timeoutError = new Error('Query timeout');
      timeoutError.name = 'QueryTimeoutError';
      mockQuery.mockRejectedValue(timeoutError);

      await expect(
        service.getOperationErrorsByProjectAndDateRange(
          projectIds,
          startDate,
          endDate,
        ),
      ).rejects.toThrow('Query timeout');
    });

    it('should handle malformed SQL response', async () => {
      // Mock a malformed response that might come from database
      mockQuery.mockResolvedValue(null);

      const result = await service.getOperationErrorsByProjectAndDateRange(
        projectIds,
        startDate,
        endDate,
      );

      expect(result).toBeNull();
    });

    it('should validate that correct parameters are passed to query', async () => {
      mockQuery.mockResolvedValue([]);

      await service.getOperationErrorsByProjectAndDateRange(
        ['test-project'],
        '2023-05-01',
        '2023-05-31',
      );

      // Verify exact parameter matching
      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toBe(GET_OPERATION_ERRORS_BY_DATE_RANGE);
      expect(callArgs[1]).toEqual([
        ['test-project'],
        '2023-05-01',
        '2023-05-31',
        ['FATAL_ERROR', 'TRANSIENT_ERROR', 'PERM_STAMP_CTIME_ERROR'],
      ]);
    });
  });

  describe('integration scenarios', () => {
    it('should work with real-world data structure', async () => {
      const realWorldData: OperationErrorExportData[] = [
        {
          id: 'uuid-1',
          operationId: 'op-uuid-1',
          errorCode: 'FILE_NOT_FOUND',
          errorMessage:
            'The specified file could not be found in the source location',
          createdAt: '2023-08-15T09:30:45.123Z',
          errorType: 'FileSystemError',
          operationType: 'COPY',
          origin: 'SOURCE',
          projectId: 'proj-12345',
          projectName: 'Customer Data Migration Project',
        },
      ];

      mockQuery.mockResolvedValue(realWorldData);

      const result = await service.getOperationErrorsByProjectAndDateRange(
        ['proj-12345'],
        '2023-08-01',
        '2023-08-31',
      );

      expect(result).toEqual(realWorldData);
      expect(result[0].projectName).toBe('Customer Data Migration Project');
      expect(result[0].errorType).toBe('FileSystemError');
    });

    it('should handle concurrent queries correctly', async () => {
      const testErrors1: OperationErrorExportData[] = [
        {
          id: '1',
          operationId: 'op-1',
          errorCode: 'ERR001',
          errorMessage: 'File not found',
          createdAt: '2023-06-15T10:30:00Z',
          errorType: 'FILE_ERROR',
          operationType: 'COPY',
          origin: 'SOURCE',
          projectId: 'project-1',
          projectName: 'Test Project 1',
        },
      ];

      const testErrors2: OperationErrorExportData[] = [
        {
          id: '2',
          operationId: 'op-2',
          errorCode: 'ERR002',
          errorMessage: 'Permission denied',
          createdAt: '2023-07-20T14:45:00Z',
          errorType: 'PERMISSION_ERROR',
          operationType: 'MOVE',
          origin: 'TARGET',
          projectId: 'project-2',
          projectName: 'Test Project 2',
        },
      ];

      // Set up mock to return different results for different calls
      mockQuery
        .mockResolvedValueOnce(testErrors1)
        .mockResolvedValueOnce(testErrors2);

      const query1Promise = service.getOperationErrorsByProjectAndDateRange(
        ['project-1'],
        '2023-01-01',
        '2023-06-30',
      );

      const query2Promise = service.getOperationErrorsByProjectAndDateRange(
        ['project-2'],
        '2023-07-01',
        '2023-12-31',
      );

      const [result1, result2] = await Promise.all([
        query1Promise,
        query2Promise,
      ]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1).toHaveLength(1);
      expect(result2).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });
});
