import { ShellService } from './shell.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { mockLogger } from 'src/auth/auth.service.spec';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

describe('ShellService', () => {
  let service: ShellService;
  let loggerFactory: LoggerFactory;
  let mockProcesses: ChildProcessWithoutNullStreams[] = [];

  const createMockProcess = () => {
    const stdoutHandlers: ((data: Buffer) => void)[] = [];
    const stderrHandlers: ((data: Buffer) => void)[] = [];

    const mockProcess = {
      stdout: {
        on: jest.fn((event, handler) => {
          if (event === 'data') stdoutHandlers.push(handler);
        }),
        off: jest.fn(),
        setMaxListeners: jest.fn(),
      },
      stderr: {
        on: jest.fn((event, handler) => {
          if (event === 'data') stderrHandlers.push(handler);
        }),
        off: jest.fn(),
        setMaxListeners: jest.fn(),
      },
      stdin: {
        write: jest.fn(),
        end: jest.fn(),
      },
      on: jest.fn(),
      kill: jest.fn(),
    } as unknown as ChildProcessWithoutNullStreams;

    (mockProcess as any)._stdoutHandlers = stdoutHandlers;
    (mockProcess as any)._stderrHandlers = stderrHandlers;

    return mockProcess;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockProcesses = [];

    (spawn as jest.Mock).mockImplementation(() => {
      const mockProcess = createMockProcess();
      mockProcesses.push(mockProcess);
      return mockProcess;
    });

    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

    loggerFactory = mockLoggerFactory as unknown as LoggerFactory;
    service = new ShellService(loggerFactory);
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should initialize shell workers on module init', () => {
    expect(mockProcesses).toHaveLength(5);
    expect(spawn).toHaveBeenCalledTimes(5);
  });

  it('should execute command and return output', async () => {
    const promise = service.runCommand('echo Hello');

    const mockProcess = mockProcesses[0];
    const output = 'Hello\nEND_OF_COMMAND_OUTPUT';

    // Simulate stdout emission
    const buffer = Buffer.from(output);
    (mockProcess as any)._stdoutHandlers.forEach((handler) => handler(buffer));

    const result = await promise;
    expect(result).toBe('Hello');
  });

  it('should handle error from stderr', async () => {
    const promise = service.runCommand('bad command');

    const mockProcess = mockProcesses[0];
    const errorOutput = 'command not found';

    // Simulate stderr emission
    const buffer = Buffer.from(errorOutput);
    (mockProcess as any)._stderrHandlers.forEach((handler) => handler(buffer));

    await expect(promise).rejects.toThrow('command not found');
  });

  it('should queue and process tasks when worker becomes idle', async () => {
    const first = service.runCommand('cmd1');
    const second = service.runCommand('cmd2');

    const mockProcess = mockProcesses[0];
    const mockProcess2 = mockProcesses[1];

    // First command output
    (mockProcess as any)._stdoutHandlers.forEach((handler) =>
      handler(Buffer.from('res1\nEND_OF_COMMAND_OUTPUT')),
    );

    const res1 = await first;
    expect(res1).toBe('res1');

    // Second command output
    (mockProcess2 as any)._stdoutHandlers.forEach((handler) =>
      handler(Buffer.from('res2\nEND_OF_COMMAND_OUTPUT')),
    );

    const res2 = await second;
    expect(res2).toBe('res2');
  });

  it('should shut down all workers on destroy', () => {
    service.onModuleDestroy();
    mockProcesses.forEach((proc) => {
      expect(proc.stdin.end).toHaveBeenCalled();
      expect(proc.kill).toHaveBeenCalled();
    });
  });

  it('should throw if runTask called while busy', () => {
    const task = {
      command: 'test',
      resolve: jest.fn(),
      reject: jest.fn(),
    };

    const mockWorker = (service as any).workers[0];
    mockWorker['busy'] = true;

    expect(() => mockWorker.runTask(task)).toThrow('Worker is busy.');
  });
});
