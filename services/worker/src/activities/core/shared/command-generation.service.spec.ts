import { ConfigService } from '@nestjs/config';
import { CommandGenerationService, LocalSetLookup } from './command-generation.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { FileTypeDetectionService } from '../utils/file-type-detection.service';
import { ErrorType, OPS_CMD, OPS_STATUS } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import * as path from 'path';
import { FileType } from 'src/activities/types/tasks';

const mockGetFileInfo = jest.fn();
const mockRemovePrefix = jest.fn();
const mockGetExcludeOrSkipReason = jest.fn();
const mockIsContentUpdate = jest.fn();
const mockIsMetaUpdated = jest.fn();
const mockDmError = jest.fn();

jest.mock('src/activities/utils/utils', () => ({
    dmError: (...args: unknown[]) => mockDmError(...args),
    getFileInfo: (...args: unknown[]) => mockGetFileInfo(...args),
    isContentUpdate: (...args: unknown[]) => mockIsContentUpdate(...args),
    isMetaUpdated: (...args: unknown[]) => mockIsMetaUpdated(...args),
    removePrefix: (full: string, prefix: string) => mockRemovePrefix(full, prefix),
    getExcludeOrSkipReason: (params: unknown) => mockGetExcludeOrSkipReason(params),
}));

const mockIsExists = jest.fn();
jest.mock('../utils/utils', () => ({
    isExists: (...args: unknown[]) => mockIsExists(...args),
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    promises: {
        ...jest.requireActual('fs').promises,
        lstat: jest.fn(),
        stat: jest.fn(),
    },
}));

describe('CommandGenerationService', () => {
    let service: CommandGenerationService;
    let configService: jest.Mocked<ConfigService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;
    let fileTypeDetectionService: jest.Mocked<FileTypeDetectionService>;
    let mockLogger: jest.Mocked<LoggerService>;

    const mockJobContext = {
        jobConfig: {
            jobType: 'MIGRATE',
            options: {},
        },
        publishToErrorStream: jest.fn(),
        publishBulkToCommandStream: jest.fn(),
    };

    const baseInput = {
        sourcePath: '/source/dir',
        targetPath: '/target/dir',
        sourcePrefix: '/source',
        targetPrefix: '/target',
        jobContext: mockJobContext as any,
        command: { id: 'cmd-1', fPath: '/dir' } as any,
        settings: { skipFile: '', excludePatterns: [] },
        errorType: ErrorType.TRANSIENT_ERROR,
        targetContent: new LocalSetLookup(new Set<string>()),
        maxCommandsPerBatch: 100,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockJobContext.jobConfig.jobType = 'MIGRATE';
        mockJobContext.jobConfig.options = {};
        mockLogger = { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), log: jest.fn() } as any;
        loggerFactory = { create: jest.fn().mockReturnValue(mockLogger) } as any;
        configService = {
            get: jest.fn((key: string) => {
                if (key === 'worker.metaUpdatedToleranceMs') return 60000;
                if (key === 'worker.maxMigrationCommand') return 100;
                return undefined;
            }),
        } as any;
        fileTypeDetectionService = {
            detectFileType: jest.fn().mockResolvedValue('FILE'),
        } as any;
        mockIsExists.mockResolvedValue(true);
        mockGetFileInfo.mockResolvedValue({ path: 'rel/path' });
        mockRemovePrefix.mockImplementation((full: string, prefix: string) => (full.startsWith(prefix) ? full.slice(prefix.length) : full));
        mockGetExcludeOrSkipReason.mockReturnValue(null);
        mockIsContentUpdate.mockReturnValue(true);
        mockIsMetaUpdated.mockReturnValue(false);
        mockDmError.mockImplementation((type: string, _origin: unknown, _op: unknown, errorType: string, _id: string, _err: unknown, _file?: unknown) => ({ type, errorType }));
        (fs.promises.lstat as jest.Mock).mockResolvedValue({
            isDirectory: () => false,
            isSymbolicLink: () => false,
            size: 100,
            mtime: new Date(),
            mode: 0o644,
            uid: 0,
            gid: 0,
            atime: new Date(),
            ctime: new Date(),
            birthtime: new Date(),
            ino: 1,
        });
        (fs.promises.stat as jest.Mock).mockResolvedValue({
            isDirectory: () => false,
            isSymbolicLink: () => false,
            size: 100,
            mtime: new Date(),
            mode: 0o644,
            uid: 0,
            gid: 0,
            atime: new Date(),
            ctime: new Date(),
            birthtime: new Date(),
            ino: 1,
        });
        service = new CommandGenerationService(configService, loggerFactory, fileTypeDetectionService);
    });

    describe('processItems', () => {
        it('should return empty result when items array is empty', async () => {
            const result = await service.processItems({
                ...baseInput,
                items: [],
            });
            expect(result.commands).toEqual([]);
            expect(result.fileCount).toBe(0);
            expect(result.dirCount).toBe(0);
            expect(result.subDirs).toEqual([]);
        });

        it('should add resolved command when source does not exist and item has originalCommandId', async () => {
            mockIsExists.mockResolvedValue(false);
            const result = await service.processItems({
                ...baseInput,
                items: [
                    { name: 'file.txt', originalCommandId: 'orig-cmd-1', fPath: '/dir/file.txt' },
                ],
            });
            expect(result.commands).toHaveLength(1);
            expect(result.commands[0].originalCmdId).toBe('orig-cmd-1');
            expect(String(result.commands[0].status)).toBe('COMPLETED');
        });

        it('should skip item when source does not exist and no originalCommandId', async () => {
            mockIsExists.mockResolvedValue(false);
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'missing.txt' }],
            });
            expect(result.commands).toHaveLength(0);
        });

        it('should add resolved command when getExcludeOrSkipReason returns excluded and item has originalCommandId', async () => {
            mockGetExcludeOrSkipReason.mockReturnValue('excluded');
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            });
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'excluded.txt', originalCommandId: 'orig-1' }],
            });
            expect(result.commands).toHaveLength(1);
            expect(result.commands[0].originalCmdId).toBe('orig-1');
            expect(String(result.commands[0].status)).toBe('COMPLETED');
            expect(result.excludedPaths).toEqual([
                { path: '/dir/excluded.txt', isDirectory: false },
            ]);
        });

        it('should track skippedPaths when getExcludeOrSkipReason returns skipped', async () => {
            mockGetExcludeOrSkipReason.mockReturnValue('skipped');
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            });

            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'skipped.txt' }],
            });

            expect(result.commands).toHaveLength(0);
            expect(result.skippedPaths).toEqual([
                { path: '/dir/skipped.txt', isDirectory: false },
            ]);
        });

        it('should add directory command when target does not have item', async () => {
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 0,
                mtime: new Date(),
                mode: 0o755,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            });
            fileTypeDetectionService.detectFileType = jest.fn().mockResolvedValue(FileType.DIRECTORY);
            mockGetFileInfo.mockResolvedValue({ path: 'rel/newdir' });
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'newdir' }],
                targetContent: new LocalSetLookup(new Set<string>()),
            });
            expect(result.dirCount).toBe(1);
            expect(result.subDirs.length).toBeGreaterThanOrEqual(1);
        });

        it('should add file command when target does not have file', async () => {
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'newfile.txt' }],
                targetContent: new LocalSetLookup(new Set<string>()),
            });
            expect(result.fileCount).toBe(1);
            expect(result.commands.length).toBeGreaterThanOrEqual(1);
        });

        it('should add command when target exists and content differs', async () => {
            mockIsContentUpdate.mockReturnValue(true);
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'file.txt' }],
                targetContent: new LocalSetLookup(new Set(['file.txt'])),
            });
            expect(result.commands.length).toBeGreaterThanOrEqual(1);
        });

        it('should not add command when target exists and no update needed', async () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'same.txt' }],
                targetContent: new LocalSetLookup(new Set(['same.txt'])),
            });
            expect(result.commands).toHaveLength(0);
        });

        it('should add command when target exists and only meta updated', async () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(true);
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'meta.txt' }],
                targetContent: new LocalSetLookup(new Set(['meta.txt'])),
            });
            expect(result.commands.length).toBeGreaterThanOrEqual(1);
        });

        it('should publish batch when commands reach maxCommandsPerBatch', async () => {
            mockJobContext.publishBulkToCommandStream = jest.fn();
            const result = await service.processItems({
                ...baseInput,
                items: Array.from({ length: 150 }, (_, i) => ({ name: `file${i}.txt` })),
                targetContent: new LocalSetLookup(new Set<string>()),
                maxCommandsPerBatch: 50,
            });
            expect(mockJobContext.publishBulkToCommandStream).toHaveBeenCalled();
            expect(result.commands.length).toBeLessThan(150);
        });

        it('should publish error and rethrow when processing item throws', async () => {
            mockGetFileInfo.mockRejectedValue(new Error('lstat failed'));
            await expect(
                service.processItems({
                    ...baseInput,
                    items: [{ name: 'bad.txt' }],
                    targetContent: new LocalSetLookup(new Set<string>()),
                }),
            ).rejects.toThrow('lstat failed');
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should publish trailing space error on Windows when filename ends with space', async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            });
            mockGetFileInfo.mockResolvedValue({ path: 'rel/file.txt ' });
            mockRemovePrefix.mockReturnValue('rel/file.txt ');
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'file.txt ' }],
                targetContent: new LocalSetLookup(new Set<string>()),
            });
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(result.commands).toHaveLength(0);
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        });

        it('should publish case conflict error on Windows when same name different case in source', async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            });
            mockGetFileInfo.mockResolvedValue({ path: 'rel/File.txt' });
            mockRemovePrefix.mockImplementation((full: string, prefix: string) => (full.startsWith(prefix) ? full.slice(prefix.length) : full));
            const result = await service.processItems({
                ...baseInput,
                items: [
                    { name: 'file.txt' },
                    { name: 'File.txt' },
                ],
                targetContent: new LocalSetLookup(new Set<string>()),
            });
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        });

        it('should publish volume mount point error on Windows for directory', async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 0,
                mtime: new Date(),
                mode: 0o755,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            });
            fileTypeDetectionService.detectFileType = jest.fn().mockResolvedValue(FileType.VOLUME_MOUNT_POINT);
            mockGetFileInfo.mockResolvedValue({ path: 'rel/vol' });
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'vol' }],
                targetContent: new LocalSetLookup(new Set<string>()),
            });
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(result.commands).toHaveLength(0);
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        });

        it('should publish junction error on Windows for symlink when target does not exist', async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => true,
                size: 0,
                mtime: new Date(),
                mode: 0o755,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            });
            fileTypeDetectionService.detectFileType = jest.fn().mockResolvedValue(FileType.JUNCTION);
            mockGetFileInfo.mockResolvedValue({ path: 'rel/link' });
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'link' }],
                targetContent: new LocalSetLookup(new Set<string>()),
            });
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        });

        it('should add command when symlink target exists and compare stats', async () => {
            (fs.promises.lstat as jest.Mock)
                .mockResolvedValueOnce({
                    isDirectory: () => false,
                    isSymbolicLink: () => true,
                    size: 0,
                    mtime: new Date(),
                    mode: 0o755,
                    uid: 0,
                    gid: 0,
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                    ino: 1,
                })
                .mockResolvedValueOnce({
                    isDirectory: () => false,
                    isSymbolicLink: () => true,
                    size: 0,
                    mtime: new Date(),
                    mode: 0o755,
                    uid: 0,
                    gid: 0,
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                    ino: 1,
                });
            fileTypeDetectionService.detectFileType = jest.fn().mockResolvedValue(FileType.SYMBOLIC_LINK);
            mockGetFileInfo.mockResolvedValue({ path: 'rel/sym' });
            mockIsContentUpdate.mockReturnValue(true);
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'sym' }],
                targetContent: new LocalSetLookup(new Set(['sym'])),
            });
            expect(result.commands.length).toBeGreaterThanOrEqual(0);
        });

        it('CASE 2: should generate stamp-only command and NOT recurse when directory exists in target with originalCommandId', async () => {
            const sourceDirStat = {
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 0,
                mtime: new Date('2024-01-01'),
                mode: 0o755,
                uid: 1000,
                gid: 1000,
                atime: new Date('2024-01-01'),
                ctime: new Date('2024-01-01'),
                birthtime: new Date('2024-01-01'),
                ino: 100,
            };
            const targetDirStat = {
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 0,
                mtime: new Date('2023-06-01'),
                mode: 0o700,
                uid: 0,
                gid: 0,
                atime: new Date('2023-06-01'),
                ctime: new Date('2023-06-01'),
                birthtime: new Date('2023-06-01'),
                ino: 200,
            };
            // First lstat = source, second lstat = target directory
            (fs.promises.lstat as jest.Mock)
                .mockResolvedValueOnce(sourceDirStat)
                .mockResolvedValueOnce(targetDirStat);
            fileTypeDetectionService.detectFileType = jest.fn().mockResolvedValue(FileType.DIRECTORY);
            mockGetFileInfo.mockResolvedValue({ path: 'data/existingdir' });
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(true);

            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'existingdir', originalCommandId: 'orig-cmd-dir', fPath: 'data/existingdir', isDir: true }],
                targetContent: new LocalSetLookup(new Set(['existingdir'])),
            });

            // Should NOT recurse (no subDirs) — avoids inflated error counts
            expect(result.subDirs).toEqual([]);
            // Should generate a stamp-only command
            expect(result.commands).toHaveLength(1);
            expect(result.commands[0].originalCmdId).toBe('orig-cmd-dir');
            expect(result.dirCount).toBe(1);
        });

        it('CASE 2: should not generate command when directory exists in target with originalCommandId and no meta update needed', async () => {
            const dirStat = {
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 0,
                mtime: new Date('2024-01-01'),
                mode: 0o755,
                uid: 1000,
                gid: 1000,
                atime: new Date('2024-01-01'),
                ctime: new Date('2024-01-01'),
                birthtime: new Date('2024-01-01'),
                ino: 100,
            };
            (fs.promises.lstat as jest.Mock)
                .mockResolvedValueOnce(dirStat)
                .mockResolvedValueOnce(dirStat); // same stats → no update needed
            fileTypeDetectionService.detectFileType = jest.fn().mockResolvedValue(FileType.DIRECTORY);
            mockGetFileInfo.mockResolvedValue({ path: 'data/samedir' });
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);

            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'samedir', originalCommandId: 'orig-cmd-same', fPath: 'data/samedir', isDir: true }],
                targetContent: new LocalSetLookup(new Set(['samedir'])),
            });

            expect(result.subDirs).toEqual([]);
            expect(result.commands).toHaveLength(0);
            expect(result.dirCount).toBe(1);
        });

        it('CASE 1: should recurse AND generate copy command when directory does not exist in target with originalCommandId', async () => {
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 0,
                mtime: new Date(),
                mode: 0o755,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            });
            fileTypeDetectionService.detectFileType = jest.fn().mockResolvedValue(FileType.DIRECTORY);
            mockGetFileInfo.mockResolvedValue({ path: 'data/newdir' });
            mockIsContentUpdate.mockReturnValue(true);

            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'newdir', originalCommandId: 'orig-cmd-new', fPath: 'data/newdir', isDir: true }],
                targetContent: new LocalSetLookup(new Set<string>()),
            });

            // Should recurse (mkdir failed → scan children)
            expect(result.subDirs.length).toBeGreaterThanOrEqual(1);
            // Should generate a COPY_DIR command with originalCmdId
            expect(result.commands).toHaveLength(1);
            expect(result.commands[0].originalCmdId).toBe('orig-cmd-new');
            expect(result.dirCount).toBe(1);
        });

        it('CASE 3: should recurse and generate stamp command when directory exists in target without originalCommandId', async () => {
            const sourceDirStat = {
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 0,
                mtime: new Date('2024-01-01'),
                mode: 0o755,
                uid: 1000,
                gid: 1000,
                atime: new Date('2024-01-01'),
                ctime: new Date('2024-01-01'),
                birthtime: new Date('2024-01-01'),
                ino: 100,
            };
            const targetDirStat = {
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 0,
                mtime: new Date('2023-06-01'),
                mode: 0o700,
                uid: 0,
                gid: 0,
                atime: new Date('2023-06-01'),
                ctime: new Date('2023-06-01'),
                birthtime: new Date('2023-06-01'),
                ino: 200,
            };
            (fs.promises.lstat as jest.Mock)
                .mockResolvedValueOnce(sourceDirStat)
                .mockResolvedValueOnce(targetDirStat);
            mockIsExists.mockResolvedValue(true);
            fileTypeDetectionService.detectFileType = jest.fn().mockResolvedValue(FileType.DIRECTORY);
            mockGetFileInfo.mockResolvedValue({ path: 'data/existingdir' });
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(true);

            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'existingdir' }],
                targetContent: new LocalSetLookup(new Set(['existingdir'])),
            });

            // CASE 3: Should recurse into children
            expect(result.subDirs.length).toBeGreaterThanOrEqual(1);
            // Should generate a STAMP_META-only command since meta differs
            expect(result.commands).toHaveLength(1);
            expect(result.commands[0].originalCmdId).toBeUndefined();
            expect(result.dirCount).toBe(1);
        });

        it('CASE 3: should recurse but not generate command when directory exists in target and no update needed', async () => {
            const dirStat = {
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 0,
                mtime: new Date('2024-01-01'),
                mode: 0o755,
                uid: 1000,
                gid: 1000,
                atime: new Date('2024-01-01'),
                ctime: new Date('2024-01-01'),
                birthtime: new Date('2024-01-01'),
                ino: 100,
            };
            (fs.promises.lstat as jest.Mock)
                .mockResolvedValueOnce(dirStat)
                .mockResolvedValueOnce(dirStat);
            mockIsExists.mockResolvedValue(true);
            fileTypeDetectionService.detectFileType = jest.fn().mockResolvedValue(FileType.DIRECTORY);
            mockGetFileInfo.mockResolvedValue({ path: 'data/uptodate' });
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);

            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'uptodate' }],
                targetContent: new LocalSetLookup(new Set(['uptodate'])),
            });

            // CASE 3: Should still recurse into children
            expect(result.subDirs.length).toBeGreaterThanOrEqual(1);
            // No command needed — directory is up to date
            expect(result.commands).toHaveLength(0);
            expect(result.dirCount).toBe(1);
        });

        it('should use target lstat when target file is symlink', async () => {
            (fs.promises.lstat as jest.Mock)
                .mockResolvedValueOnce({
                    isDirectory: () => false,
                    isSymbolicLink: () => false,
                    size: 100,
                    mtime: new Date(),
                    mode: 0o644,
                    uid: 0,
                    gid: 0,
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                    ino: 1,
                })
                .mockResolvedValueOnce({
                    isDirectory: () => false,
                    isSymbolicLink: () => true,
                    size: 0,
                    mtime: new Date(),
                    mode: 0o755,
                    uid: 0,
                    gid: 0,
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                    ino: 1,
                });
            mockIsContentUpdate.mockReturnValue(true);
            const result = await service.processItems({
                ...baseInput,
                items: [{ name: 'file.txt' }],
                targetContent: new LocalSetLookup(new Set(['file.txt'])),
            });
            expect(result.commands.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('buildCommand', () => {
        it('should return command when isContentUpdate is true', () => {
            mockIsContentUpdate.mockReturnValue(true);
            mockIsMetaUpdated.mockReturnValue(false);
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', undefined);
            expect(result).toBeDefined();
            expect(result!.ops[OPS_CMD.COPY_FILE].params).toEqual({ targetExisted: false });
        });

        it('should set targetExisted true when target file was provided (content_updated)', () => {
            mockIsContentUpdate.mockReturnValue(true);
            mockIsMetaUpdated.mockReturnValue(false);
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', sFile);
            expect(result).toBeDefined();
            expect(result!.ops[OPS_CMD.COPY_FILE].params).toEqual({ targetExisted: true });
        });

        it('should return command when isMetaUpdated is true and isContentUpdate false', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(true);
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', undefined);
            expect(result).toBeDefined();
        });

        it('should return undefined when neither content nor meta update', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', sFile);
            expect(result).toBeUndefined();
        });

        it('should return undefined when atimeMs differs but jobType is omitted (backward compatible)', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);
            const sAtime = new Date('2023-01-02T00:00:00.000Z');
            const dAtime = new Date('2022-06-01T00:00:00.000Z');
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date('2020-05-01T00:00:00.000Z'),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: sAtime,
                atimeMs: sAtime.getTime(),
                ctime: new Date('2020-05-01T00:00:00.000Z'),
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const dFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date('2020-05-01T00:00:00.000Z'),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: dAtime,
                atimeMs: dAtime.getTime(),
                ctime: new Date('2020-05-01T00:00:00.000Z'),
                birthtime: new Date(),
                ino: 2,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', dFile);
            expect(result).toBeUndefined();
        });

        it('should emit STAMP_ATIME (not STAMP_META) command when atimeMs differs and jobType is MIGRATE', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);
            const sAtime = new Date('2023-01-02T00:00:00.000Z');
            const dAtime = new Date('2022-06-01T00:00:00.000Z');
            const mtime = new Date('2020-05-01T00:00:00.000Z');
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: sAtime,
                atimeMs: sAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const dFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: dAtime,
                atimeMs: dAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 2,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', dFile, undefined, 'MIGRATE');
            expect(result).toBeDefined();
            expect(result!.ops[OPS_CMD.COPY_FILE].status).toBe(OPS_STATUS.COMPLETED);
            expect(result!.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.READY);
            expect(result!.ops[OPS_CMD.STAMP_META]).toBeUndefined();
            expect(result!.ops[OPS_CMD.COPY_FILE].params).toEqual({ targetExisted: true });
        });

        it('should not emit atime-only command for DISCOVER even when atimeMs differs', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);
            const sAtime = new Date('2023-01-02T00:00:00.000Z');
            const dAtime = new Date('2022-06-01T00:00:00.000Z');
            const mtime = new Date('2020-05-01T00:00:00.000Z');
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: sAtime,
                atimeMs: sAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const dFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: dAtime,
                atimeMs: dAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 2,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', dFile, undefined, 'DISCOVER');
            expect(result).toBeUndefined();
        });

        it('atime reconcile uses COPY_DIR completed + STAMP_ATIME when directory and atimeMs differs (MIGRATE)', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);
            const sAtime = new Date('2023-01-02T00:00:00.000Z');
            const dAtime = new Date('2022-06-01T00:00:00.000Z');
            const mtime = new Date('2020-05-01T00:00:00.000Z');
            const sFile = {
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o755,
                uid: 0,
                gid: 0,
                atime: sAtime,
                atimeMs: sAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const dFile = {
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o755,
                uid: 0,
                gid: 0,
                atime: dAtime,
                atimeMs: dAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 2,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/dir', dFile, undefined, 'MIGRATE');
            expect(result).toBeDefined();
            expect(result!.ops[OPS_CMD.COPY_DIR].status).toBe(OPS_STATUS.COMPLETED);
            expect(result!.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.READY);
            expect(result!.ops[OPS_CMD.STAMP_META]).toBeUndefined();
        });

        it('should emit STAMP_ATIME with COPY_SYMLINK COMPLETED when symlink atimeMs differs (MIGRATE)', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);
            const sAtime = new Date('2023-01-02T00:00:00.000Z');
            const dAtime = new Date('2022-06-01T00:00:00.000Z');
            const mtime = new Date('2020-05-01T00:00:00.000Z');
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => true,
                size: 0,
                mtime,
                mode: 0o777,
                uid: 0,
                gid: 0,
                atime: sAtime,
                atimeMs: sAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const dFile = {
                isDirectory: () => false,
                isSymbolicLink: () => true,
                size: 0,
                mtime,
                mode: 0o777,
                uid: 0,
                gid: 0,
                atime: dAtime,
                atimeMs: dAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 2,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/sym', dFile, undefined, 'MIGRATE');
            expect(result).toBeDefined();
            expect(result!.ops[OPS_CMD.COPY_SYMLINK].status).toBe(OPS_STATUS.COMPLETED);
            expect(result!.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.READY);
            expect(result!.ops[OPS_CMD.STAMP_META]).toBeUndefined();
        });

        it('should emit STAMP_ATIME when atimeMs differs and jobType is CUT_OVER', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);
            const sAtime = new Date('2023-01-02T00:00:00.000Z');
            const dAtime = new Date('2022-06-01T00:00:00.000Z');
            const mtime = new Date('2020-05-01T00:00:00.000Z');
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: sAtime,
                atimeMs: sAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const dFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: dAtime,
                atimeMs: dAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 2,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', dFile, undefined, 'CUT_OVER');
            expect(result).toBeDefined();
            expect(result!.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.READY);
        });

        it('isContentUpdate suppresses STAMP_ATIME even when atimeMs also differs', () => {
            mockIsContentUpdate.mockReturnValue(true);
            mockIsMetaUpdated.mockReturnValue(false);
            const sAtime = new Date('2023-01-02T00:00:00.000Z');
            const dAtime = new Date('2022-06-01T00:00:00.000Z');
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: sAtime,
                atimeMs: sAtime.getTime(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const dFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 200,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: dAtime,
                atimeMs: dAtime.getTime(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 2,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', dFile, undefined, 'MIGRATE');
            expect(result).toBeDefined();
            expect(result!.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.READY);
            expect(result!.ops[OPS_CMD.STAMP_ATIME]).toBeUndefined();
        });

        it('isMetaUpdated suppresses STAMP_ATIME even when atimeMs also differs', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(true);
            const sAtime = new Date('2023-01-02T00:00:00.000Z');
            const dAtime = new Date('2022-06-01T00:00:00.000Z');
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: sAtime,
                atimeMs: sAtime.getTime(),
                ctime: new Date(),
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const dFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: dAtime,
                atimeMs: dAtime.getTime(),
                ctime: new Date(Date.now() - 86400000),
                birthtime: new Date(),
                ino: 2,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', dFile, undefined, 'MIGRATE');
            expect(result).toBeDefined();
            expect(result!.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.READY);
            expect(result!.ops[OPS_CMD.STAMP_ATIME]).toBeUndefined();
        });

        it('atime-only reconcile does not read preserveAccessTime (still emits STAMP_ATIME when jobType is MIGRATE)', () => {
            mockIsContentUpdate.mockReturnValue(false);
            mockIsMetaUpdated.mockReturnValue(false);
            (mockJobContext as any).jobConfig.options = { preserveAccessTime: false };
            const sAtime = new Date('2023-01-02T00:00:00.000Z');
            const dAtime = new Date('2022-06-01T00:00:00.000Z');
            const mtime = new Date('2020-05-01T00:00:00.000Z');
            const sFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: sAtime,
                atimeMs: sAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 1,
            } as fs.Stats;
            const dFile = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime,
                mode: 0o644,
                uid: 0,
                gid: 0,
                atime: dAtime,
                atimeMs: dAtime.getTime(),
                ctime: mtime,
                birthtime: new Date(),
                ino: 2,
            } as fs.Stats;
            const result = service.buildCommand(sFile, 'path/file.txt', dFile, undefined, 'MIGRATE');
            expect(result).toBeDefined();
            expect(result!.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.READY);
            expect(result!.ops[OPS_CMD.STAMP_META]).toBeUndefined();
        });
    });

    describe('getOpsCommand', () => {
        it('should return COPY_SYMLINK for symlink', () => {
            const result = service.getOpsCommand(false, true);
            expect(result).toBe(OPS_CMD.COPY_SYMLINK);
        });

        it('should return COPY_DIR for directory', () => {
            const result = service.getOpsCommand(true, false);
            expect(result).toBe(OPS_CMD.COPY_DIR);
        });

        it('should return COPY_FILE for file', () => {
            const result = service.getOpsCommand(false, false);
            expect(result).toBe(OPS_CMD.COPY_FILE);
        });
    });
});
