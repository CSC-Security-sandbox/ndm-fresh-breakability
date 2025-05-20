import { JobContext } from './job-context';
import { JobConfig } from './job-config';
import { FileInfo, DMError, TaskStats, Task, Command, ErroredFile, ErrorType } from './metadata-types';
import { FileServerDetails } from './file-server';
import { NFS } from './protocols';
import { GroupReaderType, OPS_CMD, OPS_STATUS, TaskStatus, TaskType } from './enums';
import { error } from 'winston';

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
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength: jest.fn(),
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
        read: jest.fn(),
        groupRead: jest.fn(),
        consumerGroupCount:2,
        readAndPurge: jest.fn(),
        getLength: jest.fn(),
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
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength: jest.fn(),
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
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength:  jest.fn(),
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
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength:  jest.fn(),
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
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength:  jest.fn(),
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
      read: jest.fn(),
      groupRead: jest.fn(),
      consumerGroupCount:2,
      readAndPurge: jest.fn(),
      getLength:  jest.fn(),
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
  });

});
