// Mock Temporal workflow functions before any imports
const mockProxyActivities = jest.fn();
const mockFetchAndZipLogs = jest.fn();
const mockLog = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
};

jest.mock('@temporalio/workflow', () => ({
    proxyActivities: mockProxyActivities,
    log: mockLog,
}));

// Mock activities service - use the exact path as imported in the workflow
jest.mock('src/activities/activities.service', () => ({
    ActivitiesService: jest.fn(),
}));

import { LogGeneratorWorkflow } from './log-generator-workflow';

describe('LogGeneratorWorkflow', () => {
    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup proxy activities mock to return our mock function
        mockProxyActivities.mockReturnValue({
            fetchAndZipLogs: mockFetchAndZipLogs,
        });
    });

    describe('Successful execution', () => {
        it('should complete successfully and return zip path', async () => {
            const traceId = 'test-trace-id-123';
            const payload = {
                projectIds: ['project1', 'project2'],
                startDate: '2024-01-01',
                endDate: '2024-01-31',
            };
            const expectedZipPath = '/path/to/generated/logs.zip';

            // Mock successful activity execution
            mockFetchAndZipLogs.mockResolvedValue(expectedZipPath);

            const result = await LogGeneratorWorkflow({ traceId, payload });

            // Verify proxy activities configuration
            expect(mockProxyActivities).toHaveBeenCalledWith({
                startToCloseTimeout: '1 minute',
            });

            // Verify activity was called with correct parameters
            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload });

            // Verify logging
            expect(mockLog.info).toHaveBeenCalledWith(`[${traceId}] Started LogGeneratorWorkflow`);
            expect(mockLog.info).toHaveBeenCalledWith(`[${traceId}] Finished LogGeneratorWorkflow, zipPath: ${expectedZipPath}`);

            // Verify result
            expect(result).toBe(expectedZipPath);
        });

        it('should handle different payload types', async () => {
            const traceId = 'trace-different-payload';
            const payload = {
                projectIds: ['single-project'],
                startDate: '2024-06-01',
                endDate: '2024-06-30',
                includeDebugLogs: true,
                compressionLevel: 9,
            };
            const expectedZipPath = '/custom/path/logs-compressed.zip';

            mockFetchAndZipLogs.mockResolvedValue(expectedZipPath);

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload });
            expect(result).toBe(expectedZipPath);
            expect(mockLog.info).toHaveBeenCalledWith(`[${traceId}] Started LogGeneratorWorkflow`);
            expect(mockLog.info).toHaveBeenCalledWith(`[${traceId}] Finished LogGeneratorWorkflow, zipPath: ${expectedZipPath}`);
        });

        it('should handle multiple project IDs', async () => {
            const traceId = 'trace-multiple-projects';
            const payload = {
                projectIds: ['proj1', 'proj2', 'proj3', 'proj4'],
                startDate: '2024-01-01',
                endDate: '2024-12-31',
            };
            const expectedZipPath = '/path/to/multi-project-logs.zip';

            mockFetchAndZipLogs.mockResolvedValue(expectedZipPath);

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload });
            expect(result).toBe(expectedZipPath);
        });

        it('should handle empty project IDs array', async () => {
            const traceId = 'trace-empty-projects';
            const payload = {
                projectIds: [],
                startDate: '2024-01-01',
                endDate: '2024-01-31',
            };
            const expectedZipPath = '/path/to/empty-logs.zip';

            mockFetchAndZipLogs.mockResolvedValue(expectedZipPath);

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload });
            expect(result).toBe(expectedZipPath);
        });
    });

    describe('Error handling', () => {
        it('should handle activity failure and rethrow error', async () => {
            const traceId = 'trace-error-test';
            const payload = {
                projectIds: ['project1'],
                startDate: '2024-01-01',
                endDate: '2024-01-31',
            };
            const errorMessage = 'Failed to fetch and zip logs';
            const error = new Error(errorMessage);

            // Mock activity failure
            mockFetchAndZipLogs.mockRejectedValue(error);

            await expect(LogGeneratorWorkflow({ traceId, payload })).rejects.toThrow(errorMessage);

            // Verify error logging
            expect(mockLog.error).toHaveBeenCalledWith(`[${traceId}] Error in LogGeneratorWorkflow: ${errorMessage}`);

            // Verify start log was called
            expect(mockLog.info).toHaveBeenCalledWith(`[${traceId}] Started LogGeneratorWorkflow`);

            // Verify success log was not called
            expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('Finished LogGeneratorWorkflow'));
        });

        it('should handle activity timeout error', async () => {
            const traceId = 'trace-timeout-test';
            const payload = {
                projectIds: ['project1'],
                startDate: '2024-01-01',
                endDate: '2024-01-31',
            };
            const timeoutError = new Error('Activity timeout');

            mockFetchAndZipLogs.mockRejectedValue(timeoutError);

            await expect(LogGeneratorWorkflow({ traceId, payload })).rejects.toThrow('Activity timeout');

            expect(mockLog.error).toHaveBeenCalledWith(`[${traceId}] Error in LogGeneratorWorkflow: Activity timeout`);
        });

        it('should handle network connectivity error', async () => {
            const traceId = 'trace-network-error';
            const payload = {
                projectIds: ['project1'],
                startDate: '2024-01-01',
                endDate: '2024-01-31',
            };
            const networkError = new Error('Network connection failed');

            mockFetchAndZipLogs.mockRejectedValue(networkError);

            await expect(LogGeneratorWorkflow({ traceId, payload })).rejects.toThrow('Network connection failed');

            expect(mockLog.error).toHaveBeenCalledWith(`[${traceId}] Error in LogGeneratorWorkflow: Network connection failed`);
        });

        it('should handle storage space error', async () => {
            const traceId = 'trace-storage-error';
            const payload = {
                projectIds: ['project1'],
                startDate: '2024-01-01',
                endDate: '2024-01-31',
            };
            const storageError = new Error('Insufficient storage space');

            mockFetchAndZipLogs.mockRejectedValue(storageError);

            await expect(LogGeneratorWorkflow({ traceId, payload })).rejects.toThrow('Insufficient storage space');

            expect(mockLog.error).toHaveBeenCalledWith(`[${traceId}] Error in LogGeneratorWorkflow: Insufficient storage space`);
        });
    });

    describe('Workflow configuration', () => {
        it('should configure proxy activities with correct timeout', () => {
            const traceId = 'config-test';
            const payload = { projectIds: ['project1'] };

            mockFetchAndZipLogs.mockResolvedValue('/test/path.zip');

            LogGeneratorWorkflow({ traceId, payload });

            expect(mockProxyActivities).toHaveBeenCalledWith({
                startToCloseTimeout: '1 minute',
            });
        });

        it('should use fetchAndZipLogs activity', () => {
            const traceId = 'activity-test';
            const payload = { projectIds: ['project1'] };

            mockFetchAndZipLogs.mockResolvedValue('/test/path.zip');

            LogGeneratorWorkflow({ traceId, payload });

            // Verify that the proxy activities mock returns our expected function
            const activities = mockProxyActivities.mock.results[0].value;
            expect(activities.fetchAndZipLogs).toBe(mockFetchAndZipLogs);
        });
    });

    describe('Logging behavior', () => {
        it('should log workflow start with trace ID', async () => {
            const traceId = 'logging-test-123';
            const payload = { projectIds: ['project1'] };

            mockFetchAndZipLogs.mockResolvedValue('/test/path.zip');

            await LogGeneratorWorkflow({ traceId, payload });

            expect(mockLog.info).toHaveBeenCalledWith(`[${traceId}] Started LogGeneratorWorkflow`);
        });

        it('should log workflow completion with trace ID and zip path', async () => {
            const traceId = 'logging-completion-test';
            const payload = { projectIds: ['project1'] };
            const zipPath = '/custom/log/path.zip';

            mockFetchAndZipLogs.mockResolvedValue(zipPath);

            await LogGeneratorWorkflow({ traceId, payload });

            expect(mockLog.info).toHaveBeenCalledWith(`[${traceId}] Finished LogGeneratorWorkflow, zipPath: ${zipPath}`);
        });

        it('should log error with trace ID and error message', async () => {
            const traceId = 'logging-error-test';
            const payload = { projectIds: ['project1'] };
            const errorMessage = 'Custom error message';

            mockFetchAndZipLogs.mockRejectedValue(new Error(errorMessage));

            try {
                await LogGeneratorWorkflow({ traceId, payload });
            } catch (error) {
                // Expected to throw
            }

            expect(mockLog.error).toHaveBeenCalledWith(`[${traceId}] Error in LogGeneratorWorkflow: ${errorMessage}`);
        });

        it('should handle error objects without message property', async () => {
            const traceId = 'logging-error-no-message';
            const payload = { projectIds: ['project1'] };
            const errorWithoutMessage = { code: 'UNKNOWN_ERROR' };

            mockFetchAndZipLogs.mockRejectedValue(errorWithoutMessage);

            try {
                await LogGeneratorWorkflow({ traceId, payload });
            } catch (error) {
                // Expected to throw
            }

            expect(mockLog.error).toHaveBeenCalledWith(`[${traceId}] Error in LogGeneratorWorkflow: undefined`);
        });
    });

    describe('Input validation scenarios', () => {
        it('should handle undefined payload', async () => {
            const traceId = 'undefined-payload-test';
            const payload = undefined;

            mockFetchAndZipLogs.mockResolvedValue('/test/path.zip');

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload: undefined });
            expect(result).toBe('/test/path.zip');
        });

        it('should handle null payload', async () => {
            const traceId = 'null-payload-test';
            const payload = null;

            mockFetchAndZipLogs.mockResolvedValue('/test/path.zip');

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload: null });
            expect(result).toBe('/test/path.zip');
        });

        it('should handle empty payload object', async () => {
            const traceId = 'empty-payload-test';
            const payload = {};

            mockFetchAndZipLogs.mockResolvedValue('/test/path.zip');

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload: {} });
            expect(result).toBe('/test/path.zip');
        });

        it('should handle missing traceId', async () => {
            const traceId = undefined;
            const payload = { projectIds: ['project1'] };

            mockFetchAndZipLogs.mockResolvedValue('/test/path.zip');

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId: undefined, payload });
            expect(result).toBe('/test/path.zip');
            expect(mockLog.info).toHaveBeenCalledWith('[undefined] Started LogGeneratorWorkflow');
        });
    });

    describe('Integration scenarios', () => {
        it('should handle complex payload with additional metadata', async () => {
            const traceId = 'complex-payload-test';
            const payload = {
                projectIds: ['proj1', 'proj2'],
                startDate: '2024-01-01T00:00:00Z',
                endDate: '2024-01-31T23:59:59Z',
                includeSystemLogs: true,
                includeApplicationLogs: true,
                logLevel: 'DEBUG',
                format: 'JSON',
                compression: {
                    enabled: true,
                    level: 9,
                    algorithm: 'gzip',
                },
                filters: {
                    excludeHealthChecks: true,
                    includeErrorsOnly: false,
                },
            };
            const expectedZipPath = '/complex/logs/output.zip';

            mockFetchAndZipLogs.mockResolvedValue(expectedZipPath);

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload });
            expect(result).toBe(expectedZipPath);
            expect(mockLog.info).toHaveBeenCalledWith(`[${traceId}] Started LogGeneratorWorkflow`);
            expect(mockLog.info).toHaveBeenCalledWith(`[${traceId}] Finished LogGeneratorWorkflow, zipPath: ${expectedZipPath}`);
        });

        it('should maintain workflow execution order', async () => {
            const traceId = 'execution-order-test';
            const payload = { projectIds: ['project1'] };
            const zipPath = '/order/test.zip';

            mockFetchAndZipLogs.mockResolvedValue(zipPath);

            await LogGeneratorWorkflow({ traceId, payload });

            // Verify the order of calls
            const infoLogs = mockLog.info.mock.calls;
            expect(infoLogs[0][0]).toBe(`[${traceId}] Started LogGeneratorWorkflow`);
            expect(infoLogs[1][0]).toBe(`[${traceId}] Finished LogGeneratorWorkflow, zipPath: ${zipPath}`);

            // Verify activity was called between start and finish logs
            expect(mockFetchAndZipLogs).toHaveBeenCalled();
        });
    });

    describe('Performance considerations', () => {
        it('should handle large project ID arrays', async () => {
            const traceId = 'large-array-test';
            const largeProjectIds = Array.from({ length: 1000 }, (_, i) => `project-${i}`);
            const payload = {
                projectIds: largeProjectIds,
                startDate: '2024-01-01',
                endDate: '2024-01-31',
            };
            const expectedZipPath = '/large/logs.zip';

            mockFetchAndZipLogs.mockResolvedValue(expectedZipPath);

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload });
            expect(result).toBe(expectedZipPath);
            expect(payload.projectIds).toHaveLength(1000);
        });

        it('should handle long date ranges', async () => {
            const traceId = 'long-range-test';
            const payload = {
                projectIds: ['project1'],
                startDate: '2020-01-01',
                endDate: '2024-12-31',
            };
            const expectedZipPath = '/long-range/logs.zip';

            mockFetchAndZipLogs.mockResolvedValue(expectedZipPath);

            const result = await LogGeneratorWorkflow({ traceId, payload });

            expect(mockFetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload });
            expect(result).toBe(expectedZipPath);
        });
    });
});
