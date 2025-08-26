

import { WorkerConfiguration, Platform } from 'src/work-manager/work-manager.types';
import { getWorkerIdentity, getPlatform } from './worker-manager.mappers';

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

  it('should handle null taskQueueId when dynamicTaskQueue is true', () => {
    const config: WorkerConfiguration = {
      workerId: 'worker456',
      configName: 'configB',
      dynamicTaskQueue: true,
      taskQueueId: null as any,
    };
    const result = getWorkerIdentity(config);
    expect(result).toBe('worker456/configB-null');
  });

  it('should handle undefined taskQueueId when dynamicTaskQueue is true', () => {
    const config: WorkerConfiguration = {
      workerId: 'worker789',
      configName: 'configC',
      dynamicTaskQueue: true,
      taskQueueId: undefined as any,
    };
    const result = getWorkerIdentity(config);
    expect(result).toBe('worker789/configC-undefined');
  });
});

describe('getPlatform', () => {
  it('should return Platform.LINUX for linux platform', () => {
    const result = getPlatform('linux');
    expect(result).toBe(Platform.LINUX);
  });

  it('should return Platform.WINDOWS for win32 platform', () => {
    const result = getPlatform('win32');
    expect(result).toBe(Platform.WINDOWS);
  });

  it('should return Platform.MACOS for darwin platform', () => {
    const result = getPlatform('darwin');
    expect(result).toBe(Platform.MACOS);
  });

  it('should return Platform.OTHER for unknown platform', () => {
    const result = getPlatform('freebsd' as NodeJS.Platform);
    expect(result).toBe(Platform.OTHER);
  });

  it('should return Platform.OTHER for any unrecognized platform', () => {
    const result = getPlatform('unknown-platform' as NodeJS.Platform);
    expect(result).toBe(Platform.OTHER);
  });

  it('should return Platform.OTHER for empty string platform', () => {
    const result = getPlatform('' as NodeJS.Platform);
    expect(result).toBe(Platform.OTHER);
  });

  it('should return Platform.OTHER for sunos platform', () => {
    const result = getPlatform('sunos');
    expect(result).toBe(Platform.OTHER);
  });

  it('should return Platform.OTHER for aix platform', () => {
    const result = getPlatform('aix');
    expect(result).toBe(Platform.OTHER);
  });

  it('should return Platform.OTHER for openbsd platform', () => {
    const result = getPlatform('openbsd');
    expect(result).toBe(Platform.OTHER);
  });

  it('should return Platform.OTHER for android platform', () => {
    const result = getPlatform('android');
    expect(result).toBe(Platform.OTHER);
  });
});
