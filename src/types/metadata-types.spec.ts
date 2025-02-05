import { JobType } from './enums';
import { FileInfo, TaskStats, Command, Task, DMError, TaskStatsType, CommandOperation } from './metadata-types';

describe('Metadata Types', () => {
  it('should create and serialize FileInfo', () => {
    const fileInfo = new FileInfo('file', '/path', '/parent', false, 1, 1, 100, true, new Date(), new Date(), new Date(), 'txt', 'rw', 'file', 1);
    const serialized = fileInfo.serialize();
    const deserialized: FileInfo = FileInfo.deserialize(serialized);
    expect(deserialized.fileName).toBe('file');
  });

  it('should create and serialize TaskStats', () => {
    const taskStats = new TaskStats('task1');
    taskStats.increment(TaskStatsType.numFiles, 1);
    const serialized = taskStats.serialize();    
    const deserialized: TaskStats = TaskStats.deserialize(serialized);
    expect(deserialized.taskName).toBe('task1');
  });

  it('should create and serialize Command', () => {
    const commandOp = new CommandOperation();
    const command = new Command('cmd1', { 0: commandOp }, 'cmd-001');
    const serialized = command.serialize();
    const deserialized: Command = Command.deserialize(serialized);
    expect(deserialized.commandId).toBe('cmd-001');
  });

  it('should create and serialize Task', () => {
    const task = new Task('task1', 'jobRunId', 'Scan', 'running', 'worker1', '/source', [ new Command('cmd1', { 0: new CommandOperation() }, 'cmd-001') ]);
    const serialized = task.serialize();
    const deserialized: Task = Task.deserialize(serialized);
    expect(deserialized.id).toBe('task1');
  });

  it('should create and serialize DMError', () => {
    const error = new DMError('file1', { name: 'error1', message: 'error message' });
    const serialized = error.serialize();
    const deserialized: DMError = DMError.deserialize(serialized);
    expect(deserialized.file).toBe('file1');
  });

});
