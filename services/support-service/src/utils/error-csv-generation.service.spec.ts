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

    describe('getOperationErrorsByDateRange', () => {
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

        it('should successfully fetch operation errors for given date range', async () => {
            mockQuery.mockResolvedValue(mockOperationErrors);

            const result = await service.getOperationErrorsByDateRange(
                startDate,
                endDate,
            );

            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [startDate, endDate],
            );

            expect(result).toEqual(mockOperationErrors);
            expect(result).toHaveLength(1);
        });

        it('should return empty array when no errors found', async () => {
            mockQuery.mockResolvedValue([]);

            const result = await service.getOperationErrorsByDateRange(
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
                service.getOperationErrorsByDateRange(
                    startDate,
                    endDate,
                ),
            ).rejects.toThrow('Database connection failed');
        });

        it('should call the correct SQL query with startDate and endDate', async () => {
            mockQuery.mockResolvedValue([]);

            const startDate = '2023-01-01';
            const endDate = '2023-12-31';

            await service.getOperationErrorsByDateRange(startDate, endDate);

            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [startDate, endDate]
            );
        });

        it('should propagate errors thrown by the repository', async () => {
            const error = new Error('Unexpected DB error');
            mockQuery.mockRejectedValue(error);

            await expect(service.getOperationErrorsByDateRange('2023-01-01', '2023-12-31')).rejects.toThrow('Unexpected DB error');
        });
    });
});