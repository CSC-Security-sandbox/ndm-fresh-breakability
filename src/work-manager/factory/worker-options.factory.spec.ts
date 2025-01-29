
import { WorkFlowType } from './worker-options.types';
import { WorkerConfiguration } from '../work-manager.types';
import { NativeConnection } from '@temporalio/worker';
import * as activities from '../../activities/activities';
import { WorkerOptionsFactory } from './worker-options.factory';

jest.mock('../../activities/activities');
jest.mock('../../workflows/workflows', () => jest.fn());

describe('WorkerOptionsFactory', () => {
  const mockConnection = {} as NativeConnection; // Mocking NativeConnection
  const mockWorkerId = 'worker123';
  const mockIdentity = 'identity123';

  const baseConfig: WorkerConfiguration = {
    workerId: 'worker123',
    configName: '',
    dynamicTaskQueue: false,
    taskQueueId: 'taskQueue123',
  };

  it('should return a WorkFlowOptions instance for PARENT_WORKFLOW', () => {
    const config = { ...baseConfig, configName: WorkFlowType.PARENT_WORKFLOW };
    const options = WorkerOptionsFactory(mockIdentity, config, mockWorkerId, mockConnection);

    expect(options).toBeDefined();
    expect(options?.identity).toBe(mockIdentity);
    expect(options?.workerId).toBe(mockWorkerId);
    expect(options?.connection).toBe(mockConnection);
    expect(options?.taskQueue).toBe('ParentWorkflow-TaskQueue');
    expect(options?.activities).toBeUndefined();
    expect(options?.workflowsPath).toBeDefined();
  });

  it('should return a WorkFlowOptions instance for WORKER_SPECIFIC_WORKFLOW', () => {
    const config = { ...baseConfig, configName: WorkFlowType.WORKER_SPECIFIC_WORKFLOW, dynamicTaskQueue: true };
    const options = WorkerOptionsFactory(mockIdentity, config, mockWorkerId, mockConnection);

    expect(options).toBeDefined();
    expect(options?.identity).toBe(mockIdentity);
    expect(options?.workerId).toBe(mockWorkerId);
    expect(options?.connection).toBe(mockConnection);
    expect(options?.taskQueue).toBe('taskQueue123-TaskQueue'); // Task queue ID concatenated
    expect(options?.activities).toBe(activities);
    expect(options?.workflowsPath).toBeDefined();
  });

  it('should return undefined for an unknown configName', () => {
    const config = { ...baseConfig, configName: 'UNKNOWN_WORKFLOW' };
    const options = WorkerOptionsFactory(mockIdentity, config, mockWorkerId, mockConnection);

    expect(options).toBeUndefined();
  });
});
