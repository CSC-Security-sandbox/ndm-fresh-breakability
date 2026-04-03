// Variables prefixed with "mock" are accessible inside jest.mock() factories
// because Jest special-cases that naming convention during hoisting.
const mockUpdateStatus = jest.fn().mockResolvedValue(undefined);
const mockUpdateWorkerResponse = jest.fn().mockResolvedValue(undefined);
const mockGenerateCOCReport = jest.fn().mockResolvedValue(undefined);
const mockGenerateJobsReport = jest.fn().mockResolvedValue(undefined);
const mockStartChild = jest.fn().mockResolvedValue(undefined);
const mockCondition = jest.fn().mockResolvedValue(undefined);
const mockSetHandler = jest.fn();
const mockLogWarn = jest.fn();
const mockLogInfo = jest.fn();

jest.mock('@temporalio/workflow', () => ({
    defineQuery: jest.fn().mockReturnValue('isReportedQuery'),
    defineSignal: jest.fn().mockReturnValue('reportingSignal'),
    setHandler: mockSetHandler,
    condition: mockCondition,
    proxyActivities: jest.fn().mockReturnValue({
        updateStatus: mockUpdateStatus,
        updateWorkerResponse: mockUpdateWorkerResponse,
        generateCOCReport: mockGenerateCOCReport,
        generateJobsReport: mockGenerateJobsReport,
    }),
    startChild: mockStartChild,
    log: { info: mockLogInfo, warn: mockLogWarn },
    CancelledFailure: class CancelledFailure extends Error {},
    ChildWorkflowCancellationType: { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' },
    ParentClosePolicy: { ABANDON: 'ABANDON' },
}));

import { handleReporting, JobReportType } from './handle-reporting';
import { JobRunStatus } from 'src/activities/common/enums';

describe('handleReporting', () => {
    const traceId = 'job-abc-123';
    let signalHandler: ((input: string) => void) | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        signalHandler = null;

        mockCondition.mockResolvedValue(undefined);

        // Capture the reporting signal handler by checking the first arg token
        mockSetHandler.mockImplementation((token: string, handler: any) => {
            if (token === 'reportingSignal') {
                signalHandler = handler;
            }
        });
    });

    /**
     * Helper: starts handleReporting, fires a signal, and awaits completion.
     *
     * setHandler() is called synchronously inside handleReporting before the
     * first "await condition()", so signalHandler is populated by the time we
     * call it here — and condition's Promise.resolve() queues the continuation
     * as a microtask, which runs only after our synchronous signal call.
     */
    const run = async (signal: string, status: JobRunStatus = JobRunStatus.Completed): Promise<string> => {
        const p = handleReporting(traceId, status);
        signalHandler!(signal);
        return p;
    };

    // ── JobReportType enum ────────────────────────────────────────────────────

    describe('JobReportType', () => {
        it('includes DB_WRITER_FAILURE with value DB_WRITER_FAILURE_REPORTED', () => {
            expect(JobReportType.DB_WRITER_FAILURE).toBe('DB_WRITER_FAILURE_REPORTED');
        });

        it('retains all pre-existing enum values unchanged', () => {
            expect(JobReportType.MIGRATE).toBe('MIGRATE_REPORTED');
            expect(JobReportType.CUT_OVER).toBe('CUT_OVER_REPORTED');
            expect(JobReportType.DISCOVER).toBe('DISCOVER_REPORTED');
            expect(JobReportType.RETRY).toBe('RETRY_REPORTED');
        });
    });

    // ── DB_WRITER_FAILURE signal path ─────────────────────────────────────────

    describe('when DB_WRITER_FAILURE_REPORTED signal is received', () => {
        it('unblocks the wf.condition call', async () => {
            await run(JobReportType.DB_WRITER_FAILURE);
            expect(mockCondition).toHaveBeenCalledTimes(1);
        });

        it('calls updateStatus with JobRunStatus.Failed regardless of child workflow status', async () => {
            await run(JobReportType.DB_WRITER_FAILURE, JobRunStatus.Completed);
            expect(mockUpdateStatus).toHaveBeenCalledWith({
                jobRunId: traceId,
                status: JobRunStatus.Failed,
            });
        });

        it('overrides a Failed child status — updateStatus still receives Failed', async () => {
            await run(JobReportType.DB_WRITER_FAILURE, JobRunStatus.Failed);
            expect(mockUpdateStatus).toHaveBeenCalledWith({
                jobRunId: traceId,
                status: JobRunStatus.Failed,
            });
        });

        it('overrides a Running child status — updateStatus still receives Failed', async () => {
            await run(JobReportType.DB_WRITER_FAILURE, JobRunStatus.Running);
            expect(mockUpdateStatus).toHaveBeenCalledWith({
                jobRunId: traceId,
                status: JobRunStatus.Failed,
            });
        });

        it('calls updateWorkerResponse with DB_WRITER_FAILURE code and failure message', async () => {
            await run(JobReportType.DB_WRITER_FAILURE);
            expect(mockUpdateWorkerResponse).toHaveBeenCalledWith(
                traceId,
                'all',
                expect.objectContaining({
                    status: JobRunStatus.Failed,
                    code: 'DB_WRITER_FAILURE',
                    origin: 'DbWriterService',
                    message: expect.stringContaining('DB writer worker threads exhausted all retries'),
                }),
            );
        });

        it('does NOT call generateCOCReportActivity', async () => {
            await run(JobReportType.DB_WRITER_FAILURE);
            expect(mockGenerateCOCReport).not.toHaveBeenCalled();
        });

        it('does NOT call generateJobsReportActivity', async () => {
            await run(JobReportType.DB_WRITER_FAILURE);
            expect(mockGenerateJobsReport).not.toHaveBeenCalled();
        });

        it('does NOT start any child report workflow', async () => {
            await run(JobReportType.DB_WRITER_FAILURE);
            expect(mockStartChild).not.toHaveBeenCalled();
        });

        it('logs a warning containing "skipping report generation"', async () => {
            await run(JobReportType.DB_WRITER_FAILURE);
            expect(mockLogWarn).toHaveBeenCalledWith(
                expect.stringContaining('skipping report generation'),
            );
        });

        it('returns "REPORTING COMPLETED"', async () => {
            const result = await run(JobReportType.DB_WRITER_FAILURE);
            expect(result).toBe('REPORTING COMPLETED');
        });
    });

    // ── getMappedJobRunStatus behaviour (tested via updateStatus args) ────────

    describe('getMappedJobRunStatus', () => {
        it('DB_WRITER_FAILURE always maps to Failed — Completed input', async () => {
            await run(JobReportType.DB_WRITER_FAILURE, JobRunStatus.Completed);
            expect(mockUpdateStatus).toHaveBeenCalledWith(
                expect.objectContaining({ status: JobRunStatus.Failed }),
            );
        });

        it('CUT_OVER + Completed maps to BLOCKED', async () => {
            await run(JobReportType.CUT_OVER, JobRunStatus.Completed);
            expect(mockUpdateStatus).toHaveBeenCalledWith({
                jobRunId: traceId,
                status: JobRunStatus.BLOCKED,
            });
        });

        it('MIGRATE + Completed passes through as Completed', async () => {
            await run(JobReportType.MIGRATE, JobRunStatus.Completed);
            expect(mockUpdateStatus).toHaveBeenCalledWith({
                jobRunId: traceId,
                status: JobRunStatus.Completed,
            });
        });

        it('MIGRATE + Failed passes through as Failed', async () => {
            await run(JobReportType.MIGRATE, JobRunStatus.Failed);
            expect(mockUpdateStatus).toHaveBeenCalledWith({
                jobRunId: traceId,
                status: JobRunStatus.Failed,
            });
        });
    });

    // ── Unknown signal — silently ignored ─────────────────────────────────────

    describe('unknown signal input', () => {
        it('is ignored and does not unblock the condition on its own', async () => {
            // Fire an unknown signal (should be a no-op), then a valid one to unblock.
            const p = handleReporting(traceId, JobRunStatus.Completed);
            signalHandler!('TOTALLY_UNKNOWN_SIGNAL');
            signalHandler!(JobReportType.MIGRATE);
            await p;

            // The valid MIGRATE signal controlled the reportType, not the unknown one.
            // If the unknown signal had set reportType, updateStatus would have been
            // called with null context, causing a throw — the test itself passing
            // proves the unknown signal was a no-op.
            expect(mockUpdateStatus).toHaveBeenCalledWith({
                jobRunId: traceId,
                status: JobRunStatus.Completed,
            });
        });
    });

    // ── Regression — existing signal types ────────────────────────────────────

    describe('existing signal types (regression)', () => {
        it('MIGRATE: calls generateCOCReportActivity with traceId', async () => {
            await run(JobReportType.MIGRATE);
            expect(mockGenerateCOCReport).toHaveBeenCalledWith(traceId);
            expect(mockGenerateJobsReport).not.toHaveBeenCalled();
        });

        it('RETRY: calls generateCOCReportActivity with traceId', async () => {
            await run(JobReportType.RETRY);
            expect(mockGenerateCOCReport).toHaveBeenCalledWith(traceId);
        });

        it('DISCOVER: starts GenerateDiscoveryReportWorkflow child workflow', async () => {
            await run(JobReportType.DISCOVER);
            expect(mockStartChild).toHaveBeenCalledWith(
                'GenerateDiscoveryReportWorkflow',
                expect.objectContaining({ args: [{ jobRunId: traceId }] }),
            );
        });

        it('CUT_OVER: calls both generateCOCReport and generateJobsReport', async () => {
            await run(JobReportType.CUT_OVER);
            expect(mockGenerateCOCReport).toHaveBeenCalledWith(traceId);
            expect(mockGenerateJobsReport).toHaveBeenCalledWith(traceId);
        });

        it('all existing types: return "REPORTING COMPLETED"', async () => {
            for (const signal of [JobReportType.MIGRATE, JobReportType.RETRY, JobReportType.DISCOVER, JobReportType.CUT_OVER]) {
                jest.clearAllMocks();
                mockCondition.mockResolvedValue(undefined);
                mockSetHandler.mockImplementation((token: string, handler: any) => {
                    if (token === 'reportingSignal') signalHandler = handler;
                });
                const result = await run(signal);
                expect(result).toBe('REPORTING COMPLETED');
            }
        });
    });
});
