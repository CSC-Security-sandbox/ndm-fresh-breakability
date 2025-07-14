import { WorkFlowOptions } from './worker-options.factory';
import { NativeConnection } from '@temporalio/worker';

jest.mock('@temporalio/worker', () => ({
  NativeConnection: jest.fn(),
}));

// Mock require.resolve for workflowsPath
const mockWorkflowsPath = '/mocked/path/to/workflows.js';
jest.spyOn(require, 'resolve').mockImplementation((path: string) => {
  if (path === '../../workflows/workflows') {
    return mockWorkflowsPath;
  }
  throw new Error('Unexpected path');
});

describe('WorkFlowOptions', () => {
  const identity = 'test-identity';
  const workerId = 'worker-123';
  const connection = {} as NativeConnection;
  const taskQueue = 'test-queue';

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('should set taskQueue with prefix when dynamicTaskQueue is true', () => {
    const config = { dynamicTaskQueue: true, taskQueueId: 'id-2' } as any;

    const options = new WorkFlowOptions(
      identity,
      workerId,
      connection,
      taskQueue,
      config
    );

    expect(options.taskQueue).toBe('id-2-test-queue');
  });

  it('should set activities and maxConcurrentActivityTaskExecutions to undefined by default', () => {
    const config = { dynamicTaskQueue: false, taskQueueId: 'id-3' } as any;

    const options = new WorkFlowOptions(
      identity,
      workerId,
      connection,
      taskQueue,
      config
    );

    expect(options.activities).toBeUndefined();
    expect(options.maxConcurrentActivityTaskExecutions).toBeUndefined();
  });
});