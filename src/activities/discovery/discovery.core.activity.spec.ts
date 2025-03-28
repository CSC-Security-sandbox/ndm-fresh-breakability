import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryScanActivity } from './discovery.core.activity';
import { Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { CommonActivityService } from '../common/common.service';
import * as fs from 'fs';
import { CommandStatus, JobContext, OPS_CMD, OPS_STATUS, Task, TaskStatus, TaskType } from '@netapp-cloud-datamigrate/jobs-lib';
import { ScanDirCommandInput, ScanDirCommandOutput } from './discovery.type';
import * as utils from '../utils/utils';

describe('DiscoveryScanActivity', () => {
    let service: DiscoveryScanActivity;
    let redisService: RedisService;
    let configService: ConfigService;
    let commonService: CommonActivityService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DiscoveryScanActivity,
                Logger,
                {
                    provide: RedisService,
                    useValue: {
                        getJobContext: jest.fn(),
                        setJobContext: jest.fn()
                    }
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key) => {
                            const config = {
                                'worker.maxRetryCount': 3,
                                'worker.workerId': 'test-worker',
                                'worker.maxConcurrency': 250
                            };
                            return config[key];
                        })
                    }
                },
                {
                    provide: CommonActivityService,
                    useValue: {
                        fetchOneTask: jest.fn()
                    }
                }
            ]
        }).compile();

        service = module.get<DiscoveryScanActivity>(DiscoveryScanActivity);
        redisService = module.get<RedisService>(RedisService);
        configService = module.get<ConfigService>(ConfigService);
        commonService = module.get<CommonActivityService>(CommonActivityService);
    });

    describe('getDirectoryContents', () => {
        it('should return empty array if directory does not exist', async () => {
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            const result = await service.getDirectoryContents('/non-existent');
            expect(result).toEqual([]);
        });

        it('should return empty array if directory is not a directory', async () => {
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs.promises, 'readdir').mockResolvedValue([] as any);
            const result = await service.getDirectoryContents('/non-directory');
            expect(result).toEqual([]);
        });

        it('should return directory contents', async () => {
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['file1', 'file2'] as any);
            const result = await service.getDirectoryContents('/directory');
            expect(result).toEqual(['file1', 'file2']);
        });
    });

    describe('scanActivity', () => {
        it('should return noTaskFound as true if no task is found', async () => {
            commonService.fetchOneTask = jest.fn().mockResolvedValue(null);
            redisService.getJobContext = jest.fn().mockResolvedValue({});

            const result = await service.scanActivity({ jobRunId: '1234' });
            expect(result.noTaskFound).toBe(true);
        });

        // task has commands and should return scanActivityOutput
        it('should return scanActivityOutput if task is found', async () => {
            const mockTask: any = {
                id: 'task-id',
                commands: [{ fPath: 'file1', ops: { 0: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } }, commandId: 'command-id', retryCount: 0, status: CommandStatus.READY }],
                taskType: TaskType.SCAN,
                status: TaskStatus.PENDING,
                jobRunId: '1234',
                workerId: 'test-worker',
            }
            const mockJobContext: JobContext = {
                jobRunId: '1234',
                jobConfig: {},
                appendToUpdatedTaskList: jest.fn(),
                appendToTaskList: jest.fn(),
                appendToFileList: jest.fn(),
                appendToDirList: jest.fn(),
                appendToErrorList: jest.fn(),
                appendToMigrationTask: jest.fn(),
                appendToTaskStats: jest.fn(),
                appendToTaskStatsList: jest.fn(),
                jobState: {
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                },
                jobRunStatus: 'RUNNING',
                updatedTaskInfo: {
                    lastId: 'task-id'
                },
                getJobState: jest.fn().mockResolvedValue({}),
                setJobState: jest.fn(),
                getJobConfig: jest.fn(),
                setJobConfig: jest.fn(),
                getJobRunStatus: jest.fn(),
                setJobRunStatus: jest.fn(),
                errorsInfo: [],
                filesInfo: [],
                dirsInfo: [],
                taskStats: {},
            } as unknown as JobContext
            jest.spyOn(redisService, 'getJobContext').mockResolvedValue(mockJobContext);
            jest.spyOn(redisService, 'setJobContext').mockResolvedValue({} as any);
            jest.spyOn(commonService, 'fetchOneTask').mockResolvedValue(mockTask);
            jest.spyOn(service, 'discover').mockResolvedValue({
                errors: new Set(),
                success: 1,
                error: 0,
                retryCount: 1,
                isFatal: false,
                files: 1,
                folders: 1
            });
            const scanResult = await service.scanActivity({ jobRunId: '1234' });
            expect(scanResult.noTaskFound).toBe(false);
            expect(scanResult.taskId).toBe(mockTask.id);
            expect(scanResult.files).toBe(1);
            expect(scanResult.folders).toBe(1);
        });

        it('should return scanActivityOutput with isFatalErrored as true if discover method returns fatal error', async () => {
            const mockTask: any = {
                id: 'task-id',
                commands: [{ fPath: 'file1', ops: { 0: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } }, commandId: 'command-id', retryCount: 0, status: CommandStatus.READY }],
                taskType: TaskType.SCAN,
                status: TaskStatus.PENDING,
                jobRunId: '1234',
                workerId: 'test-worker',
            }
            const mockJobContext: JobContext = {
                jobRunId: '1234',
                jobConfig: {},
                appendToUpdatedTaskList: jest.fn(),
                appendToTaskList: jest.fn(),
                appendToFileList: jest.fn(),
                appendToDirList: jest.fn(),
                appendToErrorList: jest.fn(),
                appendToMigrationTask: jest.fn(),
                appendToTaskStats: jest.fn(),
                appendToTaskStatsList: jest.fn(),
                jobState: {
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                },
                jobRunStatus: 'RUNNING',
                updatedTaskInfo: {
                    lastId: 'task-id'
                },
                getJobState: jest.fn().mockResolvedValue({}),
                setJobState: jest.fn(),
                getJobConfig: jest.fn(),
                setJobRunStatus: jest.fn(),
                setJobConfig: jest.fn(),
                getJobRunStatus: jest.fn(),
                errorsInfo: [],
                filesInfo: [],
                dirsInfo: [],
                taskStats: {},
            } as unknown as JobContext
            jest.spyOn(redisService, 'getJobContext').mockResolvedValue(mockJobContext);
            jest.spyOn(redisService, 'setJobContext').mockResolvedValue({} as any);
            jest.spyOn(commonService, 'fetchOneTask').mockResolvedValue(mockTask);
            jest.spyOn(service, 'discover').mockResolvedValue({
                errors: new Set(['fatal error']),
                success: 0,
                error: 1,
                retryCount: 1,
                isFatal: true,
                files: 0,
                folders: 0
            });
            const scanResult = await service.scanActivity({ jobRunId: '1234' });
            expect(scanResult.noTaskFound).toBe(false);
            expect(scanResult.taskId).toBe(mockTask.id);
            expect(scanResult.files).toBe(0);
            expect(scanResult.folders).toBe(0);
            expect(scanResult.isFatalErrored).toBe(true);
        });

        it('should return scanActivityOutput with isFatalErrored as false if discover method returns non-fatal error', async () => {
            const mockTask: any = {
                id: 'task-id',
                commands: [{ fPath: 'file1', ops: { 0: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } }, commandId: 'command-id', retryCount: 0, status: CommandStatus.READY }],
                taskType: TaskType.SCAN,
                status: TaskStatus.PENDING,
                jobRunId: '1234',
                workerId: 'test-worker',
            }
            const mockJobContext: JobContext = {
                jobRunId: '1234',
                jobConfig: {},
                appendToUpdatedTaskList: jest.fn(),
                appendToTaskList: jest.fn(),
                appendToFileList: jest.fn(),
                appendToDirList: jest.fn(),
                appendToErrorList: jest.fn(),
                appendToMigrationTask: jest.fn(),
                appendToTaskStats: jest.fn(),
                appendToTaskStatsList: jest.fn(),
                jobState: {
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                },
                jobRunStatus: 'RUNNING',
                updatedTaskInfo: {
                    lastId: 'task-id'
                },
                getJobState: jest.fn().mockResolvedValue({}),
                setJobState: jest.fn(),
                getJobConfig: jest.fn(),
                setJobRunStatus: jest.fn(),
                setJobConfig: jest.fn(),
                getJobRunStatus: jest.fn(),
                errorsInfo: [],
                filesInfo: [],
                dirsInfo: [],
                taskStats: {},
            } as unknown as JobContext
            jest.spyOn(redisService, 'getJobContext').mockResolvedValue(mockJobContext);
            jest.spyOn(redisService, 'setJobContext').mockResolvedValue({} as any);
            jest.spyOn(commonService, 'fetchOneTask').mockResolvedValue(mockTask);
            jest.spyOn(service, 'discover').mockResolvedValue({
                errors: new Set(['non-fatal error']),
                success: 0,
                error: 1,
                retryCount: 1,
                isFatal: false,
                files: 0,
                folders: 0
            });
            const scanResult = await service.scanActivity({ jobRunId: '1234' });
            expect(scanResult.noTaskFound).toBe(false);
            expect(scanResult.taskId).toBe(mockTask.id);
            expect(scanResult.files).toBe(0);
            expect(scanResult.folders).toBe(0);
        });

        it('should return scanActivityOutput with noTaskFound as true if task is not found', async () => {
            const mockJobContext: JobContext = {
                jobRunId: '1234',
                jobConfig: {},
                appendToUpdatedTaskList: jest.fn(),
                appendToTaskList: jest.fn(),
                appendToFileList: jest.fn(),
                appendToDirList: jest.fn(),
                appendToErrorList: jest.fn(),
                appendToMigrationTask: jest.fn(),
                appendToTaskStats: jest.fn(),
                appendToTaskStatsList: jest.fn(),
                jobState: {
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                },
                jobRunStatus: 'RUNNING',
                updatedTaskInfo: {
                    lastId: 'task-id'
                },
                getJobState: jest.fn().mockResolvedValue({}),
                setJobState: jest.fn(),
                getJobConfig: jest.fn(),
                setJobRunStatus: jest.fn(),
                setJobConfig: jest.fn(),
                getJobRunStatus: jest.fn(),
                errorsInfo: [],
                filesInfo: [],
                dirsInfo: [],
                taskStats: {},
            } as unknown as JobContext
            jest.spyOn(redisService, 'getJobContext').mockResolvedValue(mockJobContext);
            jest.spyOn(redisService, 'setJobContext').mockResolvedValue({} as any);
            commonService.fetchOneTask = jest.fn().mockResolvedValue(null);
            const scanResult = await service.scanActivity({ jobRunId: '1234' });
            expect(scanResult.noTaskFound).toBe(true);
            expect(scanResult.taskId).toBeUndefined();
            expect(scanResult.files).toBe(0);
            expect(scanResult.folders).toBe(0);
            expect(scanResult.isFatalErrored).toBe(false);
        });
    });

    describe('discover', () => {
        it('should return discovery output', async () => {
            const mockTask: any = {
                id: 'task-id',
                commands: [{ fPath: 'file1', ops: { 0: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } }, commandId: 'command-id', retryCount: 0, status: CommandStatus.READY }],
                taskType: TaskType.SCAN,
                status: TaskStatus.PENDING,
                jobRunId: '1234',
                workerId: 'test-worker',
            }
            const mockJobContext: JobContext = {
                jobRunId: '1234',
                jobConfig: {
                    options: {
                        excludeFilePattern: '',
                        skipsFilesModifiedInLast: '',
                    },
                    sourceFileServer: {
                        pathId: 'path-id',
                    }
                },
                appendToUpdatedTaskList: jest.fn(),
                appendToTaskList: jest.fn(),
                appendToFileList: jest.fn(),
                appendToDirList: jest.fn(),
                appendToErrorList: jest.fn(),
                appendToMigrationTask: jest.fn(),
                appendToTaskStats: jest.fn(),
                appendToTaskStatsList: jest.fn(),
                jobState: {
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                },
                jobRunStatus: 'RUNNING',
                updatedTaskInfo: {
                    lastId: 'task-id'
                },
                getJobState: jest.fn().mockResolvedValue({}),
                setJobState: jest.fn(),
                getJobConfig: jest.fn(),
                setJobRunStatus: jest.fn(),
                setJobConfig: jest.fn(),
                getJobRunStatus: jest.fn(),
                errorsInfo: [],
                filesInfo: [],
                dirsInfo: [],
                taskStats: {},
            } as unknown as JobContext

            jest.spyOn(service, 'scanDirCommand').mockResolvedValue({
                files: 1,
                directory: 1,
                isFatal: false,
                error: undefined
            } as ScanDirCommandOutput);
            jest.spyOn(utils, 'isFatalError').mockReturnValue(false);
            jest.spyOn(redisService, 'setJobContext').mockResolvedValue({} as any);
            jest.spyOn(redisService, 'getJobContext').mockResolvedValue(mockJobContext);


            const result = await service.discover({ task: mockTask, jobContext: mockJobContext });
            expect(result).toEqual({
                errors: new Set(),
                success: 1,
                error: 0,
                retryCount: 0,
                isFatal: false,
                files: 1,
                folders: 1
            });
        });

        it('should return discovery output with errors', async () => {
            const mockTask: any = {
                id: 'task-id',
                commands: [{ fPath: 'file1', ops: { 0: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } }, commandId: 'command-id', retryCount: 0, status: CommandStatus.READY }],
                taskType: TaskType.SCAN,
                status: TaskStatus.PENDING,
                jobRunId: '1234',
                workerId: 'test-worker',
            }
            const mockJobContext: JobContext = {
                jobRunId: '1234',
                jobConfig: {
                    options: {
                        excludeFilePattern: '',
                        skipsFilesModifiedInLast: '',
                    },
                    sourceFileServer: {
                        pathId: 'path-id',
                    }
                },
                appendToUpdatedTaskList: jest.fn(),
                appendToTaskList: jest.fn(),
                appendToFileList: jest.fn(),
                appendToDirList: jest.fn(),
                appendToErrorList: jest.fn(),
                appendToMigrationTask: jest.fn(),
                appendToTaskStats: jest.fn(),
                appendToTaskStatsList: jest.fn(),
                jobState: {
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                },
                jobRunStatus: 'RUNNING',
                updatedTaskInfo: {
                    lastId: 'task-id'
                },
                getJobState: jest.fn().mockResolvedValue({}),
                setJobState: jest.fn(),
                getJobConfig: jest.fn(),
                setJobRunStatus: jest.fn(),
                setJobConfig: jest.fn(),
                getJobRunStatus: jest.fn(),
                errorsInfo: [],
                filesInfo: [],
                dirsInfo: [],
                taskStats: {},
            } as unknown as JobContext
            jest.spyOn(service, 'scanDirCommand').mockResolvedValue({
                files: 1,
                directory: 1,
                isFatal: true,
                error: 'Test error',
            } as ScanDirCommandOutput);
            jest.spyOn(utils, 'isFatalError').mockReturnValue(true);
            jest.spyOn(redisService, 'setJobContext').mockResolvedValue({} as any);
            jest.spyOn(redisService, 'getJobContext').mockResolvedValue(mockJobContext);
            const result = await service.discover({ task: mockTask, jobContext: mockJobContext });
            expect(result.success).toBe(0);
            expect(result.error).toBe(1);
            expect(result.files).toBe(1);
            expect(result.folders).toBe(1);
            expect(result.isFatal).toBe(true);
        });
    });

    describe('scanDirCommand', () => {
        it('should return scanDirCommand output', async () => {
            const mockedJobContext: any = {
                jobRunId: '1234',
                jobConfig: {
                    options: {
                        excludeFilePattern: '',
                        skipsFilesModifiedInLast: '',
                    },
                    sourceFileServer: {
                        pathId: 'path-id',
                    }
                },
                appendToUpdatedTaskList: jest.fn(),
                appendToTaskList: jest.fn(),
                appendToFileList: jest.fn(),
                appendToDirList: jest.fn(),
                appendToErrorList: jest.fn(),
                appendToMigrationTask: jest.fn(),
                appendToTaskStats: jest.fn(),
                appendToTaskStatsList: jest.fn(),
                jobState: {
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                },
                jobRunStatus: 'RUNNING',
                updatedTaskInfo: {
                    lastId: 'task-id'
                },
                getJobState: jest.fn().mockResolvedValue({}),
                setJobState: jest.fn(),
                getJobConfig: jest.fn(),
                setJobRunStatus: jest.fn(),
                setJobConfig: jest.fn(),
                getJobRunStatus: jest.fn(),
                errorsInfo: [],
                filesInfo: [],
                dirsInfo: [],
                taskStats: {},
            }
            const mockedInput = {
                excludePatterns: [],
                sourcePath: '/source/path',
                sourcePrefix: 'mnt',
                jobContext: mockedJobContext,
                command: {
                    fPath: 'file1',
                    ops: { 0: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } },
                    commandId: 'command-id',
                    retryCount: 0,
                    status: CommandStatus.READY
                } as any,
                skipFile: '',
            }
            jest.spyOn(service, 'getDirectoryContents').mockResolvedValue(['file1', 'file2']);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs.promises, 'lstat').mockResolvedValue({
                isDirectory: jest.fn().mockReturnValue(true),
                isFile: jest.fn().mockReturnValue(false),
                isSymbolicLink: jest.fn().mockReturnValue(false),
            } as any);
            jest.spyOn(utils, 'removePrefix').mockReturnValue('/source/path');
            jest.spyOn(utils, 'getFileInfo').mockReturnValue({
                fileName: 'file1',
                filePath: '/source/path/file1',
                fileSize: 100,
                isDir: false,
                isFile: true,
                isLink: false,
            } as any);

            const result = await service.scanDirCommand(mockedInput);

            expect(result.directory).toBe(2);
            expect(result.files).toBe(0);
            expect(result.isFatal).toBe(false);
            expect(result.error).toBe(undefined);
        });

        // should catch error and appendToErrorList should be called
        it('should handle error and return scanDirCommand output', async () => {
            const mockedJobContext: any = {
                jobRunId: '1234',
                jobConfig: {
                    options: {
                        excludeFilePattern: '',
                        skipsFilesModifiedInLast: '',
                    },
                    sourceFileServer: {
                        pathId: 'path-id',
                    }
                },
                appendToUpdatedTaskList: jest.fn(),
                appendToTaskList: jest.fn(),
                appendToFileList: jest.fn(),
                appendToDirList: jest.fn(),
                appendToErrorList: jest.fn(),
                appendToMigrationTask: jest.fn(),
                appendToTaskStats: jest.fn(),
                appendToTaskStatsList: jest.fn(),
                jobState: {
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                },
                jobRunStatus: 'RUNNING',
                updatedTaskInfo: {
                    lastId: 'task-id'
                },
                getJobState: jest.fn().mockResolvedValue({}),
                setJobState: jest.fn(),
                getJobConfig: jest.fn(),
                setJobRunStatus: jest.fn(),
                setJobConfig: jest.fn(),
                getJobRunStatus: jest.fn(),
                errorsInfo: [],
                filesInfo: [],
                dirsInfo: [],
                taskStats: {},
            }
            const mockedInput = {
                excludePatterns: [],
                sourcePath: '/source/path',
                sourcePrefix: 'mnt',
                jobContext: mockedJobContext,
                command: {
                    fPath: 'file1',
                    ops: { 0: { cmd: OPS_CMD.COPY_CONTENT, status: OPS_STATUS.READY } },
                    commandId: 'command-id',
                    retryCount: 0,
                    status: CommandStatus.READY
                } as any,
            }
            jest.spyOn(service, 'getDirectoryContents').mockResolvedValue(['file1', 'file2']);
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs.promises, 'lstat').mockRejectedValue(new Error('Test error'));
            try {
                await service.scanDirCommand(mockedInput as any);
            } catch (error) {
                expect(error).toBe('Test error');
            }
        });
    })
});
