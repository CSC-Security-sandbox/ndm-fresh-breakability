import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { JobRunStatus } from 'src/activities/discovery/enums';
import { DiscoveryJobWorkflow, syncWorkerListSignal } from './discovery-job-workflow';
import { DiscoverPathOutput } from 'src/activities/discovery/discovery.type';
import { temporal } from '@temporalio/proto';
import { ApplicationFailure } from '@temporalio/common';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';

const workflowCoverage = new WorkflowCoverage();

describe('DiscoveryJobWorkflow', () => {
    let env: TestWorkflowEnvironment;
    const mockScanActivity = jest.fn<Promise<DiscoverPathOutput>, any[]>();
    const mockPublishTask = jest.fn<Promise<void>, any[]>();
    const mockDiscoveryStatusUpdate = jest.fn<Promise<void>, any[]>();
    const mockUpdateLastEntry = jest.fn<Promise<void>, any[]>();
    const mockGetJobState = jest.fn<Promise<any>, any[]>();
    const mockUpdateStatus = jest.fn<Promise<void>, any[]>();
    const mockSetJobState = jest.fn<Promise<void>, any[]>();
    const mockGetJobStateAndUpdateTaskList = jest.fn<Promise<any>, any[]>();
    const hasRunningScanTaskActivity = jest.fn<Promise<boolean>, any[]>();
    let worker: Worker;

    beforeAll(async () => {
        try {
            env = await TestWorkflowEnvironment.createTimeSkipping();
        } catch (e) {
            console.error('Error during test environment setup:', e);
            if (!!env) {
                await env.teardown();
            }
        }
    });

    beforeEach(() => {
        jest.clearAllMocks()
        mockScanActivity.mockReset();
        mockPublishTask.mockReset();
        mockDiscoveryStatusUpdate.mockReset();
        mockUpdateLastEntry.mockReset();
        mockGetJobState.mockReset();
        mockUpdateStatus.mockReset();
        mockSetJobState.mockReset();
        mockGetJobStateAndUpdateTaskList.mockReset();
        hasRunningScanTaskActivity.mockReset();
    });

    afterAll(async () => {
        if (worker && ['RUNNING', 'STARTED'].includes(worker.getState())) {
            await worker?.shutdown();
        }
        await env.teardown();
        workflowCoverage.mergeIntoGlobalCoverage();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
    });

   it("should handle syncWorkerListSignal correctly",  async () => { 
    let jobRunId = 'test-job-run-id';
    let workers = ['worker1'];
    let failedWorkers: string[] = [];

    // --------- activity mocks ---------- 
    let scanCallCount = 0; 
    mockGetJobStateAndUpdateTaskList.mockResolvedValue({
        status: JobRunStatus.Running,
    });
    hasRunningScanTaskActivity.mockResolvedValue(true);
    mockScanActivity.mockImplementation( () => {
        scanCallCount++;  
        if(scanCallCount < 10) {
            return Promise.resolve({
                isFatalErrored: false, 
                noTaskFound: false, 
                taskId: "task-id-" + scanCallCount, 
                files: 0, 
                folders: 0 , 
                workerId: "worker1",
            });   
        }else{
            hasRunningScanTaskActivity.mockResolvedValue(false);
            return Promise.resolve({
                isFatalErrored: false, 
                noTaskFound: true, 
                taskId: undefined, 
                files: 0, 
                folders: 0 , 
                workerId: scanCallCount % 2 == 1 ? "worker1": "worker2",
            });
        }
     });

    worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
        connection: env.nativeConnection,
        workflowsPath: require.resolve('./discovery-job-workflow'),
        activities: {
            scanActivity:  mockScanActivity,
            publishTask: mockPublishTask,
            discoveryStatusUpdate: mockDiscoveryStatusUpdate,
            updateLastEntry: mockUpdateLastEntry,
            getJobState: mockGetJobState,
            updateStatus: mockUpdateStatus,
            setJobState: mockSetJobState,
            getJobStateAndUpdateTaskList: mockGetJobStateAndUpdateTaskList,
            hasRunningScanTask: hasRunningScanTaskActivity,

        },
        taskQueue: 'test-task-queue',
    }));

    await worker.runUntil(async () => {         
        const handle = await env.client.workflow.start(DiscoveryJobWorkflow,{
            args: [{
                jobRunId: jobRunId,
                workers: workers,
                failedWorkers: failedWorkers
            }],
            taskQueue: 'test-task-queue',
            workflowId: `DiscoveryJobWorkflow-${jobRunId}`,
        
        });
        await handle.signal(syncWorkerListSignal, ['worker2']);
        const {workflowId } = handle;
        const {runId: firstRunId} = await handle.describe()

        const result = await handle.result();
    
        const historyResponse = await env.client.workflowService.getWorkflowExecutionHistory({
            namespace: 'default',
            execution: { workflowId, runId: firstRunId },
        });
        console.log('Workflow history:', historyResponse.history.events);
        const events = historyResponse.history.events;
        const hasSignalled = events.some((event) =>
            event.eventType == temporal.api.enums.v1.EventType.EVENT_TYPE_WORKFLOW_EXECUTION_SIGNALED
        );
        expect(hasSignalled).toBe(true);
    })    
    }, 1000 * 60 * 2);
   
  
   it("should run the discovery job workflow sucessfully", async () => {
    let jobRunId = 'test-job-run-id';
    let workers = ['worker1', 'worker2'];
    let failedWorkers: string[] = [];

    // --------- activity mocks ---------- 
    let scanCallCount = 0; 
    mockGetJobStateAndUpdateTaskList.mockResolvedValue({
        status: JobRunStatus.Running,
    });

    hasRunningScanTaskActivity.mockResolvedValue(true);
    mockScanActivity.mockImplementation( () => {
        scanCallCount++;
        hasRunningScanTaskActivity.mockResolvedValue(false);
        return Promise.resolve({
            isFatalErrored: false, 
            noTaskFound: true, 
            taskId: undefined, 
            files: 0, 
            folders: 0 , 
            workerId: scanCallCount % 2 == 1 ? "worker1": "worker2",
        });
    });

    mockPublishTask.mockResolvedValue();

    worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
        connection: env.nativeConnection,
        workflowsPath: require.resolve('./discovery-job-workflow'),
        activities: {
            scanActivity:  mockScanActivity,
            publishTask: mockPublishTask,
            discoveryStatusUpdate: mockDiscoveryStatusUpdate,
            updateLastEntry: mockUpdateLastEntry,
            getJobState: mockGetJobState,
            updateStatus: mockUpdateStatus,
            setJobState: mockSetJobState,
            getJobStateAndUpdateTaskList: mockGetJobStateAndUpdateTaskList,
            hasRunningScanTask: hasRunningScanTaskActivity,
        },
        taskQueue: 'test-task-queue',
    }));
    await worker.runUntil(async () => {
        const result = await env.client.workflow.execute(DiscoveryJobWorkflow,{
            args: [{
            jobRunId: jobRunId,
            workers: workers,
            failedWorkers: failedWorkers,

            }],
            taskQueue: 'test-task-queue',
            workflowId: `DiscoveryJobWorkflow-${jobRunId}`,
        });
        console.log('Workflow result:', result);

    });
    expect(mockDiscoveryStatusUpdate).not.toHaveBeenCalled();
    expect(mockPublishTask).toHaveBeenCalled();
   });

   it("should return if the jobstate is stopped", async () => {
    let jobRunId = 'test-job-run-id';
    let workers = ['worker1', 'worker2'];
    let failedWorkers: string[] = [];

    // --------- activity mocks ---------- 
    mockGetJobStateAndUpdateTaskList.mockResolvedValue({
        status: JobRunStatus.Stopped,
    });

    hasRunningScanTaskActivity.mockResolvedValue(true);
    worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
        connection: env.nativeConnection,
        workflowsPath: require.resolve('./discovery-job-workflow'),
        activities: {
            scanActivity:  mockScanActivity,
            publishTask: mockPublishTask,
            discoveryStatusUpdate: mockDiscoveryStatusUpdate,
            updateLastEntry: mockUpdateLastEntry,
            getJobState: mockGetJobState,
            updateStatus: mockUpdateStatus,
            setJobState: mockSetJobState,
            getJobStateAndUpdateTaskList: mockGetJobStateAndUpdateTaskList,
            hasRunningScanTask: hasRunningScanTaskActivity,
        },
        taskQueue: 'test-task-queue',
    }));
    await worker.runUntil(async () => {
        const result = await env.client.workflow.execute(DiscoveryJobWorkflow,{
            args: [{
            jobRunId: jobRunId,
            workers: workers,
            failedWorkers: failedWorkers,
            }],
            taskQueue: 'test-task-queue',
            workflowId: `DiscoveryJobWorkflow-${jobRunId}`,
        });
        console.log('Workflow result:', result);

    });
    // 2 for each worker ,  1 for the actual task and 1 for last iteration. 
    expect(mockPublishTask).not.toHaveBeenCalled();
    expect(mockDiscoveryStatusUpdate).not.toHaveBeenCalled();
   });

   it("should return if the jobstate is paused", async () => {
        let jobRunId = 'test-job-run-id';
    let workers = ['worker1', 'worker2'];
    let failedWorkers: string[] = [];

    // --------- activity mocks ---------- 
    mockGetJobStateAndUpdateTaskList.mockResolvedValue({
        status: JobRunStatus.Paused,
    });
    hasRunningScanTaskActivity.mockResolvedValue(true);

    worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
        connection: env.nativeConnection,
        workflowsPath: require.resolve('./discovery-job-workflow'),
        activities: {
            scanActivity:  mockScanActivity,
            publishTask: mockPublishTask,
            discoveryStatusUpdate: mockDiscoveryStatusUpdate,
            updateLastEntry: mockUpdateLastEntry,
            getJobState: mockGetJobState,
            updateStatus: mockUpdateStatus,
            setJobState: mockSetJobState,
            getJobStateAndUpdateTaskList: mockGetJobStateAndUpdateTaskList,
            hasRunningScanTask: hasRunningScanTaskActivity,
        },
        taskQueue: 'test-task-queue',
    }));
    await worker.runUntil(async () => {
        const result = await env.client.workflow.execute(DiscoveryJobWorkflow,{
            args: [{
            jobRunId: jobRunId,
            workers: workers,
            failedWorkers: failedWorkers
            }],
            taskQueue: 'test-task-queue',
            workflowId: `DiscoveryJobWorkflow-${jobRunId}`,
        });
        console.log('Workflow result:', result);

    });
    // 2 for each worker ,  1 for the actual task and 1 for last iteration. 
    expect(mockPublishTask).not.toHaveBeenCalled();
    expect(mockDiscoveryStatusUpdate).not.toHaveBeenCalled();

   });
 
   it("should run the workflow as new when the iterations are greateer than 100", async () => {
    let jobRunId = 'test-job-run-id';
    let workers = ['worker1', 'worker2'];
    let failedWorkers: string[] = [];

    // --------- activity mocks ---------- 
    let scanCallCount = 0; 
    mockGetJobStateAndUpdateTaskList.mockResolvedValue({
        status: JobRunStatus.Running,
    });

    mockScanActivity.mockImplementation( () => {
        scanCallCount++;  
        if(scanCallCount < 102) {
            return Promise.resolve({
                isFatalErrored: false, 
                noTaskFound: false, 
                taskId: "task-id-" + scanCallCount, 
                files: 0, 
                folders: 0 , 
                workerId: "worker1",
            });   
        }else{
            hasRunningScanTaskActivity.mockResolvedValue(false);
            return Promise.resolve({
                isFatalErrored: false, 
                noTaskFound: true, 
                taskId: undefined, 
                files: 0, 
                folders: 0 , 
                workerId: scanCallCount % 2 == 1 ? "worker1": "worker2",
            });
        }
     });

    worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
        connection: env.nativeConnection,
        workflowsPath: require.resolve('./discovery-job-workflow'),
        activities: {
            scanActivity:  mockScanActivity,
            publishTask: mockPublishTask,
            discoveryStatusUpdate: mockDiscoveryStatusUpdate,
            updateLastEntry: mockUpdateLastEntry,
            getJobState: mockGetJobState,
            updateStatus: mockUpdateStatus,
            setJobState: mockSetJobState,
            getJobStateAndUpdateTaskList: mockGetJobStateAndUpdateTaskList,
            hasRunningScanTask: hasRunningScanTaskActivity,

        },
        taskQueue: 'test-task-queue',
    }));
    await worker.runUntil(async () => {         
        const handle = await env.client.workflow.start(DiscoveryJobWorkflow,{
            args: [{
                jobRunId: jobRunId,
                workers: workers,
                failedWorkers: failedWorkers,
            }],
            taskQueue: 'test-task-queue',
            workflowId: `DiscoveryJobWorkflow-${jobRunId}`,
        
        });
        const {runId: firstRunId} = await handle.describe()
        const result = await handle.result();
        const isContinuedAsNew = handle.workflowId !== firstRunId;

        expect(isContinuedAsNew).toBe(true);
    });
    }, 60000);

  it("should update the discovery status as error when error occurs", async () => {

    let jobRunId = 'test-job-run-id';
    let workers = ['worker1', 'worker2'];
    let failedWorkers: string[] = [];
  
    hasRunningScanTaskActivity.mockResolvedValue(true);
    mockGetJobStateAndUpdateTaskList.mockImplementationOnce(() => {
        throw ApplicationFailure.create({
            message: 'This is a non-retryable error',
            nonRetryable: true,
        });
    });
    worker = await Worker.create(workflowCoverage.augmentWorkerOptions({
        connection: env.nativeConnection,
        workflowsPath: require.resolve('./discovery-job-workflow'),
        activities: {
            scanActivity:  mockScanActivity,
            publishTask: mockPublishTask,
            discoveryStatusUpdate: mockDiscoveryStatusUpdate,
            updateLastEntry: mockUpdateLastEntry,
            getJobState: mockGetJobState,
            updateStatus: mockUpdateStatus,
            setJobState: mockSetJobState,
            getJobStateAndUpdateTaskList: mockGetJobStateAndUpdateTaskList,
            hasRunningScanTask: hasRunningScanTaskActivity,
        },
        taskQueue: 'test-task-queue',
    }));
    await worker.runUntil(async () => {
        const result = await env.client.workflow.execute(DiscoveryJobWorkflow,{
            args: [{
            jobRunId: jobRunId,
            workers: workers,
            failedWorkers: failedWorkers,
            }],
            taskQueue: 'test-task-queue',
            workflowId: `DiscoveryJobWorkflow-${jobRunId}`,
        });
        console.log('Workflow result:', result);
    });
    expect(mockDiscoveryStatusUpdate).toHaveBeenCalled();
  });
});