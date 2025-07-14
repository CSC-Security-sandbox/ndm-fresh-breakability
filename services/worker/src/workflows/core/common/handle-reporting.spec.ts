import { handleReporting, JobReportType } from './handle-reporting';
import { JobRunStatus } from 'src/activities/discovery/enums';
const wf = require('@temporalio/workflow');

// Mock @temporalio/workflow
jest.mock('@temporalio/workflow', () => {
    let handlers: Record<string, Function> = {};
    let queries: Record<string, Function> = {};
    let signals: Record<string, Function> = {};
    let logInfo = jest.fn();

    return {
        defineQuery: jest.fn((name: string) => name),
        defineSignal: jest.fn((name: string) => name),
        proxyActivities: jest.fn(() => ({})),
        setHandler: jest.fn((name: string, handler: Function) => {
            if (typeof handler === 'function') {
                if (name.includes('Signal')) signals[name] = handler;
                else queries[name] = handler;
            }
            handlers[name] = handler;
        }),
        condition: jest.fn(async (fn: () => boolean) => {
            // Wait until fn returns true
            let tries = 0;
            while (!fn() && tries < 10) {
                await new Promise((r) => setTimeout(r, 1));
                tries++;
            }
            return;
        }),
        log: { info: logInfo },
        CancelledFailure: class extends Error {},
        __handlers: handlers,
        __queries: queries,
        __signals: signals,
        __logInfo: logInfo,
    };
});


// Mock activities
const updateStatusActivity = jest.fn();
const generateCOCReportActivity = jest.fn();
const generateJobsReportActivity = jest.fn();
const generateDiscoveryReportActivity = jest.fn();

jest.mock('./handle-reporting', () => {
    const original = jest.requireActual('./handle-reporting');
    return {
        ...original,
        // Export the enums for test usage
        JobReportType: original.JobReportType,
        handleReporting: original.handleReporting,
    };
});

// Patch proxyActivities to return our mocks
(wf.proxyActivities as jest.Mock).mockImplementation((_: any) => {
    return {
        updateStatus: updateStatusActivity,
        generateCOCReport: generateCOCReportActivity,
        generateJobsReport: generateJobsReportActivity,
        generateDiscoveryReport: generateDiscoveryReportActivity,
    };
});

describe('handleReporting', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset isBlocked and reportType by re-importing the module
        jest.resetModules();
    });

    it('should handle workflow cancellation', async () => {
        const traceId = 'trace-5';
        const status = JobRunStatus.Completed;

        let signalHandler: any;
        (wf.setHandler as jest.Mock).mockImplementation((name, handler) => {
            if (name === 'reportingSignal') signalHandler = handler;
        });

        // Patch wf.condition to throw CancelledFailure
        (wf.condition as jest.Mock).mockImplementationOnce(() => {
            throw new wf.CancelledFailure();
        });

        await expect(handleReporting(traceId, status)).rejects.toBeInstanceOf(wf.CancelledFailure);
        expect(wf.log.info).toHaveBeenCalledWith('Workflow cancelled');
    });
});