import { Test, TestingModule } from '@nestjs/testing';
import { MigrationSyncService } from './migrate.sync.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { CommonActivityService } from '../common/common.service';
import { ShellService } from '../common/shell.service';
import * as fs from 'fs';
import * as utils from '../utils/utils';
import * as crypto from 'crypto';
import { CommandStatus, ErrorType, JobContext, OPS_CMD, OPS_STATUS, Task, TaskStatus, TaskType } from '@netapp-cloud-datamigrate/jobs-lib';
import { WorkerThreadService } from '../../thread/worker.thread.service';

jest.mock('@temporalio/activity', () => ({
    Context: {
      current: jest.fn(),
    },
}));


jest.mock('@temporalio/activity', () => ({
    Context: {
        current: jest.fn().mockResolvedValue(()=>({
            heartbeat: jest.fn(),
        }))
    },
}))
describe('MigrationSyncService', () => {
    let service: MigrationSyncService;
    let redisService: RedisService;
    let commonService: CommonActivityService;
    let workerThreadService: any;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: WorkerThreadService,
                    useValue: {
                        runWorkerThread: jest.fn(),
                        stopWorkerThread: jest.fn(),
                        sendMessageToWorker: jest.fn(),
                        getWorkerThreadStatus: jest.fn(),
                        getWorkerThreadId: jest.fn(),
                        getWorkerThreadJobRunId: jest.fn(),
                        getWorkerThreadJobConfig: jest.fn(),
                        getWorkerThreadJobState: jest.fn(),
                        getWorkerThreadJobRunStatus: jest.fn(),
                        setWorkerThreadJobRunStatus: jest.fn(),
                        migrateWorkerThread: jest.fn(),
                    }
                },
                MigrationSyncService,
                ConfigService,
                Logger,
                RedisService,
                CommonActivityService,
                ShellService,
                {
                    provide: RedisService,
                    useValue: {
                        getJobContext: jest.fn(),
                        setJobContext: jest.fn(),
                        getMemoryInfo: jest.fn(),
                    }
                },
                {
                    provide: CommonActivityService,
                    useValue: {
                        fetchOneTask: jest.fn(),
                        fetchOneMigrationTask: jest.fn(),
                        addFailedWorkerToJobState: jest.fn()
                    }
                }
            ],
        }).compile();

        service = module.get<MigrationSyncService>(MigrationSyncService);
        redisService = module.get<RedisService>(RedisService);
        commonService = module.get<CommonActivityService>(CommonActivityService);
        workerThreadService = module.get<WorkerThreadService>(WorkerThreadService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('calculateChecksum', () => {
        it('should return a valid checksum for a file', async () => {
            const mockFilePath = 'test.txt';
            const fileContent = 'Hello World';
            const expectedChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
                const stream = new (require('stream')).Readable();
                stream.push(fileContent);
                stream.push(null);
                return stream;
            });
            await expect(service.calculateChecksum(mockFilePath)).resolves.toBe(expectedChecksum);
        });

        it('should reject if the file does not exist', async () => {
            const mockFilePath = 'nonexistent.txt';
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            await expect(service.calculateChecksum(mockFilePath)).rejects.toThrow(`File not found: ${mockFilePath}`);
        });

        it('should reject if an error occurs during reading', async () => {
            const mockFilePath = 'error.txt';
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
                const stream = new (require('stream')).Readable();
                process.nextTick(() => stream.emit('error', new Error('Read error')));
                return stream;
            });
            await expect(service.calculateChecksum(mockFilePath)).rejects.toThrow('Read error');
        });
    });

    describe('ensureDirectoryExists', () => {
        it('should create the directory if it does not exist', async () => {
            const mockDirPath = 'testDir';
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => '');
            await service.ensureDirectoryExists(mockDirPath);
            expect(fs.mkdirSync).toHaveBeenCalledWith(mockDirPath, { recursive: true });
        });

        it('should do nothing if the directory already exists', async () => {
            const mockDirPath = 'existingDir';
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => '');
            await service.ensureDirectoryExists(mockDirPath);
            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });
        it('should throw an error if an error occurs during directory creation', async () => {
            const mockDirPath = 'errorDir';
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);
            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('Directory creation error') });
            try {
                await service.ensureDirectoryExists(mockDirPath);
            } catch (error) {
                expect(error.message).toBe('Directory creation error');
            }
        });
    })

    describe('syncOperation', () => {
        it('should perform a sync operation when operations is not empty and status is not completed', async () => {
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
            const mockInput = {
                sourcePath: 'sourcePath',
                targetPath: 'targetPath',
                ops: [{
                    cmd: OPS_CMD.COPY_CONTENT,
                    status: OPS_STATUS.READY,
                    metadata: {}
                }, {
                    cmd: OPS_CMD.STAMP_META,
                    status: OPS_STATUS.READY,
                    metadata: {}
                }],
                jobContext: mockJobContext,
                command: {
                    fPath: 'sourcePath',
                    ops: {
                        0: {
                            cmd: OPS_CMD.COPY_CONTENT,
                            status: OPS_STATUS.READY,
                            metadata: {}
                        }
                    },
                    status: OPS_STATUS.READY,
                    commandId: 'command-id',
                    retryCount: 0
                },
            }

            jest.spyOn(service, 'copyFileWithChecksum').mockResolvedValue({
                targetChecksum: 'targetChecksum',
                sourceChecksum: 'sourceChecksum',
            });
            jest.spyOn(service, 'stampMetaData').mockResolvedValue({ sourceErrors: [], targetErrors: [], errorType: undefined });
            jest.spyOn(workerThreadService, 'migrateWorkerThread').mockResolvedValue({
                sourceChecksum: 'sourceChecksum',
                targetChecksum: 'targetChecksum',
            });

            const result = await service.syncOperation(mockInput as any);
            expect(result.ops[0].status).toBe(OPS_STATUS.COMPLETED);
            expect(result.ops[1].status).toBe(OPS_STATUS.COMPLETED);
            expect(result.status).toBe(OPS_STATUS.COMPLETED);
            expect(result.errors.source.size).toBe(0);
            expect(result.checksums).toEqual({
                sourceChecksum: 'sourceChecksum',
                targetChecksum: 'targetChecksum'
            });
        });

        // copyFileWithChecksum should throw an error
        it('should handle errors during sync operation', async () => {
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
            const mockInput = {
                sourcePath: 'sourcePath',
                targetPath: 'targetPath',
                ops: [{
                    cmd: OPS_CMD.COPY_CONTENT,
                    status: OPS_STATUS.READY,
                    metadata: {
                        size: 2048,
                    }
                }, {
                    cmd: OPS_CMD.STAMP_META,
                    status: OPS_STATUS.READY,
                    metadata: { size: 2048 }
                }],
                jobContext: mockJobContext,
                command: {
                    fPath: 'sourcePath',
                    ops: {
                        0: {
                            cmd: OPS_CMD.COPY_CONTENT,
                            status: OPS_STATUS.READY,
                            metadata: { size: 2048 }
                        }
                    },
                    status: OPS_STATUS.READY,
                    commandId: 'command-id',
                    retryCount: 0
                },
            }

            jest.spyOn(service, 'copyFileWithChecksum').mockRejectedValue(new Error('Copy error'));
            jest.spyOn(service, 'stampMetaData').mockResolvedValue({ sourceErrors: [], targetErrors: [], errorType: undefined });
            jest.spyOn(workerThreadService, 'migrateWorkerThread').mockRejectedValue(new Error('Copy error'))

            try {
                await service.syncOperation(mockInput as any);
            }
            catch (error) {
                expect(error.message).toBe('Copy error');
            }
            expect(mockInput.ops[0].status).toBe(OPS_STATUS.ERROR);
        });
        // cmd === OPS_CMD.COPY_DIR
        it('should handle COPY_DIR operation', async () => {
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
            const mockInput = {
                sourcePath: 'sourcePath',
                targetPath: 'targetPath',
                ops: [{
                    cmd: OPS_CMD.COPY_DIR,
                    status: OPS_STATUS.READY,
                    metadata: {}
                }, {
                    cmd: OPS_CMD.STAMP_META,
                    status: OPS_STATUS.READY,
                    metadata: {}
                }],
                jobContext: mockJobContext,
                command: {
                    fPath: 'sourcePath',
                    ops: {
                        0: {
                            cmd: OPS_CMD.COPY_DIR,
                            status: OPS_STATUS.READY,
                            metadata: {}
                        }
                    },
                    status: OPS_STATUS.READY,
                    commandId: 'command-id',
                    retryCount: 0
                },
            }
            const result = await service.syncOperation(mockInput as any);
            expect(result.ops[0].status).toBe(OPS_STATUS.COMPLETED);
            expect(result.status).toBe(OPS_STATUS.COMPLETED);
            expect(result.errors.target.size).toBe(0);
        });

        // ensureDirectoryExists should throw an error
        it('should handle errors during directory creation', async () => {
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
            const mockInput = {
                sourcePath: 'sourcePath',
                targetPath: 'targetPath',
                ops: [{
                    cmd: OPS_CMD.COPY_DIR,
                    status: OPS_STATUS.READY,
                    metadata: {}
                }, {
                    cmd: OPS_CMD.STAMP_META,
                    status: OPS_STATUS.READY,
                    metadata: {}
                }],
                jobContext: mockJobContext,
                command: {
                    fPath: 'sourcePath',
                    ops: {
                        0: {
                            cmd: OPS_CMD.COPY_DIR,
                            status: OPS_STATUS.READY,
                            metadata: {}
                        }
                    },
                    status: OPS_STATUS.READY,
                    commandId: 'command-id',
                    retryCount: 0
                },
            }
            jest.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('Directory creation error') });
            try {
                await service.syncOperation(mockInput as any);
            } catch (error) {
                expect(error.message).toBe('Directory creation error');
            }
        });
    })

    describe('syncTask', () => {
        it('should handle sync task', async () => {
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
                getJobState: jest.fn().mockReturnValue({
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                }),
                setJobState: jest.fn(),
                getJobConfig: jest.fn(),
                setJobConfig: jest.fn(),
                getJobRunStatus: jest.fn(),
                setJobRunStatus: jest.fn(),
                getSyncTask: jest.fn(),
                setSyncTask: jest.fn(),
                deleteSyncTask: jest.fn(),
                errorsInfo: [],
                filesInfo: {
                    lastId: 'file-id',
                    numMessages: 1,
                },
                dirsInfo: [],
                taskStats: {},
                migrateTask: {
                    lastId: 'task-id'
                },
                getScanTask: jest.fn(),
                setScanTask: jest.fn(),
                deleteScanTask: jest.fn(),
            } as unknown as JobContext
            const mockedTask: any = {
                id: 'task-id',
                jobRunId: '1234',
                taskType: TaskType.MIGRATE,
                status: TaskStatus.PENDING,
                workerId: 'worker-id',
                sPath: 'source-path',
                sPathId: 'source-path-id',
                tPath: 'target-path',
                tPathId: 'target-path-id',
                excludeFilePatterns: '',
                commands: [{
                    fPath: 'source-path',
                    ops: {
                        0: {
                            cmd: OPS_CMD.COPY_CONTENT,
                            status: OPS_STATUS.READY,
                        }
                    },
                    status: CommandStatus.READY,
                    commandId: 'command-id',
                    retryCount: 0
                }],
            }
            const mockRedisMemoryInfo = {
                used_memory: 50,
                total_system_memory: 100,
            }
            jest.spyOn(redisService, 'getJobContext').mockResolvedValue(mockJobContext);
            jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);
            jest.spyOn(commonService, 'fetchOneMigrationTask').mockReturnValue(mockedTask);
            jest.spyOn(redisService, 'getMemoryInfo').mockResolvedValue(mockRedisMemoryInfo);
            jest.spyOn(service, 'syncOperation').mockResolvedValue({
                status: OPS_STATUS.COMPLETED,
                ops: {
                    0: {
                        cmd: OPS_CMD.COPY_CONTENT,
                        status: OPS_STATUS.COMPLETED,
                    }
                },
                errors: { size: 0 },
                checksums: {
                    sourceChecksum: 'source-checksum',
                    targetChecksum: 'target-checksum'
                }
            } as any);

            jest.spyOn(service, 'getFileInfo').mockResolvedValue({} as any);
            jest.spyOn(utils, 'isFatalError').mockReturnValue(false);

            const result = await service.syncTask({failedWorkers: [], jobRunId: '1234', jobContext: mockJobContext} as any);
            expect(result).toBeDefined();
        });

        // test for no task found
        it('should handle no task found', async () => {
            const mockedJobContext = {
                getJobState: jest.fn().mockReturnValue({
                    workers: [],
                    tasks_completed: 1,
                    tasks_total: 2,
                    workers_agreed: [],
                    status: 'RUNNING',
                    failedWorkers: []
                  }),
                  getScanTask: jest.fn(),
                  setScanTask: jest.fn(),
                  deleteScanTask: jest.fn(),
                  getSyncTask: jest.fn(),
                  setSyncTask: jest.fn(),
                  deleteSyncTask: jest.fn(),
            }
            const mockInput = {
                jobContext: mockedJobContext,
                getSyncTask: jest.fn(),
                setSyncTask: jest.fn(),
                deleteSyncTask: jest.fn(),
            }
            const mockedTask: any = null;
            jest.spyOn(redisService, 'getJobContext').mockResolvedValue(mockedJobContext as any);
            jest.spyOn(redisService, 'setJobContext').mockResolvedValue(undefined);
            jest.spyOn(commonService, 'fetchOneMigrationTask').mockReturnValue(mockedTask);

            const result = await service.syncTask({failedWorkers: [], jobRunId: '1234'} as any);
            expect(result).toEqual({
                errors: {
                    source: new Set(),
                    target: new Set(),
                },
                success: 0,
                error: 0,
                retryCount: 0,
                noTaskFound: true,
                isFatal: false,
            });
        });
    })

    describe('getFileInfo', () => {
        it("should return file info for a regular file", async () => {
            jest.spyOn(fs.promises, "lstat").mockResolvedValue({
                isFile: () => true,
                isDirectory: () => false,
                isSymbolicLink: () => false,
                isSocket: () => false,
                isFIFO: () => false,
                isCharacterDevice: () => false,
                isBlockDevice: () => false,
                dev: 0,
                ino: 0,
                mode: 0o764,
                nlink: 0,
                uid: 0,
                gid: 0,
                rdev: 0,
                size: 1024,
                blksize: 0,
                blocks: 0,
                atime: new Date(),
                mtime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            } as fs.Stats);

            const result = await service.getFileInfo({
                name: "file.txt",
                fullFilePath: "/mock/path/file.txt",
                relativePath: "mock/path/file.txt",
                checksums: { sourceChecksum: 'abc123', targetChecksum: 'abc123' },
                getID: false,
            });

            expect(result.fileName).toBe("file.txt");
            expect(result.isDirectory).toBe(false);
            expect(result.fileSize).toBe(1024);
            expect(result.path).toBe("mock/path/file.txt");
            expect(result.extension).toBe(".txt");
            expect(result.permission).toBe("-rwxrw-r--");
            expect(result.fileType).toBe("FILE");
            expect(result.depth).toBe(1);
            expect(result.uid).toBe(0);
            expect(result.gid).toBe(0);
            expect(result.sid).toBe(undefined);
            expect(result.birthTime).toBeInstanceOf(Date);
            expect(result.modifiedTime).toBeInstanceOf(Date);
            expect(result.accessTime).toBeInstanceOf(Date);
        });

        it("should return file info for a directory", async () => {
            jest.spyOn(fs.promises, "lstat").mockResolvedValue({
                isFile: () => false,
                isDirectory: () => true,
                isSymbolicLink: () => false,
                isSocket: () => false,
                isFIFO: () => false,
                isCharacterDevice: () => false,
                isBlockDevice: () => false,
                ino: 0,
                mode: 0o764,
                nlink: 0,
                uid: 0,
                gid: 0,
                rdev: 0,
                size: 1024,
                blksize: 0,
                blocks: 0,
                atime: new Date(),
                mtime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            } as fs.Stats);

            const result = await service.getFileInfo({
                name: "dir_1",
                fullFilePath: "/mock/path/dir_1",
                relativePath: "mock/path/dir_1",
                checksums: { sourceChecksum: 'abc123', targetChecksum: 'abc123' },
                getID: false,
            });

            expect(result.fileName).toBe("dir_1");
            expect(result.isDirectory).toBe(true);
        });
    });
    describe('stampMetaData', () => {
        it('should set file mode successfully', async () => {
            const mockTargetPath = 'targetPath';
            const mockSourcePath = 'sourcePath';
            const mockMetadata = { mode: 0o755 } as any;
            const mockJobContext = {
                appendToErrorList: jest.fn(),
                jobConfig: { options: {} },
                getScanTask: jest.fn(),
                setScanTask: jest.fn(),
                deleteScanTask: jest.fn(),
                getSyncTask: jest.fn(),
                setSyncTask: jest.fn(),
                deleteSyncTask: jest.fn(),
            } as unknown as JobContext;
            const mockCommand = { retryCount: 0, commandId: 'command-id', fPath: 'filePath' } as any;

            jest.spyOn(fs.promises, 'chmod').mockResolvedValue();

            const result = await service.stampMetaData(mockTargetPath, mockSourcePath, mockMetadata, mockJobContext, mockCommand, ErrorType.RECOVERABLE_ERROR);

            expect(result.sourceErrors).toHaveLength(0);
            expect(fs.promises.chmod).toHaveBeenCalledWith(mockTargetPath, mockMetadata.mode);
        });

        it('should set access and modified times successfully', async () => {
            const mockTargetPath = 'targetPath';
            const mockSourcePath = 'sourcePath';
            const mockMetadata = { atime: new Date().toISOString(), mtime: new Date().toISOString() };
            const mockJobContext = {
                appendToErrorList: jest.fn(),
                jobConfig: { options: {} },
                getScanTask: jest.fn(),
                setScanTask: jest.fn(),
                deleteScanTask: jest.fn(),
                getSyncTask: jest.fn(),
                setSyncTask: jest.fn(),
                deleteSyncTask: jest.fn(),
            } as unknown as JobContext;
            const mockCommand = { retryCount: 0, commandId: 'command-id', fPath: 'filePath' } as any;

            jest.spyOn(fs.promises, 'utimes').mockResolvedValue();

            const result = await service.stampMetaData(mockTargetPath, mockSourcePath, mockMetadata as any, mockJobContext, mockCommand, ErrorType.RECOVERABLE_ERROR);

            expect(result.sourceErrors).toHaveLength(0);
            expect(fs.promises.utimes).toHaveBeenCalledWith(mockTargetPath, new Date(mockMetadata.atime), new Date(mockMetadata.mtime));
        });

        // error case when metadata.mode 
        it('should handle error when setting file mode', async () => {
            const mockTargetPath = 'targetPath';
            const mockSourcePath = 'sourcePath';
            const mockMetadata = { mode: 0o755 } as any;
            const mockJobContext = {
                appendToErrorList: jest.fn(),
                jobConfig: { options: {} },
                getScanTask: jest.fn(),
                setScanTask: jest.fn(),
                deleteScanTask: jest.fn(),
                getSyncTask: jest.fn(),
                setSyncTask: jest.fn(),
                deleteSyncTask: jest.fn(),
            } as unknown as JobContext;
            const mockCommand = { retryCount: 0, commandId: 'command-id', fPath: 'filePath' } as any;

            jest.spyOn(fs.promises, 'chmod').mockRejectedValue(() => { });
            try {
                const result = await service.stampMetaData(mockTargetPath, mockSourcePath, mockMetadata as any, mockJobContext, mockCommand, ErrorType.RECOVERABLE_ERROR);
                expect(result.targetErrors).toHaveLength(1);
            } catch (error) {
                expect(error.message).toBe('Error setting file mode');
            }
        });

        // test case for mtime && atime

        it('should set mtime and atime successfully', async () => {
            const mockTargetPath = 'targetPath';
            const mockSourcePath = 'sourcePath';
            const mockMetadata = { mtime: new Date().toISOString(), atime: new Date().toISOString() };
            const mockJobContext = {
                appendToErrorList: jest.fn(),
                jobConfig: { options: {} },
                getScanTask: jest.fn(),
                setScanTask: jest.fn(),
                deleteScanTask: jest.fn(),
                getSyncTask: jest.fn(),
                setSyncTask: jest.fn(),
                deleteSyncTask: jest.fn(),
            } as unknown as JobContext;
            const mockCommand = { retryCount: 0, commandId: 'command-id', fPath: 'filePath' } as any;
            jest.spyOn(fs.promises, 'utimes').mockResolvedValue();
            const result = await service.stampMetaData(mockTargetPath, mockSourcePath, mockMetadata as any, mockJobContext, mockCommand, ErrorType.RECOVERABLE_ERROR);
                expect(result.targetErrors).toHaveLength(0);
        });
    });
});
