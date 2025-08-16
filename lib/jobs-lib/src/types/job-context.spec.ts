import { JobContext } from './job-context';
import { JobConfig } from './job-config';
import { FileInfo, DMError, TaskStats, Task, Command, ErroredFile, ErrorType } from './metadata-types';
import { FileServerDetails } from './file-server';
import { NFS } from './protocols';
import { GroupReaderType, OPS_CMD, OPS_STATUS, TaskStatus, TaskType } from './enums';

class TestJobContext extends JobContext {
  constructor(jobRunId: string, jobConfig?: JobConfig, jobRunStatus?: string) {
    super(jobRunId, jobConfig, jobRunStatus);
    this.filesInfo =  {
      jobRunId: 'job1',
      streamKey: 'stream1',
      numMessages: 0,
      lastId: '0-0',
      init: jest.fn(),
      cleanup: jest.fn(),
      close: jest.fn(),
      append: jest.fn(),
      appendBulk: jest.fn(),
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength: jest.fn(),
      groupReadWithoutAck: jest.fn(),
      ackAndPurge: jest.fn(),
    };

    this.dirsInfo =  {
      jobRunId: 'job1',
      streamKey: 'stream1',
      numMessages: 0,
      lastId: '0-0',
      init: jest.fn(),
      cleanup: jest.fn(),
      close: jest.fn(),
      append: jest.fn(),
      appendBulk: jest.fn(),
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength: jest.fn(),
      groupReadWithoutAck: jest.fn(),
      ackAndPurge: jest.fn(),
      ackAndCreateTask: jest.fn(),
    };

    this.errorsInfo =   {
      jobRunId: 'job1',
      streamKey: 'stream1',
      numMessages: 0,
      lastId: '0-0',
      init: jest.fn(),
      cleanup: jest.fn(),
      close: jest.fn(),
      append: jest.fn(),
      appendBulk: jest.fn(),
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength: jest.fn(),
      groupReadWithoutAck: jest.fn(),
      ackAndPurge: jest.fn(),
    };

    this.tasksInfo =  {
      jobRunId: 'job1',
      streamKey: 'stream1',
      numMessages: 0,
      lastId: '0-0',
      init: jest.fn(),
      cleanup: jest.fn(),
      close: jest.fn(),
      append: jest.fn(),
      appendBulk: jest.fn(),
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength:  jest.fn(),
      groupReadWithoutAck: jest.fn(),
      ackAndPurge: jest.fn(),
    };

    this.migrateTask =  {
      jobRunId: 'job1',
      streamKey: 'stream1',
      numMessages: 0,
      lastId: '0-0',
      init: jest.fn(),
      cleanup: jest.fn(),
      close: jest.fn(),
      append: jest.fn(),
      appendBulk: jest.fn(),
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength:  jest.fn(),
      groupReadWithoutAck: jest.fn(),
      ackAndPurge: jest.fn(),
    };

    this.taskStats =  {
      jobRunId: 'job1',
      streamKey: 'stream1',
      numMessages: 0,
      lastId: '0-0',
      init: jest.fn(),
      cleanup: jest.fn(),
      close: jest.fn(),
      append: jest.fn(),
      appendBulk: jest.fn(),
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength:  jest.fn(),
      groupReadWithoutAck: jest.fn(),
      ackAndPurge: jest.fn(),
    };

    this.updatedTaskInfo =  {
      jobRunId: 'job1',
      streamKey: 'stream1',
      numMessages: 0,
      lastId: '0-0',
      init: jest.fn(),
      cleanup: jest.fn(),
      close: jest.fn(),
      append: jest.fn(),
      appendBulk: jest.fn(),
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength:  jest.fn(),
      groupReadWithoutAck: jest.fn(),
      ackAndPurge: jest.fn(),
    };
  }
  async init() {}
  async close() {}
  async cleanup() {}
}

describe('JobContext Class', () => {
  it('should create a JobContext instance', () => {
    const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'user', 'password', 'domain');
    const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
    const jobContext = new TestJobContext('job1', jobConfig, 'running');
    expect(jobContext.getJobRunId()).toBe('job1');
    expect(jobContext.getJobRunStatus()).toBe('running');
  });

  it('should increment stats', () => {
    const jobContext = new TestJobContext('job1');
    jobContext.incrementStats('files', 1);
    expect(jobContext.getStat('files')).toBe(1);
  });
  describe('JobContext Class', () => {
    it('should set and get stats', () => {
      const jobContext = new TestJobContext('job1');
      jobContext.setStat('files', 5);
      expect(jobContext.getStat('files')).toBe(5);
    });

    it('should append to file list', async () => {
      const jobContext = new TestJobContext('job1');
      const fileInfo: FileInfo = new FileInfo(
        'file1',
        '/path/to/file1',
        '/path/to',
        false,
        100,
        true,
        new Date(),
        new Date(),
        new Date(),
        'txt',
        'rwxr-xr-x',
        'txt',
        0,
        0,
        0,
      );
      jest.spyOn(jobContext.filesInfo, 'append').mockResolvedValue('fileId');
      const result = await jobContext.appendToFileList(fileInfo);
      expect(result).toBe('fileId');
    });

    it('should append to dir list', async () => {
      const jobContext = new TestJobContext('job1');
      const dirInfo: FileInfo = new FileInfo(
          'dir1',
          '/path/to/dir1',
          '/path/to',
          false,
          100,
          true,
          new Date(),
          new Date(),
          new Date(),
          'txt',
          'rwxr-xr-x',
          'txt',
          0,
          0,
          0,
        );
  
      jest.spyOn(jobContext.dirsInfo, 'append').mockResolvedValue('dirId');
      const result = await jobContext.appendToDirList(dirInfo);
      expect(result).toBe('dirId');
    });

    it('should append to task stats', async () => {
      const jobContext = new TestJobContext('job1');
      const taskStats = new TaskStats("taskStat1");
      jest.spyOn(jobContext.taskStats, 'append').mockResolvedValue('taskStatsId');
      const result = await jobContext.appendToTaskStats(taskStats);
      expect(result).toBe('taskStatsId');
    });

    it('should append to task list', async () => {
      const jobContext = new TestJobContext('job1');
      const task: Task = new Task(
        'taskId',
        'jobRunId',
        TaskType.SCAN,
        TaskStatus.PENDING,
        'workerId',
        'sPath',
        'sPathId',
        [new Command('fPath', { 1: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } }, 'commandId',0)],
        'tPath',
        'tPathId',
        'excludeFilePatterns',
      )        

      jest.spyOn(jobContext.tasksInfo, 'append').mockResolvedValue('taskId');
      const result = await jobContext.appendToTaskList(task);
      expect(result).toBe('taskId');
    });

    it('should append to error list', async () => {
      const jobContext = new TestJobContext('job1');
      const taskError={
        taskId: 'taskId',
        errorCode: '500',
        errorMessage: 'errorMessage',
        errorType:ErrorType.FATAL_ERROR
      }
      const errorInfo: DMError = new DMError(taskError);
      jest.spyOn(jobContext.errorsInfo, 'append').mockResolvedValue('errorId');
      const result = await jobContext.appendToErrorList(errorInfo);
      expect(result).toBe('errorId');
    });

    it('should serialize job context', () => {
      const jobContext = new TestJobContext('job1');
      const serialized = jobContext.serialize();
      expect(serialized).toBe(JSON.stringify({
        jobRunId: 'job1',
        jobConfig: undefined,
        filesInfo: { numMessages: 0, lastId: '0-0' },
        dirsInfo: { numMessages: 0, lastId: '0-0' },
        errorsInfo: { numMessages: 0, lastId: '0-0' },
        tasksInfo: { numMessages: 0, lastId: '0-0' },
        migrateTask: { numMessages: 0, lastId: '0-0' },
        taskStats: { numMessages: 0, lastId: '0-0' },
        updatedTaskInfo: { numMessages: 0, lastId: '0-0' },
      }));
    });

    it('should deserialize job context', () => {
      const jobContext = new TestJobContext('job1');
      const json = JSON.stringify({
        jobRunId: 'job1',
        jobConfig: undefined,
        filesInfo: { numMessages: 0, lastId: '0-0' },
        dirsInfo: { numMessages: 0, lastId: '0-0' },
        errorsInfo: { numMessages: 0, lastId: '0-0' },
        tasksInfo: { numMessages: 0, lastId: '0-0' },
      });
      const deserialized = jobContext.deserialize(json);
      expect(deserialized).toEqual(JSON.parse(json));
    });

    it('should read files', async () => {
      const jobContext = new TestJobContext('job1');
      const fileInfo: FileInfo = new FileInfo(
        'file1',
        '/path/to/file1',
        '/path/to',
        false,
        100,
        true,
        new Date(),
        new Date(),
        new Date(),
        'txt',
        'rwxr-xr-x',
        'txt',
        0,
        0,
        0,
      );      
      jest.spyOn(jobContext.filesInfo, 'readAndPurge').mockReturnValue((async function* () { yield fileInfo; })());
      const files = [];
      for await (const file of jobContext.readFiles('reader1',10,GroupReaderType.DB_WRITER)) {
        files.push(file);
      }
      expect(files).toEqual([fileInfo]);
    });

    it('should group read files', async () => {
      const jobContext = new TestJobContext('job1');
      const fileInfo: FileInfo = new FileInfo(
        'file1',
        '/path/to/file1',
        '/path/to',
        false,
        100,
        true,
        new Date(),
        new Date(),
        new Date(),
        'txt',
        'rwxr-xr-x',
        'txt',
        0,
        0,
        0,
      );      
      jest.spyOn(jobContext.filesInfo, 'groupRead').mockReturnValue((async function* () { yield fileInfo; })());
      const files = [];
      for await (const file of jobContext.groupReadFiles('reader1',10,  GroupReaderType.DB_WRITER)) {
        files.push(file);
      }
      expect(files).toEqual([fileInfo]);
    });

    it('should read dirs', async () => {
      const jobContext = new TestJobContext('job1');
      const dirInfo: FileInfo = new FileInfo(
        'dir1',
        '/path/to/dir1',
        '/path/to',
        false,
        100,
        true,
        new Date(),
        new Date(),
        new Date(),
        'txt',
        'rwxr-xr-x',
        'txt',
        0,
        0,
        0,
      );      
      jest.spyOn(jobContext.dirsInfo, 'readAndPurge').mockReturnValue((async function* () { yield dirInfo; })());
      const dirs = [];
      for await (const dir of jobContext.readDirs('reader1',10,GroupReaderType.DB_WRITER)) {
        dirs.push(dir);
      }
      expect(dirs).toEqual([dirInfo]);
    });

    it('should group read dirs', async () => {
      const jobContext = new TestJobContext('job1');
      const dirInfo: FileInfo = new FileInfo(
        'dir1',
        '/path/to/dir1',
        '/path/to',
        false,
        100,
        true,
        new Date(),
        new Date(),
        new Date(),
        'txt',
        'rwxr-xr-x',
        'txt',
        0,
        0,
        0,
      );
      jest.spyOn(jobContext.dirsInfo, 'groupRead').mockReturnValue((async function* () { yield dirInfo; })());
      const dirs = [];
      for await (const dir of jobContext.groupReadDirs('reader1',10, GroupReaderType.DB_WRITER)) {
        dirs.push(dir);
      }
      expect(dirs).toEqual([dirInfo]);
    });

    it('should read tasks', async () => {
      const jobContext = new TestJobContext('job1');
      const task: Task = new Task(
        'taskId',
        'jobRunId',
        TaskType.SCAN,
        TaskStatus.PENDING,
        'workerId',
        'sPath',
        'sPathId',
        [new Command('fPath', { 1: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } }, 'commandId',0)],
        'tPath',
        'tPathId',
        'excludeFilePatterns',
      )        
      jest.spyOn(jobContext.tasksInfo, 'readAndPurge').mockReturnValue((async function* () { yield task; })());
      const tasks = [];
      for await (const t of jobContext.readTasks('reader1', 10,GroupReaderType.DB_WRITER)) {
        tasks.push(t);
      }
      expect(tasks).toEqual([task]);
    });

    it('should group read tasks', async () => {
      const jobContext = new TestJobContext('job1');
      const task: Task = new Task(
        'taskId',
        'jobRunId',
        TaskType.SCAN,
        TaskStatus.PENDING,
        'workerId',
        'sPath',
        'sPathId',
        [new Command('fPath', { 1: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } }, 'commandId',0)],
        'tPath',
        'tPathId',
        'excludeFilePatterns',
      )        
      jest.spyOn(jobContext.tasksInfo, 'groupRead').mockReturnValue((async function* () { yield task; })());
      const tasks = [];
      for await (const t of jobContext.groupReadTasks('reader1',10, GroupReaderType.DB_WRITER)) {
        tasks.push(t);
      }
      expect(tasks).toEqual([task]);
    });

    it('should read task stats', async () => {
      const jobContext = new TestJobContext('job1');
      const taskStats = new TaskStats("taskStat1");
      jest.spyOn(jobContext.taskStats, 'readAndPurge').mockReturnValue((async function* () { yield taskStats; })());
      const stats = [];
      for await (const stat of jobContext.readTaskStats('reader1',  10,GroupReaderType.DB_WRITER)) {
        stats.push(stat);
      }
      expect(stats).toEqual([taskStats]);
    });

    it('should group read task stats', async () => {
      const jobContext = new TestJobContext('job1');
      const taskStats = new TaskStats("taskStat1");
      jest.spyOn(jobContext.taskStats, 'groupRead').mockReturnValue((async function* () { yield taskStats; })());
      const stats = [];
      for await (const stat of jobContext.groupReadTaskStats('reader1',10,GroupReaderType.DB_WRITER)) {
        stats.push(stat);
      }
      expect(stats).toEqual([taskStats]);
    });

    it('should read errors', async () => {
      const jobContext = new TestJobContext('job1');
      const taskError={
        taskId: 'taskId',
        errorCode: '500',
        errorMessage: 'errorMessage',
        errorType:ErrorType.FATAL_ERROR
      }
      const errorInfo: DMError = new DMError(taskError);
      jest.spyOn(jobContext.errorsInfo, 'readAndPurge').mockReturnValue((async function* () { yield errorInfo; })());
      const errors = [];
      for await (const error of jobContext.readErrors('reader1',10,GroupReaderType.DB_WRITER)) {
        errors.push(error);
      }
      expect(errors).toEqual([errorInfo]);
    });

    it('should group read errors', async () => {
      const jobContext = new TestJobContext('job1');
      const taskError={
        taskId: 'taskId',
        errorCode: '500',
        errorMessage: 'errorMessage',
        errorType:ErrorType.FATAL_ERROR
      }
      const operationError={
        operationId: 'operationId',
        errorCode: '500',
        errorMessage: 'errorMessage',
        errorFiles:{} as ErroredFile,
        errorType:ErrorType.FATAL_ERROR
      }
      const errorInfo: DMError = new DMError(taskError,operationError);
      jest.spyOn(jobContext.errorsInfo, 'groupRead').mockReturnValue((async function* () { yield errorInfo; })());
      const errors = [];
      for await (const error of jobContext.groupReadErrors('reader1',10,GroupReaderType.DB_WRITER)) {
        errors.push(error);
      }
      expect(errors).toEqual([errorInfo]);
    });
  });

  describe('Stream Length Test' ,()=>{
    it('get File stream length', async () => {
      const jobContext = new TestJobContext('job1');
      jest.spyOn(jobContext.filesInfo, 'getLength').mockResolvedValue(0);
      const result = await jobContext.getFilesLength();
      expect(result).toEqual(0);
    });
    it('get Dir stream length', async () => {
      const jobContext = new TestJobContext('job1');
      jest.spyOn(jobContext.dirsInfo, 'getLength').mockResolvedValue(0);
      const result = await jobContext.getDirsLength();
      expect(result).toEqual(0);
    });
    it('get Error stream length', async () => {
      const jobContext = new TestJobContext('job1');
      jest.spyOn(jobContext.errorsInfo, 'getLength').mockResolvedValue(0);
      const result = await jobContext.getErrorsLength();
      expect(result).toEqual(0);
    });
    it('get Task stream length', async () => {
      const jobContext = new TestJobContext('job1');
      jest.spyOn(jobContext.tasksInfo, 'getLength').mockResolvedValue(0);
      const result = await jobContext.getTasksLength();
      expect(result).toEqual(0);
    });

    it('get TaskStats stream length', async () => {
      const jobContext = new TestJobContext('job1');
      jest.spyOn(jobContext.taskStats, 'getLength').mockResolvedValue(0);
      const result = await jobContext.getTaskStatsLength();
      expect(result).toEqual(0);
    });

    it('get Migration stream length', async () => {
      const jobContext = new TestJobContext('job1');
      jest.spyOn(jobContext.migrateTask, 'getLength').mockResolvedValue(0);
      const result = await jobContext.getMigrationTaskLength();
      expect(result).toEqual(0);
    });

    it('get Update Task stream length', async () => {
      const jobContext = new TestJobContext('job1');
      jest.spyOn(jobContext.updatedTaskInfo, 'getLength').mockResolvedValue(0);
      const result = await jobContext.getUpdatedTaskLength();
      expect(result).toEqual(0);
    });

    it('get RunningSyncTask stream length', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningSyncTask = {
        getSize: jest.fn().mockResolvedValue(2),
        getValue: jest.fn(),
        setValue: jest.fn(),
        deleteValue: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const result = await jobContext.getRunningSyncTaskLength();
      expect(result).toEqual(2);
    });

    it('get RunningScanTask stream length', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningScanTask = {
        getSize: jest.fn().mockResolvedValue(3),
        getValue: jest.fn(),
        setValue: jest.fn(),
        deleteValue: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const result = await jobContext.getRunningScanTaskLength();
      expect(result).toEqual(3);
    });

    it('is RunningSyncTask empty', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningSyncTask = {
        isEmpty: jest.fn().mockResolvedValue(true),
        getSize: jest.fn(),
        getValue: jest.fn(),
        setValue: jest.fn(),
        deleteValue: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
      } as any;
      const result = await jobContext.isRunningSyncTaskEmpty();
      expect(result).toBe(true);
    });

    it('is RunningScanTask empty', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningScanTask = {
        isEmpty: jest.fn().mockResolvedValue(false),
        getSize: jest.fn(),
        getValue: jest.fn(),
        setValue: jest.fn(),
        deleteValue: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
      } as any;
      const result = await jobContext.isRunningScanTaskEmpty();
      expect(result).toBe(false);
    });

    it('getSyncTask should call runningSyncTask.getValue', async () => {
      const jobContext = new TestJobContext('job1');
      const mockTask = { id: 'syncTask' } as any;
      jobContext.runningSyncTask = {
        getValue: jest.fn().mockResolvedValue(mockTask),
        getSize: jest.fn(),
        setValue: jest.fn(),
        deleteValue: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const result = await jobContext.getSyncTask('key1');
      expect(jobContext.runningSyncTask.getValue).toHaveBeenCalledWith('key1');
      expect(result).toBe(mockTask);
    });

    it('getScanTask should call runningScanTask.getValue', async () => {
      const jobContext = new TestJobContext('job1');
      const mockTask = { id: 'scanTask' } as any;
      jobContext.runningScanTask = {
        getValue: jest.fn().mockResolvedValue(mockTask),
        getSize: jest.fn(),
        setValue: jest.fn(),
        deleteValue: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const result = await jobContext.getScanTask('key2');
      expect(jobContext.runningScanTask.getValue).toHaveBeenCalledWith('key2');
      expect(result).toBe(mockTask);
    });

    it('setSyncTask should call runningSyncTask.setValue', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningSyncTask = {
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        deleteValue: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const task = { id: 'syncTask' } as any;
      await jobContext.setSyncTask('key3', task);
      expect(jobContext.runningSyncTask.setValue).toHaveBeenCalledWith('key3', task);
    });

    it('setScanTask should call runningScanTask.setValue', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningScanTask = {
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        deleteValue: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const task = { id: 'scanTask' } as any;
      await jobContext.setScanTask('key4', task);
      expect(jobContext.runningScanTask.setValue).toHaveBeenCalledWith('key4', task);
    });

    it('deleteSyncTask should call runningSyncTask.deleteValue', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningSyncTask = {
        deleteValue: jest.fn(),
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      await jobContext.deleteSyncTask('key5');
      expect(jobContext.runningSyncTask.deleteValue).toHaveBeenCalledWith('key5');
    });

    it('deleteScanTask should call runningScanTask.deleteValue', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningScanTask = {
        deleteValue: jest.fn(),
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        assignToSelf: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      await jobContext.deleteScanTask('key6');
      expect(jobContext.runningScanTask.deleteValue).toHaveBeenCalledWith('key6');
    });

    it('assignScanTaskToSelf should call runningScanTask.assignToSelf', async () => {
      const jobContext = new TestJobContext('job1');
      const mockTask = { id: 'scanTask' } as any;
      jobContext.runningScanTask = {
        assignToSelf: jest.fn().mockResolvedValue(mockTask),
        deleteValue: jest.fn(),
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const result = await jobContext.assignScanTaskToSelf('key7');
      expect(jobContext.runningScanTask.assignToSelf).toHaveBeenCalledWith('key7');
      expect(result).toBe(mockTask);
    });

    it('assignSyncTaskToSelf should call runningSyncTask.assignToSelf', async () => {
      const jobContext = new TestJobContext('job1');
      const mockTask = { id: 'syncTask' } as any;
      jobContext.runningSyncTask = {
        assignToSelf: jest.fn().mockResolvedValue(mockTask),
        deleteValue: jest.fn(),
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        getAll: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const result = await jobContext.assignSyncTaskToSelf('key8');
      expect(jobContext.runningSyncTask.assignToSelf).toHaveBeenCalledWith('key8');
      expect(result).toBe(mockTask);
    });

    it('getAllRunningScanTasks should call runningScanTask.getAll', async () => {
      const jobContext = new TestJobContext('job1');
      const mockTasks = [{ id: 'scanTask1' }, { id: 'scanTask2' }] as any;
      jobContext.runningScanTask = {
        getAll: jest.fn().mockResolvedValue(mockTasks),
        assignToSelf: jest.fn(),
        deleteValue: jest.fn(),
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const result = await jobContext.getAllRunningScanTasks();
      expect(jobContext.runningScanTask.getAll).toHaveBeenCalled();
      expect(result).toBe(mockTasks);
    });

    it('getAllRunningSyncTasks should call runningSyncTask.getAll', async () => {
      const jobContext = new TestJobContext('job1');
      const mockTasks = [{ id: 'syncTask1' }, { id: 'syncTask2' }] as any;
      jobContext.runningSyncTask = {
        getAll: jest.fn().mockResolvedValue(mockTasks),
        assignToSelf: jest.fn(),
        deleteValue: jest.fn(),
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        deleteAll: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      const result = await jobContext.getAllRunningSyncTasks();
      expect(jobContext.runningSyncTask.getAll).toHaveBeenCalled();
      expect(result).toBe(mockTasks);
    });

    it('deleteAllScanTasks should call runningScanTask.deleteAll', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningScanTask = {
        deleteAll: jest.fn(),
        getAll: jest.fn(),
        assignToSelf: jest.fn(),
        deleteValue: jest.fn(),
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      await jobContext.deleteAllScanTasks();
      expect(jobContext.runningScanTask.deleteAll).toHaveBeenCalled();
    });

    it('deleteAllSyncTasks should call runningSyncTask.deleteAll', async () => {
      const jobContext = new TestJobContext('job1');
      jobContext.runningSyncTask = {
        deleteAll: jest.fn(),
        getAll: jest.fn(),
        assignToSelf: jest.fn(),
        deleteValue: jest.fn(),
        setValue: jest.fn(),
        getValue: jest.fn(),
        getSize: jest.fn(),
        isEmpty: jest.fn(),
      } as any;
      await jobContext.deleteAllSyncTasks();
      expect(jobContext.runningSyncTask.deleteAll).toHaveBeenCalled();
    });

    it('ackDirAndCreateTask should call dirsInfo.ackAndCreateTask', async () => {
      const jobContext = new TestJobContext('job1');
      const mockReturn = { success: true };
      const groupType = GroupReaderType.DB_WRITER;
      const ids = ['id1', 'id2'];
      const tasks = [{ id: 'task1' }, { id: 'task2' }] as any;
      jobContext.dirsInfo.ackAndCreateTask = jest.fn().mockResolvedValue(mockReturn);
      const result = await jobContext.ackDirAndCreateTask(groupType, ids, tasks);
      expect(jobContext.dirsInfo.ackAndCreateTask).toHaveBeenCalledWith(groupType, ids, tasks);
      expect(result).toBe(mockReturn);
    });

    it('groupReadWithoutAckDirs should yield values from dirsInfo.groupReadWithoutAck', async () => {
      const jobContext = new TestJobContext('job1');
      const mockData = { data: { id: 'file1' }, id: 'id1' };
      jobContext.dirsInfo.groupReadWithoutAck = jest.fn().mockReturnValue((async function* () { yield mockData; })());
      const results = [];
      for await (const item of jobContext.groupReadWithoutAckDirs('reader1', 10, GroupReaderType.DB_WRITER)) {
      results.push(item);
      }
      expect(results).toEqual([mockData]);
    });

    it('appendToMigrationTask should call migrateTask.append', async () => {
      const jobContext = new TestJobContext('job1');
      const task = { id: 'migrationTask' } as any;
      jobContext.migrateTask.append = jest.fn().mockResolvedValue('migrationTaskId');
      const result = await jobContext.appendToMigrationTask(task);
      expect(jobContext.migrateTask.append).toHaveBeenCalledWith(task);
      expect(result).toBe('migrationTaskId');
    });

    it('appendToUpdatedTaskList should call updatedTaskInfo.append', async () => {
      const jobContext = new TestJobContext('job1');
      const task = { id: 'updatedTask' } as any;
      jobContext.updatedTaskInfo.append = jest.fn().mockResolvedValue('updatedTaskId');
      const result = await jobContext.appendToUpdatedTaskList(task);
      expect(jobContext.updatedTaskInfo.append).toHaveBeenCalledWith(task);
      expect(result).toBe('updatedTaskId');
    });

    it('readMigrationTask should yield values from migrateTask.readAndPurge', async () => {
      const jobContext = new TestJobContext('job1');
      const task = { id: 'migrationTask' } as any;
      jobContext.migrateTask.readAndPurge = jest.fn().mockReturnValue((async function* () { yield task; })());
      const results = [];
      for await (const t of jobContext.readMigrationTask('reader1', 10, GroupReaderType.DB_WRITER)) {
      results.push(t);
      }
      expect(results).toEqual([task]);
    });

    it('groupReadMigrationTask should yield values from migrateTask.groupRead', async () => {
      const jobContext = new TestJobContext('job1');
      const task = { id: 'migrationTask' } as any;
      jobContext.migrateTask.groupRead = jest.fn().mockReturnValue((async function* () { yield task; })());
      const results = [];
      for await (const t of jobContext.groupReadMigrationTask('reader1', 10, GroupReaderType.DB_WRITER)) {
      results.push(t);
      }
      expect(results).toEqual([task]);
    });

    it('readUpdatedTaskInfo should yield values from updatedTaskInfo.readAndPurge', async () => {
      const jobContext = new TestJobContext('job1');
      const task = { id: 'updatedTask' } as any;
      jobContext.updatedTaskInfo.readAndPurge = jest.fn().mockReturnValue((async function* () { yield task; })());
      const results = [];
      for await (const t of jobContext.readUpdatedTaskInfo('reader1', 10, GroupReaderType.DB_WRITER)) {
      results.push(t);
      }
      expect(results).toEqual([task]);
    });

    it('groupReadUpdatedTaskInfo should yield values from updatedTaskInfo.groupRead', async () => {
      const jobContext = new TestJobContext('job1');
      const task = { id: 'updatedTask' } as any;
      jobContext.updatedTaskInfo.groupRead = jest.fn().mockReturnValue((async function* () { yield task; })());
      const results = [];
      for await (const t of jobContext.groupReadUpdatedTaskInfo('reader1', 10, GroupReaderType.DB_WRITER)) {
      results.push(t);
      }
      expect(results).toEqual([task]);
    });

    it('getJobState and setJobState should work correctly', () => {
      const jobContext = new TestJobContext('job1');
      const jobState = { state: 'RUNNING' } as any;
      jobContext.setJobState(jobState);
      expect(jobContext.getJobState()).toBe(jobState);
    });

    it('getJobConfig should return jobConfig', () => {
      const jobConfig = { id: 'jobConfig1' } as any;
      const jobContext = new TestJobContext('job1', jobConfig, 'running');
      expect(jobContext.getJobConfig()).toBe(jobConfig);
    });
  });

});
