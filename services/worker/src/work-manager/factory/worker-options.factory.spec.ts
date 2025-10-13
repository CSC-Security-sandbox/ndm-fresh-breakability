import { WorkFlowOptions } from './worker-options.factory';
import { NativeConnection } from '@temporalio/worker';

describe('WorkFlowOptions', () => {
  const mockConnection = {} as NativeConnection;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should set properties correctly when dynamicTaskQueue is false', () => {
    const config = { dynamicTaskQueue: false, taskQueueId: 'id1' } as any;
    const options = new WorkFlowOptions(
      'identity1',
      'worker1',
      mockConnection,
      'queue1',
      config,
      { foo: 'bar' },
      5,
    );

    expect(options.identity).toBe('identity1');
    expect(options.workerId).toBe('worker1');
    expect(options.connection).toBe(mockConnection);
    expect(options.taskQueue).toBe('queue1');
    expect(options.activities).toEqual({ foo: 'bar' });
  });

  it('should set taskQueue with prefix when dynamicTaskQueue is true', () => {
    const config = { dynamicTaskQueue: true, taskQueueId: 'prefix' } as any;
    const options = new WorkFlowOptions(
      'identity2',
      'worker2',
      mockConnection,
      'queue2',
      config,
    );

    expect(options.taskQueue).toBe('prefix-queue2');
  });

  it('should set activities and maxConcurrentActivityTaskExecutions to undefined by default', () => {
    const config = { dynamicTaskQueue: false, taskQueueId: 'id2' } as any;
    const options = new WorkFlowOptions(
      'identity3',
      'worker3',
      mockConnection,
      'queue3',
      config,
    );

    expect(options.activities).toBeUndefined();
    expect(options.maxConcurrentActivityTaskExecutions).toBeUndefined();
  });

  it('should set workflowsPath using require.resolve', () => {
    const config = { dynamicTaskQueue: false, taskQueueId: 'id3' } as any;
    const options = new WorkFlowOptions(
      'identity4',
      'worker4',
      mockConnection,
      'queue4',
      config,
    );

    // Verify that workflowsPath is set to the resolved path
    expect(options.workflowsPath).toContain('workflows');
    expect(typeof options.workflowsPath).toBe('string');
  });

  it('should set shutdownForceTime to default value when not provided', () => {
    const config = { dynamicTaskQueue: false, taskQueueId: 'id4' } as any;
    const options = new WorkFlowOptions(
      'identity5',
      'worker5',
      mockConnection,
      'queue5',
      config,
    );

    expect(options.shutdownForceTime).toBe('30s');
  });

  it('should set custom shutdownForceTime when provided', () => {
    const config = { dynamicTaskQueue: false, taskQueueId: 'id5' } as any;
    const options = new WorkFlowOptions(
      'identity6',
      'worker6',
      mockConnection,
      'queue6',
      config,
      undefined,
      undefined,
      '60s',
    );

    expect(options.shutdownForceTime).toBe('60s');
  });

  it('should set maxConcurrentActivityTaskExecutions when provided', () => {
    const config = {
      dynamicTaskQueue: true,
      taskQueueId: 'concurrent-test',
    } as any;
    const options = new WorkFlowOptions(
      'identity7',
      'worker7',
      mockConnection,
      'queue7',
      config,
      { activity: 'test' },
      10,
      '45s',
    );

    expect(options.maxConcurrentActivityTaskExecutions).toBe(10);
    expect(options.activities).toEqual({ activity: 'test' });
    expect(options.taskQueue).toBe('concurrent-test-queue7');
    expect(options.shutdownForceTime).toBe('45s');
  });

  it('should handle empty string taskQueue', () => {
    const config = { dynamicTaskQueue: true, taskQueueId: 'empty-test' } as any;
    const options = new WorkFlowOptions(
      'identity8',
      'worker8',
      mockConnection,
      '',
      config,
    );

    expect(options.taskQueue).toBe('empty-test-');
  });

  it('should handle null activities and maxConcurrentActivityTaskExecutions', () => {
    const config = { dynamicTaskQueue: false, taskQueueId: 'null-test' } as any;
    const options = new WorkFlowOptions(
      'identity9',
      'worker9',
      mockConnection,
      'queue9',
      config,
      null,
      null,
    );

    expect(options.activities).toBeNull();
    expect(options.maxConcurrentActivityTaskExecutions).toBeNull();
  });

  it('should handle complex activities object', () => {
    const complexActivities = {
      copyActivity: jest.fn(),
      validateActivity: jest.fn(),
      deleteActivity: jest.fn(),
      metadata: { version: '1.0' },
    };
    const config = {
      dynamicTaskQueue: false,
      taskQueueId: 'complex-test',
    } as any;

    const options = new WorkFlowOptions(
      'identity10',
      'worker10',
      mockConnection,
      'queue10',
      config,
      complexActivities,
      20,
    );

    expect(options.activities).toBe(complexActivities);
    expect(options.activities.metadata.version).toBe('1.0');
    expect(typeof options.activities.copyActivity).toBe('function');
  });

  it('should handle edge case with zero maxConcurrentActivityTaskExecutions', () => {
    const config = {
      dynamicTaskQueue: true,
      taskQueueId: 'zero-concurrent',
    } as any;
    const options = new WorkFlowOptions(
      'identity11',
      'worker11',
      mockConnection,
      'queue11',
      config,
      { test: 'activity' },
      0,
    );

    expect(options.maxConcurrentActivityTaskExecutions).toBe(0);
  });

  it('should handle special characters in identity and workerId', () => {
    const config = {
      dynamicTaskQueue: false,
      taskQueueId: 'special-chars',
    } as any;
    const options = new WorkFlowOptions(
      'identity-with-dashes_and_underscores',
      'worker@123#456',
      mockConnection,
      'queue-with-dashes',
      config,
    );

    expect(options.identity).toBe('identity-with-dashes_and_underscores');
    expect(options.workerId).toBe('worker@123#456');
    expect(options.taskQueue).toBe('queue-with-dashes');
  });

  it('should verify all properties are set correctly in comprehensive test', () => {
    const config = {
      dynamicTaskQueue: true,
      taskQueueId: 'comprehensive',
    } as any;
    const testActivities = { comprehensive: true };
    const options = new WorkFlowOptions(
      'comp-identity',
      'comp-worker',
      mockConnection,
      'comp-queue',
      config,
      testActivities,
      15,
      '90s',
    );

    // Verify all properties are set
    expect(options.identity).toBe('comp-identity');
    expect(options.workerId).toBe('comp-worker');
    expect(options.connection).toBe(mockConnection);
    expect(options.taskQueue).toBe('comprehensive-comp-queue');
    expect(options.activities).toBe(testActivities);
    expect(options.workflowsPath).toContain('workflows');
    expect(options.maxConcurrentActivityTaskExecutions).toBe(15);
    expect(options.shutdownForceTime).toBe('90s');
  });
});
