import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationErrorService } from './error-csv-generation.service';
import { OperationErrorEntity } from '../entities/operation-error.entity';
import { OperationErrorExportData } from '../constants/types';

describe('OperationErrorService', () => {
    let service: OperationErrorService;
    let repository: jest.Mocked<Repository<OperationErrorEntity>>;

    const mockRepository = {
        query: jest.fn(),
        find: jest.fn(),
        findOne: jest.fn(),
        save: jest.fn(),
        delete: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                OperationErrorService,
                {
                    provide: getRepositoryToken(OperationErrorEntity),
                    useValue: mockRepository,
                },
            ],
        }).compile();

        service = module.get<OperationErrorService>(OperationErrorService);
        repository = module.get(getRepositoryToken(OperationErrorEntity));
    });

    afterEach(() => {
        jest.clearAllMocks();
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
                fileName: 'test-file.txt',
                filePath: '/path/to/test-file.txt',
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
                fileName: 'another-file.pdf',
                filePath: '/path/to/another-file.pdf',
                errorType: 'PERMISSION_ERROR',
                operationType: 'MOVE',
                origin: 'TARGET',
                projectId: 'project-2',
                projectName: 'Test Project 2',
            },
        ];

        it('should successfully fetch operation errors for given projects and date range', async () => {
            repository.query.mockResolvedValue(mockOperationErrors);

            const result = await service.getOperationErrorsByProjectAndDateRange(
                projectIds,
                startDate,
                endDate,
            );

            expect(repository.query).toHaveBeenCalledTimes(1);
            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [projectIds, startDate, endDate],
            );

            expect(result).toEqual(mockOperationErrors);
            expect(result).toHaveLength(2);
            expect(result[0].projectId).toBe('project-1');
            expect(result[1].projectId).toBe('project-2');
        });

        it('should return empty array when no errors found', async () => {
            repository.query.mockResolvedValue([]);

            const result = await service.getOperationErrorsByProjectAndDateRange(
                projectIds,
                startDate,
                endDate,
            );

            expect(repository.query).toHaveBeenCalledTimes(1);
            expect(result).toEqual([]);
        });

        it('should handle single project ID', async () => {
            const singleProjectId = ['project-1'];
            repository.query.mockResolvedValue([mockOperationErrors[0]]);

            const result = await service.getOperationErrorsByProjectAndDateRange(
                singleProjectId,
                startDate,
                endDate,
            );

            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [singleProjectId, startDate, endDate],
            );
            expect(result).toHaveLength(1);
            expect(result[0].projectId).toBe('project-1');
        });

        it('should handle empty project IDs array', async () => {
            repository.query.mockResolvedValue([]);

            const result = await service.getOperationErrorsByProjectAndDateRange(
                [],
                startDate,
                endDate,
            );

            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [[], startDate, endDate],
            );
            expect(result).toEqual([]);
        });

        it('should use correct SQL query structure', async () => {
            repository.query.mockResolvedValue(mockOperationErrors);

            await service.getOperationErrorsByProjectAndDateRange(
                projectIds,
                startDate,
                endDate,
            );

            const [query] = repository.query.mock.calls[0];

            // Verify the query contains expected JOINs and WHERE clause
            expect(query).toContain('FROM datamigrator.operation_errors oe');
            expect(query).toContain('INNER JOIN datamigrator.operations o ON oe.operation_id = o.id');
            expect(query).toContain('INNER JOIN datamigrator.jobrun jr ON o.job_run_id = jr.id');
            expect(query).toContain('INNER JOIN datamigrator.jobconfig jc ON jr.job_config_id = jc.id');
            expect(query).toContain('WHERE p.id = ANY($1)');
            expect(query).toContain('AND DATE(oe.created_at) >= $2');
            expect(query).toContain('AND DATE(oe.created_at) <= $3');
            expect(query).toContain('ORDER BY p.id, DATE(oe.created_at), oe.created_at');
        });

        it('should handle database errors', async () => {
            const dbError = new Error('Database connection failed');
            repository.query.mockRejectedValue(dbError);

            await expect(
                service.getOperationErrorsByProjectAndDateRange(
                    projectIds,
                    startDate,
                    endDate,
                ),
            ).rejects.toThrow('Database connection failed');

            expect(repository.query).toHaveBeenCalledTimes(1);
        });

        it('should handle different date formats', async () => {
            const differentStartDate = '2023-12-01';
            const differentEndDate = '2023-12-31';
            repository.query.mockResolvedValue([]);

            await service.getOperationErrorsByProjectAndDateRange(
                projectIds,
                differentStartDate,
                differentEndDate,
            );

            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [projectIds, differentStartDate, differentEndDate],
            );
        });
    });

    describe('findByOperationIds', () => {
        const operationIds = ['op-1', 'op-2', 'op-3'];

        const mockOperationErrorEntities: OperationErrorEntity[] = [
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
            } as OperationErrorEntity,
            {
                id: '2',
                operationId: 'op-2',
                errorCode: 'ERR002',
                errorMessage: 'Permission denied',
                createdAt: new Date('2023-07-20T14:45:00Z'),
                fileName: 'another-file.pdf',
                filePath: '/path/to/another-file.pdf',
                errorType: 'PERMISSION_ERROR',
                operationType: 'MOVE',
                origin: 'TARGET',
                updatedAt: new Date('2023-07-20T14:45:00Z'),
            } as OperationErrorEntity,
        ];

        it('should successfully fetch operation errors by operation IDs', async () => {
            repository.query.mockResolvedValue(mockOperationErrorEntities);

            const result = await service.findByOperationIds(operationIds);

            expect(repository.query).toHaveBeenCalledTimes(1);
            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM datamigrator.operation_errors'),
                [operationIds],
            );

            expect(result).toEqual(mockOperationErrorEntities);
            expect(result).toHaveLength(2);
        });

        it('should return empty array when no errors found for operation IDs', async () => {
            repository.query.mockResolvedValue([]);

            const result = await service.findByOperationIds(operationIds);

            expect(repository.query).toHaveBeenCalledTimes(1);
            expect(result).toEqual([]);
        });

        it('should handle single operation ID', async () => {
            const singleOperationId = ['op-1'];
            repository.query.mockResolvedValue([mockOperationErrorEntities[0]]);

            const result = await service.findByOperationIds(singleOperationId);

            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM datamigrator.operation_errors'),
                [singleOperationId],
            );
            expect(result).toHaveLength(1);
            expect(result[0].operationId).toBe('op-1');
        });

        it('should handle empty operation IDs array', async () => {
            repository.query.mockResolvedValue([]);

            const result = await service.findByOperationIds([]);

            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM datamigrator.operation_errors'),
                [[]],
            );
            expect(result).toEqual([]);
        });

        it('should use correct SQL query with ORDER BY', async () => {
            repository.query.mockResolvedValue(mockOperationErrorEntities);

            await service.findByOperationIds(operationIds);

            const [query] = repository.query.mock.calls[0];

            expect(query).toContain('SELECT * FROM datamigrator.operation_errors');
            expect(query).toContain('WHERE operation_id = ANY($1)');
            expect(query).toContain('ORDER BY created_at DESC');
        });

        it('should handle database errors', async () => {
            const dbError = new Error('Query execution failed');
            repository.query.mockRejectedValue(dbError);

            await expect(
                service.findByOperationIds(operationIds),
            ).rejects.toThrow('Query execution failed');

            expect(repository.query).toHaveBeenCalledTimes(1);
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
            {
                projectId: 'project-2',
                projectName: 'Test Project 2',
                errorCount: 8,
            },
        ];

        it('should successfully get error count by project and date range', async () => {
            repository.query.mockResolvedValue(mockErrorCounts);

            const result = await service.getErrorCountByProject(
                projectIds,
                startDate,
                endDate,
            );

            expect(repository.query).toHaveBeenCalledTimes(1);
            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [projectIds, startDate, endDate],
            );

            expect(result).toEqual(mockErrorCounts);
            expect(result).toHaveLength(2);
            expect(result[0].errorCount).toBe(15);
            expect(result[1].errorCount).toBe(8);
        });

        it('should return empty array when no projects have errors', async () => {
            repository.query.mockResolvedValue([]);

            const result = await service.getErrorCountByProject(
                projectIds,
                startDate,
                endDate,
            );

            expect(repository.query).toHaveBeenCalledTimes(1);
            expect(result).toEqual([]);
        });

        it('should handle single project ID', async () => {
            const singleProjectId = ['project-1'];
            repository.query.mockResolvedValue([mockErrorCounts[0]]);

            const result = await service.getErrorCountByProject(
                singleProjectId,
                startDate,
                endDate,
            );

            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [singleProjectId, startDate, endDate],
            );
            expect(result).toHaveLength(1);
            expect(result[0].projectId).toBe('project-1');
            expect(result[0].errorCount).toBe(15);
        });

        it('should handle projects with zero errors', async () => {
            const zeroErrorResult = [
                {
                    projectId: 'project-3',
                    projectName: 'Test Project 3',
                    errorCount: 0,
                },
            ];
            repository.query.mockResolvedValue(zeroErrorResult);

            const result = await service.getErrorCountByProject(
                ['project-3'],
                startDate,
                endDate,
            );

            expect(result).toHaveLength(1);
            expect(result[0].errorCount).toBe(0);
        });

        it('should use correct SQL query structure with COUNT and GROUP BY', async () => {
            repository.query.mockResolvedValue(mockErrorCounts);

            await service.getErrorCountByProject(
                projectIds,
                startDate,
                endDate,
            );

            const [query] = repository.query.mock.calls[0];

            // Verify the query contains expected aggregation and grouping
            expect(query).toContain('COUNT(oe.id) as "errorCount"');
            expect(query).toContain('FROM datamigrator.operation_errors oe');
            expect(query).toContain('INNER JOIN datamigrator.operations o ON oe.operation_id = o.id');
            expect(query).toContain('INNER JOIN datamigrator.project p ON c.project_id = p.id');
            expect(query).toContain('WHERE p.id = ANY($1)');
            expect(query).toContain('GROUP BY p.id, p.project_name');
            expect(query).toContain('ORDER BY p.project_name');
        });

        it('should handle different date ranges', async () => {
            const customStartDate = '2023-06-01';
            const customEndDate = '2023-06-30';
            repository.query.mockResolvedValue(mockErrorCounts);

            await service.getErrorCountByProject(
                projectIds,
                customStartDate,
                customEndDate,
            );

            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [projectIds, customStartDate, customEndDate],
            );
        });

        it('should handle database errors', async () => {
            const dbError = new Error('Aggregation query failed');
            repository.query.mockRejectedValue(dbError);

            await expect(
                service.getErrorCountByProject(
                    projectIds,
                    startDate,
                    endDate,
                ),
            ).rejects.toThrow('Aggregation query failed');

            expect(repository.query).toHaveBeenCalledTimes(1);
        });

        it('should handle large error counts', async () => {
            const largeCountResult = [
                {
                    projectId: 'project-big',
                    projectName: 'Large Project',
                    errorCount: 999999,
                },
            ];
            repository.query.mockResolvedValue(largeCountResult);

            const result = await service.getErrorCountByProject(
                ['project-big'],
                startDate,
                endDate,
            );

            expect(result[0].errorCount).toBe(999999);
        });
    });

    describe('service instantiation', () => {
        it('should be defined', () => {
            expect(service).toBeDefined();
        });

        it('should inject repository correctly', () => {
            expect(repository).toBeDefined();
        });
    });

    describe('error handling across all methods', () => {
        it('should handle network timeouts', async () => {
            const timeoutError = new Error('Query timeout');
            timeoutError.name = 'QueryTimeoutError';
            repository.query.mockRejectedValue(timeoutError);

            await expect(
                service.getOperationErrorsByProjectAndDateRange(
                    ['project-1'],
                    '2023-01-01',
                    '2023-12-31',
                ),
            ).rejects.toThrow('Query timeout');

            await expect(
                service.findByOperationIds(['op-1']),
            ).rejects.toThrow('Query timeout');

            await expect(
                service.getErrorCountByProject(
                    ['project-1'],
                    '2023-01-01',
                    '2023-12-31',
                ),
            ).rejects.toThrow('Query timeout');
        });

        it('should handle SQL syntax errors', async () => {
            const sqlError = new Error('Syntax error in SQL query');
            sqlError.name = 'QueryFailedError';
            repository.query.mockRejectedValue(sqlError);

            await expect(
                service.findByOperationIds(['invalid-id']),
            ).rejects.toThrow('Syntax error in SQL query');
        });
    });

    describe('parameter validation scenarios', () => {
        it('should handle null and undefined parameters gracefully', async () => {
            repository.query.mockResolvedValue([]);

            // These should not throw errors, but pass the values to the repository
            await service.getOperationErrorsByProjectAndDateRange(
                null as any,
                undefined as any,
                null as any,
            );

            expect(repository.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT'),
                [null, undefined, null],
            );
        });

        it('should handle very long arrays of IDs', async () => {
            const manyProjectIds = Array.from({ length: 1000 }, (_, i) => `project-${i}`);
            const manyOperationIds = Array.from({ length: 500 }, (_, i) => `op-${i}`);

            repository.query.mockResolvedValue([]);

            await service.getOperationErrorsByProjectAndDateRange(
                manyProjectIds,
                '2023-01-01',
                '2023-12-31',
            );

            await service.findByOperationIds(manyOperationIds);

            expect(repository.query).toHaveBeenCalledTimes(2);
        });
    });
});
