

import { WorkerConfiguration } from 'src/work-manager/work-manager.types';
import { getWorkerIdentity } from './worker-manager.mappers';

describe('getWorkerIdentity', () => {
  it('should return the correct identity when dynamicTaskQueue is false', () => {
    const config: WorkerConfiguration = {
      workerId: 'worker123',
      configName: 'configA',
      dynamicTaskQueue: false,
      taskQueueId: 'task123',
    };
    const result = getWorkerIdentity(config);
    expect(result).toBe('worker123/configA');
  });

  it('should return the correct identity when dynamicTaskQueue is true', () => {
    const config: WorkerConfiguration = {
      workerId: 'worker123',
      configName: 'configA',
      dynamicTaskQueue: true,
      taskQueueId: 'task123',
    };
    const result = getWorkerIdentity(config);
    expect(result).toBe('worker123/configA-task123');
  });

  it('should handle an empty taskQueueId gracefully when dynamicTaskQueue is true', () => {
    const config: WorkerConfiguration = {
      workerId: 'worker123',
      configName: 'configA',
      dynamicTaskQueue: true,
      taskQueueId: '',
    };
    const result = getWorkerIdentity(config);
    expect(result).toBe('worker123/configA-');
  });
});
