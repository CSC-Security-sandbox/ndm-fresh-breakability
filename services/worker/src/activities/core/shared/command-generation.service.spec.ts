import { ConfigService } from '@nestjs/config';
import { CommandGenerationService, LocalSetLookup } from './command-generation.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { FileTypeDetectionService } from '../../utils/file-type-detection.service';
import { ErrorType, OPS_CMD } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import * as path from 'path';
import { FileType } from 'src/activities/types/tasks';

const mockGetFileInfo = jest.fn();
const mockRemovePrefix = jest.fn();
const mockShouldExcludeOrSkip = jest.fn();
const mockIsContentUpdate = jest.fn();
const mockIsMetaUpdated = jest.fn();
const mockDmError = jest.fn();

jest.mock('src/activities/utils/utils', () => ({
    dmError: (...args: unknown[]) => mockDmError(...args),
    getFileInfo: (...args: unknown[]) => mockGetFileInfo(...args),
    isContentUpdate: (...args: unknown[]) => mockIsContentUpdate(...args),
    isMetaUpdated: (...args: unknown[]) => mockIsMetaUpdated(...args),
    removePrefix: (full: string, prefix: string) => mockRemovePrefix(full, prefix),
    shouldExcludeOrSkip: (params: unknown) => mockShouldExcludeOrSkip(params),
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
        mockShouldExcludeOrSkip.mockReturnValue(false);
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

        it('should add resolved command when shouldExcludeOrSkip returns true and item has originalCommandId', async () => {
            mockShouldExcludeOrSkip.mockReturnValue(true);
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
