import { OperationErrorService } from './error-csv-generation.service';

describe('OperationErrorService', () => {
    let service: OperationErrorService;
    let mockQuery: jest.MockedFunction<any>;

    beforeEach(() => {
        // Create mock directly instead of using testing module
        mockQuery = jest.fn();
        const mockRepository = {
            query: mockQuery,
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };

        // Instantiate service directly
        service = new OperationErrorService(mockRepository as any);
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
            expect(mockQuery).toBeDefined();
        });
    });

    describe('getOperationErrorsByProjectAndDateRange', () => {
        const projectIds = ['project-1', 'project-2'];
        const startDate = '2023-01-01';
        const endDate = '2023-12-31';

        const mockOperationErrors = [
            {
                id: '1',
                operationId: 'op-1',
                errorCode: 'ERR001',
                errorMessage: 'File not found',
                createdAt: '2023-06-15T10:30:00Z',
                fileName: 'test-file.txt',
                filePath: '/path/to/test-file.txt',
                errorType: 'FILE_ERROR',
                operationType: 'COPY',
                origin: 'SOURCE',
                projectId: 'project-1',
                projectName: 'Test Project 1',
            },
        ];

        it('should successfully fetch operation errors for given projects and date range', async () => {
            mockQuery.mockResolvedValue(mockOperationErrors);

            const result = await service.getOperationErrorsByProjectAndDateRange(
                projectIds,
                startDate,
                endDate,
            );

            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [projectIds, startDate, endDate],
            );

            expect(result).toEqual(mockOperationErrors);
            expect(result).toHaveLength(1);
        });

        it('should return empty array when no errors found', async () => {
            mockQuery.mockResolvedValue([]);

            const result = await service.getOperationErrorsByProjectAndDateRange(
                projectIds,
                startDate,
                endDate,
            );

            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(result).toEqual([]);
        });

        it('should handle database errors', async () => {
            const dbError = new Error('Database connection failed');
            mockQuery.mockRejectedValue(dbError);

            await expect(
                service.getOperationErrorsByProjectAndDateRange(
                    projectIds,
                    startDate,
                    endDate,
                ),
            ).rejects.toThrow('Database connection failed');
        });
    });

    describe('findByOperationIds', () => {
        const operationIds = ['op-1', 'op-2'];

        const mockOperationErrorEntities = [
            {
                id: '1',
                operationId: 'op-1',
                errorCode: 'ERR001',
                errorMessage: 'File not found',
                createdAt: new Date('2023-06-15T10:30:00Z'),
                fileName: 'test-file.txt',
                filePath: '/path/to/test-file.txt',
                errorType: 'FILE_ERROR',
                operationType: 'COPY',
                origin: 'SOURCE',
                updatedAt: new Date('2023-06-15T10:30:00Z'),
            },
        ];

        it('should successfully fetch operation errors by operation IDs', async () => {
            mockQuery.mockResolvedValue(mockOperationErrorEntities);

            const result = await service.findByOperationIds(operationIds);

            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM datamigrator.operation_errors'),
                [operationIds],
            );

            expect(result).toEqual(mockOperationErrorEntities);
            expect(result).toHaveLength(1);
        });

        it('should return empty array when no errors found for operation IDs', async () => {
            mockQuery.mockResolvedValue([]);

            const result = await service.findByOperationIds(operationIds);

            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(result).toEqual([]);
        });

        it('should handle database errors', async () => {
            const dbError = new Error('Query execution failed');
            mockQuery.mockRejectedValue(dbError);

            await expect(
                service.findByOperationIds(operationIds),
            ).rejects.toThrow('Query execution failed');
        });
    });

    describe('getErrorCountByProject', () => {
        const projectIds = ['project-1', 'project-2'];
        const startDate = '2023-01-01';
        const endDate = '2023-12-31';

        const mockErrorCounts = [
            {
                projectId: 'project-1',
                projectName: 'Test Project 1',
                errorCount: 15,
            },
        ];

        it('should successfully get error count by project and date range', async () => {
            mockQuery.mockResolvedValue(mockErrorCounts);

            const result = await service.getErrorCountByProject(
                projectIds,
                startDate,
                endDate,
            );

            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [projectIds, startDate, endDate],
            );

            expect(result).toEqual(mockErrorCounts);
            expect(result).toHaveLength(1);
        });

        it('should return empty array when no projects have errors', async () => {
            mockQuery.mockResolvedValue([]);

            const result = await service.getErrorCountByProject(
                projectIds,
                startDate,
                endDate,
            );

            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(result).toEqual([]);
        });

        it('should handle database errors', async () => {
            const dbError = new Error('Aggregation query failed');
            mockQuery.mockRejectedValue(dbError);

            await expect(
                service.getErrorCountByProject(
                    projectIds,
                    startDate,
                    endDate,
                ),
            ).rejects.toThrow('Aggregation query failed');
        });
    });
});