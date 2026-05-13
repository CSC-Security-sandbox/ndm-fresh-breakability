/**
 * Component test: exercises StampAtimeService against real files in os.tmpdir().
 * No external services (SMB/NFS share, Redis, db-writer) are required — the goal
 * is to prove that the worker, given a STAMP_ATIME command, actually changes the
 * destination's atime via Node's fs.utimes / fs.lutimes on a real filesystem.
 *
 * The Jest `*.spec.ts` runner picks these up automatically alongside unit tests,
 * but the suite is gated by capability checks (e.g. lutimes availability for
 * symlinks) so it stays portable.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { OPS_CMD, OPS_STATUS, ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StampAtimeService } from './stamp-atime.service';
import { StampMetaService } from './stamp-meta.service';
import { MetricsService } from 'src/metrics/metrics.service';
import { CommandExecInput } from './command-execution.type';

jest.unmock('fs');

const mockLogger: Partial<LoggerService> = {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
};

const sourceAtime = new Date('2024-07-15T12:34:56.000Z');
const sourceMtime = new Date('2024-01-02T03:04:05.000Z');
const initialDestAtime = new Date('2020-01-01T00:00:00.000Z');
const initialDestMtime = new Date('2020-01-01T00:00:00.000Z');

const supportsLutimes = typeof (fs.promises as { lutimes?: unknown }).lutimes === 'function';

describe('StampAtimeService (component, real fs in os.tmpdir())', () => {
    let service: StampAtimeService;
    let tmpRoot: string;
    let publishedErrors: unknown[];

    const buildInput = (targetPath: string, isSymLink: boolean): CommandExecInput => {
        publishedErrors = [];
        return {
            sourcePath: targetPath,
            targetPath,
            jobContext: {
                jobConfig: { jobRunId: 'wf-component', options: { preserveAccessTime: false } },
                jobRunId: 'wf-component',
                publishToErrorStream: jest.fn(async (err: unknown) => {
                    publishedErrors.push(err);
                }),
            } as any,
            command: {
                id: 'cmd-component',
                fPath: path.basename(targetPath),
                ops: {
                    [OPS_CMD.STAMP_ATIME]: { status: OPS_STATUS.READY, params: {} },
                },
                metadata: {
                    atime: sourceAtime,
                    mtime: sourceMtime,
                    isSymLink,
                },
            } as any,
            errorType: ErrorType.RECOVERABLE_ERROR,
        };
    };

    beforeAll(async () => {
        tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stamp-atime-comp-'));

        const stampMetaService = {
            preserveAccessAndModifiedTime: jest.fn().mockResolvedValue({ sourceErrors: [], targetErrors: [] }),
        } as Partial<StampMetaService> as StampMetaService;

        const metricsService = {
            runWithTiming: jest.fn().mockImplementation((_w: string, _s: unknown, fn: () => unknown) =>
                typeof fn === 'function' ? Promise.resolve(fn()) : Promise.resolve(),
            ),
        } as unknown as MetricsService;

        const loggerFactory = { create: jest.fn().mockReturnValue(mockLogger) } as unknown as LoggerFactory;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StampAtimeService,
                { provide: StampMetaService, useValue: stampMetaService },
                { provide: MetricsService, useValue: metricsService },
                { provide: LoggerFactory, useValue: loggerFactory },
            ],
        }).compile();

        service = module.get<StampAtimeService>(StampAtimeService);
    });

    afterAll(async () => {
        await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    });

    it('aligns destination atime on a regular file', async () => {
        const target = path.join(tmpRoot, 'file.txt');
        await fs.promises.writeFile(target, 'hello');
        await fs.promises.utimes(target, initialDestAtime, initialDestMtime);

        const before = await fs.promises.lstat(target);
        expect(before.atimeMs).toBe(initialDestAtime.getTime());

        const input = buildInput(target, false);
        const result = await service.stampAtime(input);

        const after = await fs.promises.lstat(target);
        expect(after.atimeMs).toBe(sourceAtime.getTime());
        expect(after.mtimeMs).toBe(sourceMtime.getTime());
        expect(result.targetErrors).toEqual([]);
        expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.COMPLETED);
    });

    it('aligns destination atime on a directory', async () => {
        const target = path.join(tmpRoot, 'subdir');
        await fs.promises.mkdir(target);
        await fs.promises.utimes(target, initialDestAtime, initialDestMtime);

        const input = buildInput(target, false);
        await service.stampAtime(input);

        const after = await fs.promises.lstat(target);
        expect(after.atimeMs).toBe(sourceAtime.getTime());
        expect(after.isDirectory()).toBe(true);
    });

    (supportsLutimes ? it : it.skip)('aligns destination atime on a symlink (link node, not target)', async () => {
        const linkTargetFile = path.join(tmpRoot, 'link-target.txt');
        await fs.promises.writeFile(linkTargetFile, 'link target');
        const linkTargetUnchangedAtime = new Date('2018-08-08T08:08:08.000Z');
        const linkTargetUnchangedMtime = new Date('2018-08-08T08:08:08.000Z');
        await fs.promises.utimes(linkTargetFile, linkTargetUnchangedAtime, linkTargetUnchangedMtime);

        const link = path.join(tmpRoot, 'sym.lnk');
        await fs.promises.symlink(linkTargetFile, link);
        await (fs.promises as { lutimes: (p: string, a: Date, m: Date) => Promise<void> }).lutimes(
            link,
            initialDestAtime,
            initialDestMtime,
        );

        const input = buildInput(link, true);
        await service.stampAtime(input);

        const afterLink = await fs.promises.lstat(link);
        expect(afterLink.atimeMs).toBe(sourceAtime.getTime());
        // The link target file MUST be untouched.
        const afterLinkTarget = await fs.promises.stat(linkTargetFile);
        expect(afterLinkTarget.atimeMs).toBe(linkTargetUnchangedAtime.getTime());
        expect(afterLinkTarget.mtimeMs).toBe(linkTargetUnchangedMtime.getTime());
    });

    it('is idempotent: a second invocation when already aligned does not change timestamps', async () => {
        const target = path.join(tmpRoot, 'idempotent.txt');
        await fs.promises.writeFile(target, 'idem');
        await fs.promises.utimes(target, sourceAtime, sourceMtime);

        const before = await fs.promises.lstat(target);
        const input = buildInput(target, false);

        await service.stampAtime(input);

        const after = await fs.promises.lstat(target);
        expect(after.atimeMs).toBe(before.atimeMs);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.COMPLETED);
        // Defensive lstat re-check observed equal atime so no error stream activity.
        expect(publishedErrors).toEqual([]);
    });

    it('reports ENOENT and marks op ERROR when destination does not exist', async () => {
        const missing = path.join(tmpRoot, 'does-not-exist.txt');
        const input = buildInput(missing, false);

        const result = await service.stampAtime(input);

        expect(result.targetErrors).toContain('ENOENT');
        expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.ERROR);
        expect(publishedErrors.length).toBeGreaterThan(0);
    });
});
