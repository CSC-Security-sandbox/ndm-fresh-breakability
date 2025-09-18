import {
  WorkerConfiguration,
  Platform,
} from 'src/work-manager/work-manager.types';
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

  it('should handle undefined taskQueueId when dynamicTaskQueue is true', () => {
    const config: WorkerConfiguration = {
      workerId: 'worker456',
      configName: 'configB',
      dynamicTaskQueue: true,
      taskQueueId: undefined as any,
    };
    const result = getWorkerIdentity(config);
    expect(result).toBe('worker456/configB-undefined');
  });

  it('should handle special characters in workerId and configName', () => {
    const config: WorkerConfiguration = {
      workerId: 'worker-123',
      configName: 'config_A',
      dynamicTaskQueue: false,
      taskQueueId: 'task123',
    };
    const result = getWorkerIdentity(config);
    expect(result).toBe('worker-123/config_A');
  });
});

describe('getPlatform', () => {
  it('should return LINUX for linux platform', () => {
    const result = getPlatform('linux');
    expect(result).toBe(Platform.LINUX);
  });

  it('should return WINDOWS for win32 platform', () => {
    const result = getPlatform('win32');
    expect(result).toBe(Platform.WINDOWS);
  });

  it('should return MACOS for darwin platform', () => {
    const result = getPlatform('darwin');
    expect(result).toBe(Platform.MACOS);
  });

  it('should return OTHER for aix platform', () => {
    const result = getPlatform('aix');
    expect(result).toBe(Platform.OTHER);
  });

  it('should return OTHER for freebsd platform', () => {
    const result = getPlatform('freebsd');
    expect(result).toBe(Platform.OTHER);
  });

  it('should return OTHER for openbsd platform', () => {
    const result = getPlatform('openbsd');
    expect(result).toBe(Platform.OTHER);
  });

  it('should return OTHER for sunos platform', () => {
    const result = getPlatform('sunos');
    expect(result).toBe(Platform.OTHER);
  });

  it('should return OTHER for android platform', () => {
    const result = getPlatform('android');
    expect(result).toBe(Platform.OTHER);
  });

  it('should return OTHER for unknown platform', () => {
    const result = getPlatform('unknown-platform' as NodeJS.Platform);
    expect(result).toBe(Platform.OTHER);
  });

  it('should return OTHER for undefined platform', () => {
    const result = getPlatform(undefined as any);
    expect(result).toBe(Platform.OTHER);
  });
});
