import { ScanService } from './scan-activity.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { CommonTaskService } from '../common/common-task.service';
import { DiscoveryScanService } from './discovery/discovery-scan.service';
import { MigrateScanService } from './migrate/migrate-scan.service';
import { FatalError, RetryableError, RetryExceededError } from 'src/errors/errors.types';
import { Context } from '@temporalio/activity';
import { CommandStatus, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import * as utils from 'src/activities/utils/utils';

jest.mock('@temporalio/activity', () => ({
    Context: {
        current: jest.fn(),
    },
    CancelledFailure: class CancelledFailure extends Error {
        constructor(message?: string) {
            super(message);
            this.name = 'CancelledFailure';
        }
    },
}));

const BASE_WORKING_PATH = '/tmp/base-worker';

const mockJobContext = {
    jobConfig: {
        options: {
            skipsFilesModifiedInLast: '2d',
            excludeFilePattern: 'node_modules,.git',
        },
        sourceDirectoryPath: '/source-dir',
        destinationDirectoryPath: '/target-dir',
    },
    jobRunId: 'test-job-run-id',
    publishToTaskStream: jest.fn(),
    publishToErrorStream: jest.fn(),
    deleteTask: jest.fn(),
    setTask: jest.fn(),
};

const mockTask = {
    status: TaskStatus.PENDING,
    workerId: '',
    commands: [
        { fPath: '/foo', retryCount: 0 },
        { fPath: '/bar', retryCount: 0 },
    ],
    sPathId: 'src',
    tPathId: 'tgt',
    id: 'task1',
};

const mockScanDirectoryOutput = {
    fileCount: 1,
    dirCount: 1,
    subDirs: ['sub1'],
};

describe('ScanService', () => {
    let scanService: ScanService;
    let configService: jest.Mocked<ConfigService>;
    let redisService: jest.Mocked<RedisService>;
    let commonTaskService: jest.Mocked<CommonTaskService>;
    let migrateScanService: jest.Mocked<MigrateScanService>;
    let discoveryScanService: jest.Mocked<DiscoveryScanService>;

    beforeEach(() => {
        process.env.BASE_WORKING_PATH = BASE_WORKING_PATH;

        configService = {
            get: jest.fn((key: string) => {
                switch (key) {
                    case 'worker.workerId': return 'worker-1';
                    case 'worker.maxMigrationCommand': return 10;
                    case 'worker.maxCommandConcurrency': return 2;
                    case 'worker.maxRetryCount': return 2;
                    default: return undefined;
                }
            }),
        } as any;

        redisService = {
            getJobManagerContext: jest.fn().mockResolvedValue(mockJobContext),
        } as any;

        commonTaskService = {
            buildOrGetValidScanTask: jest.fn().mockResolvedValue({ ...mockTask }),
        } as any;

        migrateScanService = {
            scanDirectory: jest.fn().mockResolvedValue({ ...mockScanDirectoryOutput }),
        } as any;

        discoveryScanService = {
            scanDirectory: jest.fn().mockResolvedValue({ ...mockScanDirectoryOutput }),
        } as any;

        (Context.current as jest.Mock).mockReturnValue({
            info: { activityId: 'activity-1' },
            heartbeat: jest.fn(),
        });

        scanService = new ScanService(
            configService,
            redisService,
            commonTaskService,
            migrateScanService,
            discoveryScanService
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    describe('getScanSettings', () => {
        it('should return correct scan settings', () => {
            const settings = utils.getScanSettings(mockJobContext as any);
            expect(settings).toEqual({
                skipFile: '2d',
                excludePatterns: ['node_modules', '.git'],
            });
        });

        it('should handle missing options', () => {
            const ctx = { jobConfig: {} };
            const settings = utils.getScanSettings(ctx as any);
            expect(settings).toEqual({
                skipFile: '',
                excludePatterns: [],
            });
        });
    });


    describe('updateAndReportTaskStatus', () => {
        it('should complete task if no errors', async () => {
            const task = { ...mockTask };
            await scanService.updateAndReportTaskStatus({
                errors: [],
                jobContext: mockJobContext as any,
                taskHashId: 'activity-1',
                task,
                retryCount: 0,
            }as any);
            expect(task.status).toBe(TaskStatus.COMPLETED);
            expect(mockJobContext.publishToTaskStream).toHaveBeenCalled();
            expect(mockJobContext.deleteTask).toHaveBeenCalled();
        });

        it('should throw FatalError if errors are fatal', async () => {
            const task = { ...mockTask };
            jest.spyOn(require('src/activities/utils/utils'), 'isSourceFatalError').mockReturnValue(true);
            await expect(scanService.updateAndReportTaskStatus({
                errors: ['fatal'],
                jobContext: mockJobContext as any,
                taskHashId: 'activity-1',
                task,
                retryCount: 1,
            }as any)).rejects.toBeInstanceOf(FatalError);
            expect(mockJobContext.deleteTask).toHaveBeenCalled();
        });

        it('should publish error and delete task if retryCount exceeded', async () => {
            const task = { ...mockTask };
            jest.spyOn(require('src/activities/utils/utils'), 'isSourceFatalError').mockReturnValue(false);
            await scanService.updateAndReportTaskStatus({
                errors: ['err'],
                jobContext: mockJobContext as any,
                taskHashId: 'activity-1',
                task,
                retryCount: 3,
            }as any);
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(mockJobContext.deleteTask).toHaveBeenCalled();
        });

        it('should throw RetryableError if errors and retryCount not exceeded', async () => {
            const task = { ...mockTask };
            jest.spyOn(require('src/activities/utils/utils'), 'isSourceFatalError').mockReturnValue(false);
            await expect(scanService.updateAndReportTaskStatus({
                errors: ['err'],
                jobContext: mockJobContext as any,
                taskHashId: 'activity-1',
                task,
                retryCount: 1,
            }as any)).rejects.toBeInstanceOf(RetryableError);
            expect(mockJobContext.deleteTask).not.toHaveBeenCalled();
        });

        });

        describe('executeTask', () => {
        it('should execute discovery scan and aggregate results', async () => {
            const task = { ...mockTask, commands: [{ fPath: '/foo', retryCount: 0, status: CommandStatus.READY }, { fPath: '/bar', retryCount: 0, status: CommandStatus.READY }] };
            const jobContext = { ...mockJobContext, setTask: jest.fn() };
            jest.spyOn(utils, 'getScanSettings').mockReturnValue({
            skipFile: '2d',
            excludePatterns: ['node_modules', '.git'],
            });
            jest.spyOn(scanService, 'batchSubDirs').mockResolvedValue({ subDirs: [], batchDirs: ['batch1'] });

            const result = await scanService.executeTask({
            activityId: 'activity-1',
            jobContext: jobContext as any,
            jobRunId: 'job-1',
            task,
            isMigration: false,
            batchSize: 10,
            } as any);

            expect(discoveryScanService.scanDirectory).toHaveBeenCalledTimes(2);
            expect(result.result.fileCount).toBe(2);
            expect(result.result.dirCount).toBe(2);
            expect(result.result.batchDirs).toEqual(['batch1']);
            expect(result.errors).toEqual([]);
            expect(task.commands[0].status).toBe(CommandStatus.COMPLETED);
            expect(task.commands[1].status).toBe(CommandStatus.COMPLETED);
        });

        it('should execute migrate scan and aggregate results', async () => {
            const task = { ...mockTask, commands: [{ fPath: '/foo', retryCount: 0, status: CommandStatus.READY }, { fPath: '/bar', retryCount: 0, status: CommandStatus.READY }] };
            const jobContext = { ...mockJobContext, setTask: jest.fn() };
            jest.spyOn(utils, 'getScanSettings').mockReturnValue({
            skipFile: '2d',
            excludePatterns: ['node_modules', '.git'],
            });
            jest.spyOn(scanService, 'batchSubDirs').mockResolvedValue({ subDirs: [], batchDirs: ['batch1'] });

            const result = await scanService.executeTask({
            activityId: 'activity-1',
            jobContext: jobContext as any,
            jobRunId: 'job-1',
            task,
            isMigration: true,
            batchSize: 10,
            } as any);

            expect(migrateScanService.scanDirectory).toHaveBeenCalledTimes(2);
            const firstCallInput = migrateScanService.scanDirectory.mock.calls[0][0];
            const expectedSourcePrefix = `${BASE_WORKING_PATH}/job-1/${task.sPathId}/source-dir`;
            const expectedTargetPrefix = `${BASE_WORKING_PATH}/job-1/${task.tPathId}/target-dir`;
            expect(firstCallInput.sourcePrefix).toBe(expectedSourcePrefix);
            expect(firstCallInput.targetPrefix).toBe(expectedTargetPrefix);
            expect(firstCallInput.sourcePath).toBe(`${expectedSourcePrefix}/foo`);
            expect(firstCallInput.targetPath).toBe(`${expectedTargetPrefix}/foo`);
            expect(result.result.fileCount).toBe(2);
            expect(result.result.dirCount).toBe(2);
            expect(result.result.batchDirs).toEqual(['batch1']);
            expect(result.errors).toEqual([]);
            expect(task.commands[0].status).toBe(CommandStatus.COMPLETED);
            expect(task.commands[1].status).toBe(CommandStatus.COMPLETED);
        });

        it('should collect errors from scanDirectory', async () => {
            const task = { ...mockTask, commands: [{ fPath: '/foo', retryCount: 0, status: CommandStatus.READY }] };
            const jobContext = { ...mockJobContext, setTask: jest.fn() };
            discoveryScanService.scanDirectory.mockRejectedValueOnce({ code: 'ERR_CODE' });
            jest.spyOn(utils, 'getScanSettings').mockReturnValue({
            skipFile: '2d',
            excludePatterns: ['node_modules', '.git'],
            });
            jest.spyOn(scanService, 'batchSubDirs').mockResolvedValue({ subDirs: [], batchDirs: [] });

            const result = await scanService.executeTask({
            activityId: 'activity-1',
            jobContext: jobContext as any,
            jobRunId: 'job-1',
            task,
            isMigration: false,
            batchSize: 10,
            } as any);

            expect(result.errors).toEqual(['ERR_CODE']);
            expect(result.result.fileCount).toBe(0);
            expect(result.result.dirCount).toBe(0);
            expect(task.commands[0].status).toBe(CommandStatus.ERROR);
        });

        it('should use TRANSIENT_ERROR when retry threshold is reached', async () => {
            const task = {
                ...mockTask,
                retryCount: 1,
                commands: [{ fPath: '/foo', retryCount: 1, status: CommandStatus.READY }],
            };
            const jobContext = { ...mockJobContext, setTask: jest.fn() };
            jest.spyOn(utils, 'getScanSettings').mockReturnValue({
                skipFile: '2d',
                excludePatterns: ['node_modules', '.git'],
            });
            jest.spyOn(scanService, 'batchSubDirs').mockResolvedValue({ subDirs: [], batchDirs: [] });

            await scanService.executeTask({
                activityId: 'activity-1',
                jobContext: jobContext as any,
                jobRunId: 'job-1',
                task: task as any,
                isMigration: true,
                batchSize: 10,
            } as any);

            const callInput = migrateScanService.scanDirectory.mock.calls[0][0];
            expect(callInput.errorType).toBe('TRANSIENT_ERROR');
        });

        it('should throw CancelledFailure when activity cancellation signal is aborted', async () => {
            (Context.current as jest.Mock).mockReturnValue({
                info: { activityId: 'activity-1' },
                heartbeat: jest.fn(),
                cancellationSignal: { aborted: true },
            });

            await expect(
                scanService.executeTask({
                    activityId: 'activity-1',
                    jobContext: { ...mockJobContext, setTask: jest.fn() } as any,
                    jobRunId: 'job-1',
                    task: {
                        ...mockTask,
                        commands: [{ fPath: '/foo', retryCount: 0, status: CommandStatus.READY }],
                    } as any,
                    isMigration: true,
                    batchSize: 10,
                } as any),
            ).rejects.toThrow('Activity cancelled');
        });
        });

        describe('handleDirsReturn', () => {
        it('should batch subDirs correctly', async () => {
            const jobContext = { setBatchDir: jest.fn().mockResolvedValue(undefined) };
            const subDirs = ['a', 'b', 'c', 'd'];
            const batchSize = 2;
            const hashMock = jest.spyOn(require('src/activities/utils/checksum-utils'), 'calculateHash');
            hashMock.mockImplementation((arr: string[]) => arr.join('-hash'));

            const result = await scanService.batchSubDirs({
            batchSize,
            subDirs: [...subDirs],
            jobContext: jobContext as any,
            });

            expect(result.batchDirs.length).toBe(2);
            expect(jobContext.setBatchDir).toHaveBeenCalledTimes(2);
        });

        it('should handle empty subDirs', async () => {
            const jobContext = { setBatchDir: jest.fn().mockResolvedValue(undefined) };
            const result = await scanService.batchSubDirs({
            batchSize: 2,
            subDirs: [],
            jobContext: jobContext as any,
            });
            expect(result.batchDirs.length).toBe(0);
            expect(jobContext.setBatchDir).not.toHaveBeenCalled();
        });
        });

        describe('scanDirectories', () => {
        it('should run scanDirectories and return output', async () => {
            const scanResult = {
            result: { dirCount: 1, fileCount: 1, subDirs: [], jobRunId: 'job-1', batchDirs: [] },
            errors: [],
            retryCount: 0,
            };
            jest.spyOn(scanService, 'executeTask').mockResolvedValue(scanResult as any);
            jest.spyOn(scanService, 'updateAndReportTaskStatus').mockResolvedValue(undefined);

            const result = await scanService.scanDirectories({
            jobRunId: 'job-1',
            isMigration: false,
            batchSize: 10,
            batchId: undefined,
            });

            expect(result).toEqual(scanResult.result);
            expect(scanService.executeTask).toHaveBeenCalled();
            expect(scanService.updateAndReportTaskStatus).toHaveBeenCalled();
        });

        it('should return default output when scan task has no commands', async () => {
            const executeTaskSpy = jest.spyOn(scanService, 'executeTask');
            commonTaskService.buildOrGetValidScanTask.mockResolvedValueOnce({
                ...mockTask,
                commands: [],
            } as any);

            const result = await scanService.scanDirectories({
                jobRunId: 'job-1',
                isMigration: false,
                batchSize: 10,
                batchId: undefined,
            });

            expect(result).toEqual({
                dirCount: 0,
                fileCount: 0,
                subDirs: [],
                jobRunId: 'job-1',
                batchDirs: [],
                excludedPaths: [],
                skippedPaths: [],
            });
            expect(executeTaskSpy).not.toHaveBeenCalled();
        });

        it('should heartbeat while scan activity is running', async () => {
            jest.useFakeTimers();
            const heartbeat = jest.fn();
            (Context.current as jest.Mock).mockReturnValue({
                info: { activityId: 'activity-1' },
                heartbeat,
            });

            jest.spyOn(scanService, 'executeTask').mockImplementation(async () => {
                jest.advanceTimersByTime(2100);
                return {
                    result: {
                        dirCount: 0,
                        fileCount: 0,
                        subDirs: [],
                        jobRunId: 'job-1',
                        batchDirs: [],
                        excludedPaths: [],
                        skippedPaths: [],
                    },
                    errors: [],
                    retryCount: 0,
                } as any;
            });
            jest.spyOn(scanService, 'updateAndReportTaskStatus').mockResolvedValue(undefined);

            await scanService.scanDirectories({
                jobRunId: 'job-1',
                isMigration: false,
                batchSize: 10,
                batchId: undefined,
            });

            expect(heartbeat).toHaveBeenCalled();
        });

        it('should delete batch dir if preBatchedId is provided', async () => {
            const scanResult = {
            result: { dirCount: 1, fileCount: 1, subDirs: [], jobRunId: 'job-1', batchDirs: [] },
            errors: [],
            retryCount: 0,
            };
            jest.spyOn(scanService, 'executeTask').mockResolvedValue(scanResult as any);
            jest.spyOn(scanService, 'updateAndReportTaskStatus').mockResolvedValue(undefined);
            const deleteBatchDir = jest.fn();
            (mockJobContext as any).deleteBatchDir = deleteBatchDir;

            await scanService.scanDirectories({
            jobRunId: 'job-1',
            isMigration: false,
            batchSize: 10,
            batchId: 'batch-123',
            });

            expect(deleteBatchDir).toHaveBeenCalledWith('batch-123');
        });

        it('should throw RetryableError on unknown error', async () => {
            jest.spyOn(scanService, 'executeTask').mockRejectedValue(new Error('fail'));
            await expect(scanService.scanDirectories({
            jobRunId: 'job-1',
            isMigration: false,
            batchSize: 10,
            batchId: undefined,
            })).rejects.toBeInstanceOf(RetryableError);
        });

        it('should rethrow FatalError', async () => {
            jest.spyOn(scanService, 'executeTask').mockRejectedValue(new FatalError('fatal'));
            await expect(scanService.scanDirectories({
            jobRunId: 'job-1',
            isMigration: false,
            batchSize: 10,
            batchId: undefined,
            })).rejects.toBeInstanceOf(FatalError);
        });
        });
    });
