import { WorkFlowOptions } from './worker-options.factory';
import { NativeConnection } from '@temporalio/worker';

describe('WorkFlowOptions', () => {
  const mockConnection = {} as NativeConnection;
  const mockRequireResolve = jest.spyOn(require, 'resolve').mockReturnValue('/abs/path/to/workflows');

  afterEach(() => {
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
      5
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
      config
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
      config
    );

    expect(options.activities).toBeUndefined();
    expect(options.maxConcurrentActivityTaskExecutions).toBeUndefined();
  });
});