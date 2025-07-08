import { ScanService } from './scan-activity.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { CommonTaskService } from '../common/common-task.service';
import { DiscoveryScanService } from './discovery/discovery-scan.service';
import { MigrateScanService } from './migrate/migrate-scan.service';
import { FatalError, RetryableError, RetryExceededError } from 'src/errors/errors.types';
import { Context } from '@temporalio/activity';
import { TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';

jest.mock('@temporalio/activity', () => ({
    Context: {
        current: jest.fn(),
    },
}));

const mockJobContext = {
    jobConfig: {
        options: {
            skipsFilesModifiedInLast: '2d',
            excludeFilePattern: 'node_modules,.git',
        },
    },
    publishToTaskStream: jest.fn(),
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
            const settings = scanService.getScanSettings(mockJobContext as any);
            expect(settings).toEqual({
                skipFile: '2d',
                excludePatterns: ['node_modules', '.git'],
            });
        });

        it('should handle missing options', () => {
            const ctx = { jobConfig: {} };
            const settings = scanService.getScanSettings(ctx as any);
            expect(settings).toEqual({
                skipFile: '',
                excludePatterns: [],
            });
        });
    });

    describe('executeTask', () => {
        it('should execute discovery scan and aggregate results', async () => {
            const task = { ...mockTask, commands: [{ fPath: '/foo', retryCount: 0 }] };
            const result = await scanService.executeTask({
                activityId: 'activity-1',
                jobContext: mockJobContext as any,
                jobRunId: 'run-1',
                task,
                isMigration: false,
            }as any);
            expect(discoveryScanService.scanDirectory).toHaveBeenCalled();
            expect(result.result.fileCount).toBe(1);
            expect(result.result.dirCount).toBe(1);
            expect(result.errors).toEqual([]);
        });

        it('should execute migrate scan when isMigration is true', async () => {
            const task = { ...mockTask, commands: [{ fPath: '/foo', retryCount: 0 }] };
            await scanService.executeTask({
                activityId: 'activity-1',
                jobContext: mockJobContext as any,
                jobRunId: 'run-1',
                task,
                isMigration: true,
            }as any);
            expect(migrateScanService.scanDirectory).toHaveBeenCalled();
        });

        it('should collect errors from scanDirectory', async () => {
            discoveryScanService.scanDirectory.mockRejectedValueOnce({ code: 'ERR1' });
            const task = { ...mockTask, commands: [{ fPath: '/foo', retryCount: 0 }] };
            const result = await scanService.executeTask({
                activityId: 'activity-1',
                jobContext: mockJobContext as any,
                jobRunId: 'run-1',
                task,
                isMigration: false,
            } as any);
            expect(result.errors).toEqual(['ERR1']);
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

        it('should throw RetryExceededError if retryCount exceeded', async () => {
            const task = { ...mockTask };
            jest.spyOn(require('src/activities/utils/utils'), 'isSourceFatalError').mockReturnValue(false);
            await expect(scanService.updateAndReportTaskStatus({
                errors: ['err'],
                jobContext: mockJobContext as any,
                taskHashId: 'activity-1',
                task,
                retryCount: 3,
            }as any)).rejects.toBeInstanceOf(RetryExceededError);
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

    describe('scanDirectories', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        it('should scan directories and return output', async () => {
            const input = { jobRunId: 'run-1', dirsToScan: ['/foo'], isMigration: false };
            const result = await scanService.scanDirectories(input as any);
            expect(result).toHaveProperty('dirCount');
            expect(commonTaskService.buildOrGetValidScanTask).toHaveBeenCalled();
            expect(mockJobContext.publishToTaskStream).toHaveBeenCalled();
        });

        it('should throw RetryableError on unknown error', async () => {
            redisService.getJobManagerContext.mockRejectedValueOnce(new Error('fail'));
            const input = { jobRunId: 'run-1', dirsToScan: ['/foo'], isMigration: false };
            await expect(scanService.scanDirectories(input as any)).rejects.toBeInstanceOf(RetryableError);
        });

        it('should rethrow FatalError', async () => {
            redisService.getJobManagerContext.mockRejectedValueOnce(new FatalError('fatal'));
            const input = { jobRunId: 'run-1', dirsToScan: ['/foo'], isMigration: false };
            await expect(scanService.scanDirectories(input as any)).rejects.toBeInstanceOf(FatalError);
        });

        it('should clear heartbeat interval', async () => {
            const input = { jobRunId: 'run-1', dirsToScan: ['/foo'], isMigration: false };
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            await scanService.scanDirectories(input as any).catch(() => {});
            expect(clearIntervalSpy).toHaveBeenCalled();
        });
    });
});