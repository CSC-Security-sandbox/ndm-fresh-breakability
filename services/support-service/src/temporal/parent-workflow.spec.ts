// Mock Temporal workflow functions before any imports
const mockStartChild = jest.fn();
const mockLog = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
};
const mockProxyActivities = jest.fn();
const mockNotifyWorkflowCompletion = jest.fn();

jest.mock('@temporalio/workflow', () => ({
    startChild: mockStartChild,
    log: mockLog,
    proxyActivities: mockProxyActivities,
}));

// Mock child workflows
jest.mock('./child-workflows/log-generator-workflow', () => ({
    LogGeneratorWorkflow: 'LogGeneratorWorkflow',
}));

jest.mock('./child-workflows/error-csv-generator-workflow', () => ({
    ErrorCsvGeneratorWorkflow: 'ErrorCsvGeneratorWorkflow',
}));

// Mock constants
jest.mock('../constants/enum', () => ({
    SupportBundleStatus: {
        COMPLETED: 'COMPLETED',
        FAILED: 'FAILED',
        IN_PROGRESS: 'IN_PROGRESS',
    },
}));

// Also mock the absolute path used in parent-workflow.ts
jest.mock('../constants/enum', () => ({
    SupportBundleStatus: {
        COMPLETED: 'COMPLETED',
        FAILED: 'FAILED',
        IN_PROGRESS: 'IN_PROGRESS',
    },
}));

jest.mock('../activities/activities.service', () => ({
    ActivitiesService: jest.fn(),
}));

// Also mock the absolute path used in parent-workflow.ts
jest.mock('../activities/activities.service', () => ({
    ActivitiesService: jest.fn(),
}));

import { SupportBundleWorkflow } from './parent-workflow';
import { SupportBundleStatus } from '../constants/enum';

describe('SupportBundleWorkflow', () => {
    let mockLogGeneratorChild: any;
    let mockErrorCsvChild: any;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup proxy activities mock
        mockProxyActivities.mockReturnValue({
            notifyWorkflowCompletion: mockNotifyWorkflowCompletion,
        });

        // Setup child workflow mocks
        mockLogGeneratorChild = {
            result: jest.fn(),
        };

        mockErrorCsvChild = {
            result: jest.fn(),
        };

        // Setup default mock implementations
        mockNotifyWorkflowCompletion.mockResolvedValue(undefined);
    });

    describe('Successful workflow execution', () => {
        it('should complete successfully when all child workflows succeed', async () => {
            const traceId = 'test-trace-id-123';
            const payload = {
                projectIds: ['project1', 'project2'],
                startDate: '2024-01-01',
                endDate: '2024-01-31',
            };
            const options = {};

            const logGeneratorResult = '/path/to/logs.zip';
            const errorCsvResult = '/path/to/errors.csv';

            // Mock child workflow creation and results
            mockStartChild
                .mockResolvedValueOnce(mockLogGeneratorChild)
                .mockResolvedValueOnce(mockErrorCsvChild);

            mockLogGeneratorChild.result.mockResolvedValue(logGeneratorResult);
            mockErrorCsvChild.result.mockResolvedValue(errorCsvResult);

            const result = await SupportBundleWorkflow({ traceId, payload, options });

            // Verify logging
            expect(mockLog.info).toHaveBeenCalledWith(`Started SupportBundleWorkflow for traceId: ${traceId}`);

            // Verify log generator child workflow
            expect(mockStartChild).toHaveBeenCalledWith('LogGeneratorWorkflow', {
                args: [{ traceId, payload }],
                workflowId: `LogGeneratorWorkflow-${traceId}`,
                retry: {
                    maximumAttempts: 3,
                    initialInterval: '2s',
                },
                workflowExecutionTimeout: '30s',
            });

            // Verify error CSV child workflow
            expect(mockStartChild).toHaveBeenCalledWith('ErrorCsvGeneratorWorkflow', {
                args: [{ traceId, payload: { ...payload, zipLocation: logGeneratorResult } }],
                workflowId: `ErrorCsvWorkflow-${traceId}`,
                retry: {
                    maximumAttempts: 3,
                    initialInterval: '2s',
                },
                workflowExecutionTimeout: '3m',
            });

            // Verify completion notification
            expect(mockNotifyWorkflowCompletion).toHaveBeenCalledWith({
                traceId,
                status: SupportBundleStatus.COMPLETED,
                errorMessage: null,
            });

            // Verify result
            expect(result).toEqual({
                status: 'success',
                message: 'All child workflows completed successfully.',
                traceId,
                workflowResults: [logGeneratorResult, errorCsvResult],
            });
        });

        it('should handle payload updates between child workflows', async () => {
            const traceId = 'test-trace-id-456';
            const initialPayload = {
                projectIds: ['project1'],
                startDate: '2024-01-01',
                endDate: '2024-01-31',
            };
            const options = {};

            const logGeneratorResult = '/custom/path/to/logs.zip';

            mockStartChild
                .mockResolvedValueOnce(mockLogGeneratorChild)
                .mockResolvedValueOnce(mockErrorCsvChild);

            mockLogGeneratorChild.result.mockResolvedValue(logGeneratorResult);
            mockErrorCsvChild.result.mockResolvedValue('/path/to/errors.csv');

            await SupportBundleWorkflow({ traceId, payload: initialPayload, options });

            // Verify that the second child workflow receives the updated payload
            expect(mockStartChild).toHaveBeenNthCalledWith(2, 'ErrorCsvGeneratorWorkflow', {
                args: [{
                    traceId,
                    payload: {
                        ...initialPayload,
                        zipLocation: logGeneratorResult
                    }
                }],
                workflowId: `ErrorCsvWorkflow-${traceId}`,
                retry: {
                    maximumAttempts: 3,
                    initialInterval: '2s',
                },
                workflowExecutionTimeout: '3m',
            });
        });
    });

    describe('Error handling', () => {
        it('should handle log generator workflow failure', async () => {
            const traceId = 'test-trace-id-error';
            const payload = { projectIds: ['project1'] };
            const options = {};
            const errorMessage = 'Log generator workflow failed';

            mockStartChild.mockResolvedValueOnce(mockLogGeneratorChild);
            mockLogGeneratorChild.result.mockRejectedValue(new Error(errorMessage));

            const result = await SupportBundleWorkflow({ traceId, payload, options });

            // Verify failure notification
            expect(mockNotifyWorkflowCompletion).toHaveBeenCalledWith({
                traceId,
                status: SupportBundleStatus.FAILED,
                errorMessage,
            });

            // Verify error result
            expect(result).toEqual({
                status: 'failed',
                message: 'Workflow failed during execution.',
                traceId,
                error: errorMessage,
            });

            // Verify second child workflow was not started
            expect(mockStartChild).toHaveBeenCalledTimes(1);
        });

        it('should handle error CSV workflow failure', async () => {
            const traceId = 'test-trace-id-csv-error';
            const payload = { projectIds: ['project1'] };
            const options = {};
            const errorMessage = 'CSV generation failed';

            mockStartChild
                .mockResolvedValueOnce(mockLogGeneratorChild)
                .mockResolvedValueOnce(mockErrorCsvChild);

            mockLogGeneratorChild.result.mockResolvedValue('/path/to/logs.zip');
            mockErrorCsvChild.result.mockRejectedValue(new Error(errorMessage));

            const result = await SupportBundleWorkflow({ traceId, payload, options });

            // Verify failure notification
            expect(mockNotifyWorkflowCompletion).toHaveBeenCalledWith({
                traceId,
                status: SupportBundleStatus.FAILED,
                errorMessage,
            });

            // Verify error result
            expect(result).toEqual({
                status: 'failed',
                message: 'Workflow failed during execution.',
                traceId,
                error: errorMessage,
            });
        });

        it('should handle child workflow creation failure', async () => {
            const traceId = 'test-trace-id-creation-error';
            const payload = { projectIds: ['project1'] };
            const options = {};
            const errorMessage = 'Failed to start child workflow';

            mockStartChild.mockRejectedValue(new Error(errorMessage));

            const result = await SupportBundleWorkflow({ traceId, payload, options });

            // Verify failure notification
            expect(mockNotifyWorkflowCompletion).toHaveBeenCalledWith({
                traceId,
                status: SupportBundleStatus.FAILED,
                errorMessage,
            });

            // Verify error result
            expect(result).toEqual({
                status: 'failed',
                message: 'Workflow failed during execution.',
                traceId,
                error: errorMessage,
            });
        });

        it('should handle notification failure gracefully', async () => {
            const traceId = 'test-trace-id-notification-error';
            const payload = { projectIds: ['project1'] };
            const options = {};
            const notificationError = 'Notification failed';

            mockStartChild
                .mockResolvedValueOnce(mockLogGeneratorChild)
                .mockResolvedValueOnce(mockErrorCsvChild);

            mockLogGeneratorChild.result.mockResolvedValue('/path/to/logs.zip');
            mockErrorCsvChild.result.mockResolvedValue('/path/to/errors.csv');
            mockNotifyWorkflowCompletion.mockRejectedValue(new Error(notificationError));

            const result = await SupportBundleWorkflow({ traceId, payload, options });

            // Should still try to notify about failure
            expect(mockNotifyWorkflowCompletion).toHaveBeenCalledTimes(2);
            expect(mockNotifyWorkflowCompletion).toHaveBeenNthCalledWith(1, {
                traceId,
                status: SupportBundleStatus.COMPLETED,
                errorMessage: null,
            });
            expect(mockNotifyWorkflowCompletion).toHaveBeenNthCalledWith(2, {
                traceId,
                status: SupportBundleStatus.FAILED,
                errorMessage: notificationError,
            });

            // Verify error result
            expect(result).toEqual({
                status: 'failed',
                message: 'Workflow failed during execution.',
                traceId,
                error: notificationError,
            });
        });
    });

    describe('Workflow configuration', () => {
        it('should configure log generator workflow with correct parameters', async () => {
            const traceId = 'config-test-trace';
            const payload = { projectIds: ['project1'] };
            const options = {};

            mockStartChild.mockResolvedValueOnce(mockLogGeneratorChild);
            mockLogGeneratorChild.result.mockResolvedValue('/path/to/logs.zip');

            try {
                await SupportBundleWorkflow({ traceId, payload, options });
            } catch (e) {
                // Expected to fail at CSV workflow, but we've tested the log generator config
            }

            expect(mockStartChild).toHaveBeenCalledWith('LogGeneratorWorkflow', {
                args: [{ traceId, payload }],
                workflowId: `LogGeneratorWorkflow-${traceId}`,
                retry: {
                    maximumAttempts: 3,
                    initialInterval: '2s',
                },
                workflowExecutionTimeout: '30s',
            });
        });

        it('should configure error CSV workflow with correct parameters', async () => {
            const traceId = 'config-test-csv';
            const payload = { projectIds: ['project1'] };
            const options = {};
            const logResult = '/path/to/logs.zip';

            mockStartChild
                .mockResolvedValueOnce(mockLogGeneratorChild)
                .mockResolvedValueOnce(mockErrorCsvChild);

            mockLogGeneratorChild.result.mockResolvedValue(logResult);
            mockErrorCsvChild.result.mockResolvedValue('/path/to/errors.csv');

            await SupportBundleWorkflow({ traceId, payload, options });

            expect(mockStartChild).toHaveBeenNthCalledWith(2, 'ErrorCsvGeneratorWorkflow', {
                args: [{ traceId, payload: { ...payload, zipLocation: logResult } }],
                workflowId: `ErrorCsvWorkflow-${traceId}`,
                retry: {
                    maximumAttempts: 3,
                    initialInterval: '2s',
                },
                workflowExecutionTimeout: '3m',
            });
        });

        it('should generate unique workflow IDs based on traceId', async () => {
            const traceId = 'unique-trace-123';
            const payload = { projectIds: ['project1'] };
            const options = {};

            mockStartChild
                .mockResolvedValueOnce(mockLogGeneratorChild)
                .mockResolvedValueOnce(mockErrorCsvChild);

            mockLogGeneratorChild.result.mockResolvedValue('/path/to/logs.zip');
            mockErrorCsvChild.result.mockResolvedValue('/path/to/errors.csv');

            await SupportBundleWorkflow({ traceId, payload, options });

            expect(mockStartChild).toHaveBeenNthCalledWith(1, 'LogGeneratorWorkflow',
                expect.objectContaining({
                    workflowId: `LogGeneratorWorkflow-${traceId}`,
                })
            );

            expect(mockStartChild).toHaveBeenNthCalledWith(2, 'ErrorCsvGeneratorWorkflow',
                expect.objectContaining({
                    workflowId: `ErrorCsvWorkflow-${traceId}`,
                })
            );
        });
    });

    describe('Proxy activities configuration', () => {
        it('should configure proxy activities with correct timeout', () => {
            // This is tested by the module import, but we can verify the mock was called
            expect(mockProxyActivities).toHaveBeenCalledWith({
                startToCloseTimeout: '1 minute',
            });
        });
    });

    describe('Integration scenarios', () => {
        it('should handle complex payload with multiple project IDs', async () => {
            const traceId = 'complex-payload-test';
            const payload = {
                projectIds: ['proj1', 'proj2', 'proj3'],
                startDate: '2024-01-01',
                endDate: '2024-12-31',
                additionalOptions: {
                    includeDebugLogs: true,
                    compressionLevel: 9,
                },
            };
            const options = {};

            mockStartChild
                .mockResolvedValueOnce(mockLogGeneratorChild)
                .mockResolvedValueOnce(mockErrorCsvChild);

            mockLogGeneratorChild.result.mockResolvedValue('/complex/path/logs.zip');
            mockErrorCsvChild.result.mockResolvedValue('/complex/path/errors.csv');

            const result = await SupportBundleWorkflow({ traceId, payload, options });

            expect(result.status).toBe('success');
            expect(result.traceId).toBe(traceId);
            expect(result.workflowResults).toHaveLength(2);

            // Verify both child workflows received the correct payload
            expect(mockStartChild).toHaveBeenCalledWith('LogGeneratorWorkflow',
                expect.objectContaining({
                    args: [{ traceId, payload }],
                })
            );

            expect(mockStartChild).toHaveBeenCalledWith('ErrorCsvGeneratorWorkflow',
                expect.objectContaining({
                    args: [{ traceId, payload: { ...payload, zipLocation: '/complex/path/logs.zip' } }],
                })
            );
        });

        it('should maintain workflow results order', async () => {
            const traceId = 'order-test';
            const payload = { projectIds: ['project1'] };
            const options = {};

            const logResult = 'first-result';
            const csvResult = 'second-result';

            mockStartChild
                .mockResolvedValueOnce(mockLogGeneratorChild)
                .mockResolvedValueOnce(mockErrorCsvChild);

            mockLogGeneratorChild.result.mockResolvedValue(logResult);
            mockErrorCsvChild.result.mockResolvedValue(csvResult);

            const result = await SupportBundleWorkflow({ traceId, payload, options });

            expect(result.workflowResults).toEqual([logResult, csvResult]);
        });
    });
});
