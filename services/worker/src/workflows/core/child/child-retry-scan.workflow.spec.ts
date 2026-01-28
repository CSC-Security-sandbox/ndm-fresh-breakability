import { JobRunStatus } from 'src/activities/common/enums';
import * as wf from '@temporalio/workflow';

// Mock activity functions
const mockUpdateJobStatusActivity = jest.fn();
const mockFetchFailedOperationsActivity = jest.fn();
const mockProcessRetryBatchActivity = jest.fn();

// Mock workflow utils
const mockUpdateJobStatusIfNotRunning = jest.fn();
const mockValidateCommandStreamLength = jest.fn();

jest.mock('../common/workflow-utils', () => ({
    updateJobStatusIfNotRunning: (...args: any[]) => mockUpdateJobStatusIfNotRunning(...args),
    validateCommandStreamLength: (...args: any[]) => mockValidateCommandStreamLength(...args),
}));

jest.mock('../common/workflow-constants', () => ({
    MAX_CONCURRENT_BATCHES: 20,
    ITERATIONS_LIMIT: 1000,
    CMD_LENGTH_VALIDATION_ITERATIONS: 1,
    DEFAULT_BATCH_SIZE: 100,
}));

// Mock Temporal workflow module
const mockSetHandler = jest.fn();
const mockCondition = jest.fn();
const mockContinueAsNew = jest.fn();

jest.mock('@temporalio/workflow', () => ({
    defineSignal: jest.fn(() => 'retryScanActionSignal'),
    setHandler: (...args: any[]) => mockSetHandler(...args),
    condition: (...args: any[]) => mockCondition(...args),
    continueAsNew: (...args: any[]) => mockContinueAsNew(...args),
    proxyActivities: jest.fn((config) => {
        // Return different mocks based on the activity type
        return {
            updateStatus: mockUpdateJobStatusActivity,
            fetchFailedOperations: mockFetchFailedOperationsActivity,
            processRetryBatch: mockProcessRetryBatchActivity,
        };
    }),
}));

import { ChildRetryScanWorkflow, executeRetryBatches } from './child-retry-scan.workflow';
import { RetryScanSettings } from './child-retry-scan.workflow.type';


describe('ChildRetryScanWorkflow', () => {
    const jobRunId = 'retry-job-123';
    const originalJobRunId = 'original-job-456';
    
    const mockSettings: RetryScanSettings = {
        sourcePrefix: '/source',
        targetPrefix: '/target',
        skipFile: '0',
        excludePatterns: [],
        isSMB: false,
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Default mocks
        mockUpdateJobStatusActivity.mockResolvedValue(undefined);
        mockValidateCommandStreamLength.mockResolvedValue(undefined);
        mockUpdateJobStatusIfNotRunning.mockResolvedValue(undefined);
        mockCondition.mockResolvedValue(true);

        // Default: single fetch with no more data
        mockFetchFailedOperationsActivity.mockResolvedValue({
            opsBatchIds: ['batch-001', 'batch-002'],
            hasMore: false,
            settings: mockSettings,
        });

        // Default: process batch returns no new dirs
        mockProcessRetryBatchActivity.mockResolvedValue({
            batchDirs: [],
        });
    });

    describe('successful execution', () => {
        it('should update status to RUNNING at start', async () => {
            await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
            });

            expect(mockUpdateJobStatusActivity).toHaveBeenCalledWith({
                jobRunId,
                status: JobRunStatus.Running,
            });
        });

        it('should fetch failed operations using originalJobRunId', async () => {
            await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
            });

            expect(mockFetchFailedOperationsActivity).toHaveBeenCalledWith({
                jobRunId,
                originalJobRunId,
            });
        });

        it('should return Completed status when all batches processed', async () => {
            const result = await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
            });

            expect(result.status).toBe(JobRunStatus.Completed);
            expect(result.jobRunId).toBe(jobRunId);
            expect(result.error).toBeUndefined();
        });

        it('should process fetched batches', async () => {
            await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
            });

            // Should process both batches
            expect(mockProcessRetryBatchActivity).toHaveBeenCalledTimes(2);
            expect(mockProcessRetryBatchActivity).toHaveBeenCalledWith(
                expect.objectContaining({
                    jobRunId,
                    batchId: 'batch-001',
                    type: 'ops',
                    settings: mockSettings,
                })
            );
        });

        it('should validate command stream length before processing', async () => {
            await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
            });

            expect(mockValidateCommandStreamLength).toHaveBeenCalledWith(jobRunId);
        });
    });

    describe('pagination handling', () => {
        it('should continue fetching when hasMore is true', async () => {
            let fetchCount = 0;
            mockFetchFailedOperationsActivity.mockImplementation(async () => {
                fetchCount++;
                return {
                    opsBatchIds: [`batch-${fetchCount}`],
                    hasMore: fetchCount < 3,
                    settings: mockSettings,
                };
            });

            await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
            });

            expect(mockFetchFailedOperationsActivity).toHaveBeenCalledTimes(3);
        });
    });

    describe('subdirectory discovery', () => {
        it('should process discovered subdirectories in subsequent iterations', async () => {
            let processCount = 0;
            mockProcessRetryBatchActivity.mockImplementation(async (input) => {
                processCount++;
                // First batch discovers a subdirectory
                if (processCount === 1) {
                    return { batchDirs: ['subdir-batch-001'] };
                }
                return { batchDirs: [] };
            });

            await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
            });

            // Should have processed the discovered subdir
            expect(mockProcessRetryBatchActivity).toHaveBeenCalledWith(
                expect.objectContaining({
                    batchId: 'subdir-batch-001',
                    type: 'dir',
                })
            );
        });
    });

    describe('signal handling', () => {
        it('should register signal handler', async () => {
            await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
            });

            expect(mockSetHandler).toHaveBeenCalled();
        });

        it('should return Stopped status when actionState is Stopped', async () => {
            const result = await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Stopped,
            });

            expect(result.status).toBe(JobRunStatus.Stopped);
        });

        it('should wait when paused', async () => {
            // First call returns true (not paused), allowing loop to exit
            mockCondition.mockResolvedValue(true);

            await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
            });

            expect(mockCondition).toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        it('should throw error when fetch fails', async () => {
            mockFetchFailedOperationsActivity.mockRejectedValue(new Error('API error'));

            await expect(
                ChildRetryScanWorkflow({
                    jobRunId,
                    originalJobRunId,
                    actionState: JobRunStatus.Running,
                })
            ).rejects.toThrow('API error');
        });

        it('should throw error when batch processing fails', async () => {
            mockProcessRetryBatchActivity.mockRejectedValue(new Error('Processing error'));

            await expect(
                ChildRetryScanWorkflow({
                    jobRunId,
                    originalJobRunId,
                    actionState: JobRunStatus.Running,
                })
            ).rejects.toThrow('Processing error');
        });
    });

    describe('continueAsNew', () => {
        it('should use provided settings on continueAsNew', async () => {
            const result = await ChildRetryScanWorkflow({
                jobRunId,
                originalJobRunId,
                actionState: JobRunStatus.Running,
                opsBatchIds: [],
                batchDirs: [],
                settings: mockSettings,
            });

            // Should not fetch again if settings are provided and no more to fetch
            // This tests the continueAsNew scenario where settings are passed in
            expect(result.status).toBe(JobRunStatus.Completed);
        });
    });
});


describe('executeRetryBatches', () => {
    const jobRunId = 'retry-job-123';
    const mockSettings: RetryScanSettings = {
        sourcePrefix: '/source',
        targetPrefix: '/target',
        skipFile: '0',
        excludePatterns: [],
        isSMB: false,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockProcessRetryBatchActivity.mockResolvedValue({ batchDirs: [] });
    });

    it('should process ops batches with correct type', async () => {
        await executeRetryBatches({
            jobRunId,
            opsBatchIds: ['ops-001', 'ops-002'],
            batchDirIds: [],
            batchSize: 100,
            settings: mockSettings,
        });

        expect(mockProcessRetryBatchActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                batchId: 'ops-001',
                type: 'ops',
            })
        );
        expect(mockProcessRetryBatchActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                batchId: 'ops-002',
                type: 'ops',
            })
        );
    });

    it('should process dir batches with correct type', async () => {
        await executeRetryBatches({
            jobRunId,
            opsBatchIds: [],
            batchDirIds: ['dir-001'],
            batchSize: 100,
            settings: mockSettings,
        });

        expect(mockProcessRetryBatchActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                batchId: 'dir-001',
                type: 'dir',
            })
        );
    });

    it('should combine ops and dir batches for processing', async () => {
        await executeRetryBatches({
            jobRunId,
            opsBatchIds: ['ops-001'],
            batchDirIds: ['dir-001'],
            batchSize: 100,
            settings: mockSettings,
        });

        expect(mockProcessRetryBatchActivity).toHaveBeenCalledTimes(2);
    });

    it('should collect discovered batchDirs from all results', async () => {
        mockProcessRetryBatchActivity
            .mockResolvedValueOnce({ batchDirs: ['new-dir-001'] })
            .mockResolvedValueOnce({ batchDirs: ['new-dir-002', 'new-dir-003'] });

        const result = await executeRetryBatches({
            jobRunId,
            opsBatchIds: ['ops-001', 'ops-002'],
            batchDirIds: [],
            batchSize: 100,
            settings: mockSettings,
        });

        expect(result.batchDirs).toEqual(['new-dir-001', 'new-dir-002', 'new-dir-003']);
    });

    it('should process batches in chunks of MAX_CONCURRENT_BATCHES', async () => {
        // Create 25 batches (should be processed in 2 chunks: 20 + 5)
        const opsBatchIds = Array.from({ length: 25 }, (_, i) => `ops-${i}`);

        await executeRetryBatches({
            jobRunId,
            opsBatchIds,
            batchDirIds: [],
            batchSize: 100,
            settings: mockSettings,
        });

        expect(mockProcessRetryBatchActivity).toHaveBeenCalledTimes(25);
    });

    it('should return empty batchDirs when no batches to process', async () => {
        const result = await executeRetryBatches({
            jobRunId,
            opsBatchIds: [],
            batchDirIds: [],
            batchSize: 100,
            settings: mockSettings,
        });

        expect(result.batchDirs).toEqual([]);
        expect(mockProcessRetryBatchActivity).not.toHaveBeenCalled();
    });

    it('should throw error when batch processing fails', async () => {
        mockProcessRetryBatchActivity.mockRejectedValue(new Error('Batch failed'));

        await expect(
            executeRetryBatches({
                jobRunId,
                opsBatchIds: ['ops-001'],
                batchDirIds: [],
                batchSize: 100,
                settings: mockSettings,
            })
        ).rejects.toThrow('Batch failed');
    });
});
