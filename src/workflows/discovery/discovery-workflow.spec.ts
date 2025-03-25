import * as wf from '@temporalio/workflow';
import { DiscoveryWorkflow, reportingSignal } from './discovery-workflow';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { ReportingWorkflow } from '../reporting/reporting.workflow';

// Comprehensive mock of @temporalio/workflow
jest.mock('@temporalio/workflow', () => {
    const originalModule = jest.requireActual('@temporalio/workflow');
    return {
        ...originalModule,
        executeChild: jest.fn(),
        proxyActivities: jest.fn(() => ({
            getJobState: jest.fn(),
            setJobState: jest.fn(),
            updateJobErrorStatus: jest.fn(),
        })),
        defineSignal: originalModule.defineSignal
    };
});

// Mock Workflows
jest.mock('../reporting/reporting.workflow', () => ({
    ReportingWorkflow: jest.fn()
}));

describe('DiscoveryWorkflow', () => {
    // Mock activities
    const mockGetJobStateActivity = jest.fn();
    const mockSetJobStateActivity = jest.fn();
    const mockUpdateJobErrorActivity = jest.fn();

    // Setup mocks before each test
    beforeEach(() => {
        jest.clearAllMocks();

        // Reset mock implementations
        (wf.proxyActivities as jest.Mock).mockReturnValue({
            getJobState: mockGetJobStateActivity,
            setJobState: mockSetJobStateActivity,
            updateJobErrorStatus: mockUpdateJobErrorActivity
        });

        // Mock console methods to prevent cluttering test output
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // Scenario 1: Successful workflow with multiple workers
    it('should successfully run discovery workflow with multiple workers', async () => {
        // Setup mock data
        const traceId = 'test-trace-id';
        const payload = {
            workers: ['worker1', 'worker2']
        };
        const options = {};

        // Mock job state methods with explicit and consistent failedWorkers
        mockGetJobStateActivity.mockResolvedValue({ 
            workers: [], 
            failedWorkers: [], // Explicitly set empty array
            status: JobRunStatus.Pending 
        });

        // Rest of the test remains the same...
    });

    // Scenario 2: No active workers
    it('should handle scenario with no active workers', async () => {
        // Setup mock data
        const traceId = 'test-trace-id';
        const payload = {
            workers: ['worker1', 'worker2']
        };
        const options = {};

        // Ensure failedWorkers is always defined
        mockGetJobStateActivity.mockResolvedValue({ 
            workers: [], 
            failedWorkers: ['worker1', 'worker2'], // Explicit array
            status: JobRunStatus.Pending 
        });

        // Rest of the test remains the same...
    });

    // Scenario 3: Partial worker success with error in discovery
    it('should handle errors during discovery job workflow', async () => {
        // Setup mock data
        const traceId = 'test-trace-id';
        const payload = {
            workers: ['worker1', 'worker2']
        };
        const options = {};

        // Ensure failedWorkers is always defined
        mockGetJobStateActivity.mockResolvedValue({ 
            workers: [], 
            failedWorkers: ['worker1', 'worker2'], // Explicit array
            status: JobRunStatus.Pending 
        });

        // Rest of the test remains the same...
    });

    // Scenario 4: ContinueAsNew scenario in discovery workflow
    it('should handle ContinueAsNew workflow scenario', async () => {
        // Setup mock data
        const traceId = 'test-trace-id';
        const payload = {
            workers: ['worker1']
        };
        const options = {};

        // Ensure failedWorkers is always defined
        mockGetJobStateActivity.mockResolvedValue({ 
            workers: [], 
            failedWorkers: [], // Explicit empty array
            status: JobRunStatus.Pending 
        });

        // Rest of the test remains the same...
    });
});