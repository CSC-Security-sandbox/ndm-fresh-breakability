import { Test, TestingModule } from '@nestjs/testing';
import { OPS_CMD, OPS_STATUS, ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import { StampAtimeService } from './stamp-atime.service';
import { StampMetaService } from './stamp-meta.service';
import { MetricsService } from 'src/metrics/metrics.service';
import { CommandExecInput } from './command-execution.type';

jest.mock('fs', () => ({
    promises: {
        lstat: jest.fn(),
        utimes: jest.fn(),
        lutimes: jest.fn(),
    },
}));

jest.mock('src/activities/utils/utils', () => ({
    dmError: jest.fn().mockReturnValue({ type: 'OPERATION' }),
}));

const mockLogger: Partial<LoggerService> = {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
};

describe('StampAtimeService', () => {
    let service: StampAtimeService;
    let stampMetaService: jest.Mocked<StampMetaService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;

    const mockFs = fs as jest.Mocked<typeof fs>;
    const sourceAtime = new Date('2024-06-01T12:00:00.000Z');
    const sourceMtime = new Date('2024-01-01T00:00:00.000Z');
    const destAtime = new Date('2023-01-01T00:00:00.000Z');

    const buildInput = (overrides: Partial<{ isSymLink: boolean; opStatus: OPS_STATUS; atime: Date | undefined; mtime: Date | undefined; destAtime: Date }> = {}): CommandExecInput => {
        const {
            isSymLink = false,
            opStatus = OPS_STATUS.READY,
            atime = sourceAtime,
            mtime = sourceMtime,
        } = overrides;

        const ops: Record<string, { status: OPS_STATUS; params: Record<string, unknown> }> = {
            [OPS_CMD.COPY_FILE]: { status: OPS_STATUS.COMPLETED, params: { targetExisted: true } },
            [OPS_CMD.STAMP_ATIME]: { status: opStatus, params: {} },
        };

        return {
            sourcePath: '/src/file.txt',
            targetPath: '/dst/file.txt',
            jobContext: {
                jobConfig: { jobRunId: 'wf-1', options: { preserveAccessTime: false } },
                jobRunId: 'wf-1',
                publishToErrorStream: jest.fn().mockResolvedValue(undefined),
            } as any,
            command: {
                id: 'cmd-1',
                fPath: '/file.txt',
                ops,
                metadata: {
                    atime,
                    mtime,
                    isSymLink,
                },
            } as any,
            errorType: ErrorType.RECOVERABLE_ERROR,
        };
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        loggerFactory = { create: jest.fn().mockReturnValue(mockLogger) } as any;
        stampMetaService = {
            preserveAccessAndModifiedTime: jest.fn().mockResolvedValue({ sourceErrors: [], targetErrors: [] }),
        } as any;

        const mockMetricsService = {
            runWithTiming: jest.fn().mockImplementation((_w: string, _s: unknown, fn: () => unknown) =>
                typeof fn === 'function' ? Promise.resolve(fn()) : Promise.resolve(),
            ),
        };

        (mockFs.promises.lstat as jest.Mock).mockResolvedValue({ atimeMs: destAtime.getTime() });
        (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);
        (mockFs.promises.lutimes as jest.Mock).mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StampAtimeService,
                { provide: StampMetaService, useValue: stampMetaService },
                { provide: MetricsService, useValue: mockMetricsService },
                { provide: LoggerFactory, useValue: loggerFactory },
            ],
        }).compile();

        service = module.get<StampAtimeService>(StampAtimeService);
    });

    describe('stampAtime', () => {
        it('calls utimes with metadata atime/mtime for a regular file when destination atime differs', async () => {
            const input = buildInput();
            const result = await service.stampAtime(input);

            expect(mockFs.promises.lstat).toHaveBeenCalledWith('/dst/file.txt');
            expect(mockFs.promises.utimes).toHaveBeenCalledTimes(1);
            expect(mockFs.promises.utimes).toHaveBeenCalledWith('/dst/file.txt', sourceAtime, sourceMtime);
            expect(mockFs.promises.lutimes).not.toHaveBeenCalled();
            expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.COMPLETED);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
        });

        it('calls lutimes (not utimes) for a symlink', async () => {
            const input = buildInput({ isSymLink: true });
            await service.stampAtime(input);

            expect(mockFs.promises.lutimes).toHaveBeenCalledTimes(1);
            expect(mockFs.promises.lutimes).toHaveBeenCalledWith('/dst/file.txt', sourceAtime, sourceMtime);
            expect(mockFs.promises.utimes).not.toHaveBeenCalled();
            expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.COMPLETED);
        });

        it('skips the syscall when destination atime already matches metadata atime (defensive re-check)', async () => {
            (mockFs.promises.lstat as jest.Mock).mockResolvedValue({ atimeMs: sourceAtime.getTime() });
            const input = buildInput();

            await service.stampAtime(input);

            expect(mockFs.promises.utimes).not.toHaveBeenCalled();
            expect(mockFs.promises.lutimes).not.toHaveBeenCalled();
            expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.COMPLETED);
        });

        it('returns early when the STAMP_ATIME op is missing', async () => {
            const input = buildInput();
            delete (input.command.ops as Record<string, unknown>)[OPS_CMD.STAMP_ATIME];

            await service.stampAtime(input);

            expect(mockFs.promises.lstat).not.toHaveBeenCalled();
            expect(mockFs.promises.utimes).not.toHaveBeenCalled();
        });

        it('returns early when the STAMP_ATIME op is already COMPLETED', async () => {
            const input = buildInput({ opStatus: OPS_STATUS.COMPLETED });

            await service.stampAtime(input);

            expect(mockFs.promises.lstat).not.toHaveBeenCalled();
            expect(mockFs.promises.utimes).not.toHaveBeenCalled();
        });

        it('marks op COMPLETED and skips syscall when metadata.atime is missing', async () => {
            const input = buildInput({ atime: undefined });

            await service.stampAtime(input);

            expect(mockFs.promises.lstat).not.toHaveBeenCalled();
            expect(mockFs.promises.utimes).not.toHaveBeenCalled();
            expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.COMPLETED);
        });

        it('marks op ERROR and publishes dmError when utimes throws', async () => {
            const err: NodeJS.ErrnoException = Object.assign(new Error('boom'), { code: 'EACCES' });
            (mockFs.promises.utimes as jest.Mock).mockRejectedValue(err);
            const input = buildInput();

            const result = await service.stampAtime(input);

            expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.ERROR);
            expect(result.targetErrors).toEqual(['EACCES']);
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalledTimes(1);
        });

        it('marks op ERROR when the defensive lstat fails', async () => {
            const err: NodeJS.ErrnoException = Object.assign(new Error('missing'), { code: 'ENOENT' });
            (mockFs.promises.lstat as jest.Mock).mockRejectedValue(err);
            const input = buildInput();

            const result = await service.stampAtime(input);

            expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.ERROR);
            expect(result.targetErrors).toEqual(['ENOENT']);
            expect(mockFs.promises.utimes).not.toHaveBeenCalled();
        });

        it('invokes preserveAccessAndModifiedTime in parallel (single round-trip when preserveAccessTime=true)', async () => {
            const input = buildInput();
            input.jobContext.jobConfig.options = { preserveAccessTime: true };

            await service.stampAtime(input);

            // The service always delegates source preservation to StampMetaService; the
            // option check itself lives inside preserveAccessAndModifiedTime so that
            // StampAtimeService stays agnostic to the option's gating logic.
            expect(stampMetaService.preserveAccessAndModifiedTime).toHaveBeenCalledTimes(1);
            expect(stampMetaService.preserveAccessAndModifiedTime).toHaveBeenCalledWith(input);
        });

        it('also delegates to preserveAccessAndModifiedTime when preserveAccessTime=false (gating lives in the helper)', async () => {
            const input = buildInput();
            input.jobContext.jobConfig.options = { preserveAccessTime: false };

            await service.stampAtime(input);

            // Mirrors StampMetaService routing: helper is always called; it returns
            // an empty StampMetaOutput when the option is off. This keeps the
            // execution path identical and verifiable.
            expect(stampMetaService.preserveAccessAndModifiedTime).toHaveBeenCalledTimes(1);
        });

        it('aggregates source errors from preserveAccessAndModifiedTime', async () => {
            stampMetaService.preserveAccessAndModifiedTime.mockResolvedValue({
                sourceErrors: ['EROFS'],
                targetErrors: [],
            });
            const input = buildInput();

            const result = await service.stampAtime(input);

            expect(result.sourceErrors).toEqual(['EROFS']);
            expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.ERROR);
        });
    });
});
