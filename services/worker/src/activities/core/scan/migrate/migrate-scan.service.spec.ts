import { ConfigService } from '@nestjs/config';
import { Cmd, Command, ErrorType, CommandStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import { dmError, getFileInfo, isContentUpdate, removePrefix, shouldExcludeOrSkip, shouldExcludeForDelete, checkCaseSensitiveConflict } from 'src/activities/utils/utils';
import { Operation, Origin } from 'src/activities/utils/utils.types';
import { FatalError } from 'src/errors/errors.types';
import { MigrateScanService } from './migrate-scan.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';
import { FileTypeDetectionService } from '../../utils/file-type-detection.service';

// --- Mocks ---
jest.mock('fs', () => {
    const actualFs = jest.requireActual('fs');
    return {
        ...actualFs,
        existsSync: jest.fn(),
        statSync: jest.fn(),
        promises: {
            readdir: jest.fn(),
            lstat: jest.fn(),
            stat: jest.fn(),
            access: jest.fn(),
        },
    };
});

jest.mock('path', () => {
    const actualPath = jest.requireActual('path');
    return {
        ...actualPath,
        join: jest.fn((...parts: string[]) => parts.join('/')),
    };
});

function createCaseSensitiveConflictMock() {
    return jest.fn().mockImplementation(async (
        jobType: string,
        item: string,
        lowerCaseSourceData: Set<string>,
        relativeSourcePath: string,
        sourceContentPath: string,
        command: any,
        jobContext: any,
        lowerCaseTargetData: Set<string>,
        targetContent: Set<string>,
        isDirectory: boolean
    ) => {
        const lowerCaseFileName = item.toLowerCase();
        if (lowerCaseSourceData.has(lowerCaseFileName) || 
            (lowerCaseTargetData?.has(lowerCaseFileName) && !targetContent?.has(item))) {
            const itemType = isDirectory ? 'Directory' : 'File';
            const dmErr = {
                error: {
                    message: `${itemType} not migrated: Another ${itemType.toLowerCase()} with same name but different case exists`
                }
            };
            await jobContext.publishToErrorStream(dmErr);
            return true;
        }
        lowerCaseSourceData.add(lowerCaseFileName);
        return false;
    });
}

jest.mock('src/activities/utils/utils', () => ({
    dmError: jest.fn((type, origin, operation, errorType, commandId, error, metadata) => ({
        type,
        origin,
        operation,
        errorType,
        commandId,
        error,
        metadata,
    })),
    getFileInfo: jest.fn(),
    removePrefix: jest.fn(),
    shouldExcludeOrSkip: jest.fn(),
    isContentUpdate: jest.fn(),
    isMetaUpdated: jest.fn(),
    shouldExcludeForDelete: jest.fn(),
    checkCaseSensitiveConflict: jest.fn(),
}));

describe('MigrateScanService', () => {
    let service: MigrateScanService;
    let configService: ConfigService;
    let logger: Partial<LoggerService>;
    let redisService: any;
    let jobContext: any;
    let commandInput: any;
    let fileTypeDetectionService: Partial<FileTypeDetectionService>;

    const mockLoggerFactory: Partial<LoggerFactory> = {
        create: jest.fn().mockReturnValue(mockLogger),
    };

    beforeEach(() => {
        configService = {
            get: jest.fn((key: string) => {
                const values = {
                    'worker.workerId': 'test-worker',
                    'worker.maxMigrationCommand': 2,
                    'worker.maxCommandConcurrency': 5,
                    'worker.maxRetryCount': 2,
                };
                return values[key];
            }),
        } as any;

        logger = mockLogger;
        fileTypeDetectionService = {
            detectFileType: jest.fn().mockResolvedValue('mockFileType'),
        } as Partial<FileTypeDetectionService>;

        service = new MigrateScanService(
            configService,
            mockLoggerFactory as LoggerFactory,
            fileTypeDetectionService as FileTypeDetectionService
        );

        jobContext = {
            publishToErrorStream: jest.fn(),
            publishToCommandStream: jest.fn(),
            publishBulkToCommandStream: jest.fn(),
            jobConfig: {
                options: {
                    excludeOlderThan: new Date('2023-01-01'),
                },
                jobType: 'MIGRATION',
            },
        };

        commandInput = {
            jobContext,
            command: { commandId: '123', retryCount: 0, fPath: '/src/a.txt' },
            sourcePath: '/src',
            targetPath: '/dst',
            sourcePrefix: '/src',
            settings: {
                excludePatterns: [],
                skipFile: 0,
            },
        };

        jest.clearAllMocks();
    });

        // --- scanDirectory with Trailing Spaces ---
    describe('scanDirectory - Trailing Space Detection', () => {
        it('should skip file with trailing spaces on Windows (SMB)', async () => {
            // Mock process.platform
            Object.defineProperty(process, 'platform', {
                value: 'win32',
                configurable: true,
            });

            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file-with-space.txt ']);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file-with-space.txt ']);
                return new Set();
            });

            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 1024,
                mtime: new Date(),
                mode: 33188,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });

            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);

            await service.scanDirectory(commandInput);

            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
            const errorCall = jobContext.publishToErrorStream.mock.calls[0][0];
            expect(errorCall.error?.code).toBe('ETRAILSPACE');
            expect(errorCall.error?.message).toContain('trailing spaces');
        });

        it('should skip file with trailing tab on Windows (SMB)', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'win32',
                configurable: true,
            });

            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file-with-tab.txt\t']);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file-with-tab.txt\t']);
                return new Set();
            });

            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 1024,
                mtime: new Date(),
                mode: 33188,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });

            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);

            await service.scanDirectory(commandInput);

            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
            const errorCall = jobContext.publishToErrorStream.mock.calls[0][0];
            expect(errorCall.error?.code).toBe('ETRAILSPACE');
        });

        it('should process file with trailing spaces on non-Windows platform', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'linux',
                configurable: true,
            });

            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file-with-space.txt ']);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file-with-space.txt ']);
                return new Set();
            });

            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });

            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/file' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);

            const result = await service.scanDirectory(commandInput);

            // File should be processed on non-Windows, not skipped
            expect(result.fileCount).toBe(1);
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalled();
        });

        it('should include proper error details in trailing space error', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'win32',
                configurable: true,
            });

            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['problem-file.pdf ']);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['problem-file.pdf ']);
                return new Set();
            });

            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 2048,
                mtime: new Date(),
                mode: 33188,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });

            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);

            await service.scanDirectory(commandInput);

            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
            const errorPublished = jobContext.publishToErrorStream.mock.calls[0][0];
            expect(errorPublished.type).toBe('OPERATION');
            expect(errorPublished.origin).toBe(Origin.SOURCE);
            expect(errorPublished.operation).toBe(Operation.READ_FILE);
            expect(errorPublished.errorType).toBe(ErrorType.TRANSIENT_ERROR);
        });

        it('should continue processing other files after skipping one with trailing spaces', async () => {
            Object.defineProperty(process, 'platform', {
                value: 'win32',
                configurable: true,
            });

            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue([
                'file-with-space.txt ',
                'normal-file.txt',
            ]);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file-with-space.txt ', 'normal-file.txt']);
                return new Set();
            });

            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });

            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/file' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);

            await service.scanDirectory(commandInput);

            // Should have one error for trailing space file
            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
            // Should process normal file
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalled();
        });
    });
    // --- getDirContents ---
    describe('getDirContents', () => {
        it('should return directory contents', async () => {
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file1', 'dir1']);

            const result = await service.getDirContents({
                path: '/mock',
                origin: Origin.SOURCE,
                jobContext,
                errorType: ErrorType.RECOVERABLE_ERROR,
                command: commandInput.command,
            });

            expect(result).toEqual(new Set(['file1', 'dir1']));
        });

        it('should return empty set for missing target dir', async () => {
            jest.spyOn(fs.promises, 'access').mockRejectedValue({ code: 'ENOENT' });
            const result = await service.getDirContents({
                path: '/missing',
                origin: Origin.DESTINATION,
                jobContext,
                errorType: ErrorType.RECOVERABLE_ERROR,
                command: commandInput.command,
            });
            expect(result).toEqual(new Set());
        });

        it('should throw for missing source dir', async () => {
            jest.spyOn(fs.promises, 'access').mockRejectedValue({ code: 'ENOENT' });
            await expect(
                service.getDirContents({
                    path: '/bad',
                    origin: Origin.SOURCE,
                    jobContext,
                    errorType: ErrorType.RECOVERABLE_ERROR,
                    command: commandInput.command,
                }),
            ).rejects.toThrow(FatalError);
            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
        });
    });

    // --- buildCommand ---
    describe('buildCommand', () => {
        it('should build command if content updated', () => {
            const mockStat = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 1,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            };
            (isContentUpdate as jest.Mock).mockReturnValue(true);
            const result = service.buildCommand(mockStat as any, 'file/path');
            expect(result).toBeInstanceOf(Cmd);
        });

        it('should build directory copy command if content updated and is directory', () => {
            const mockStat = {
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 1,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            };
            (isContentUpdate as jest.Mock).mockReturnValue(true);
            const result = service.buildCommand(mockStat as any, 'dir/path');
            expect(result).toBeInstanceOf(Cmd);
        });

        it('should build file copy command if content updated and is file', () => {
            const mockStat = {
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 1,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            };
            (isContentUpdate as jest.Mock).mockReturnValue(true);
            const result = service.buildCommand(mockStat as any, 'file/path');
            expect(result).toBeInstanceOf(Cmd);
        });

        it('should return undefined if not content updated', () => {
            const mockSFile = {
                isSymbolicLink: jest.fn().mockReturnValue(false),
            };
            (isContentUpdate as jest.Mock).mockReturnValue(false);
            const result = service.buildCommand(mockSFile as any, 'file/path');
            expect(result).toBeUndefined();
        });
    });

    // --- publishCommands ---
    describe('publishCommands', () => {
        it('should call publishBulkToCommandStream for bulk commands in publishCommands', async () => {
            const commands = [
                new Cmd('cmd1', '/src/file1', CommandStatus.READY, false, { COPY_FILE: { status: 'READY', params: {} } }),
                new Cmd('cmd2', '/src/file2', CommandStatus.READY, false, { COPY_FILE: { status: 'READY', params: {} } }),
            ];
            await service.publishCommands({ jobContext, commands });
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalledTimes(1);
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalledWith(commands);
        });
    });

    // --- scanDirectory ---
    describe('scanDirectory', () => {
        beforeEach(() => {
            service = new MigrateScanService(configService, mockLoggerFactory as LoggerFactory, fileTypeDetectionService as FileTypeDetectionService);
            (dmError as jest.Mock).mockImplementation((category, origin, operation, errorType, commandId, error, metadata) => ({
                category,
                origin,
                operation,
                errorType,
                commandId,
                error,
                metadata,
            }));
        });
        it('should skip excluded items', async () => {
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file1']);
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(true);
            const result = await service.scanDirectory(commandInput);
            expect(result.fileCount).toBe(0);
            expect(jobContext.publishBulkToCommandStream).not.toHaveBeenCalled();
        });

        it('should chunk commands and call publishCommands in scanDirectory', async () => {
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file1', 'file2', 'file3']);
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/path' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);

            service.getDirContents.bind(service);
            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ path, origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file1', 'file2', 'file3']);
                return new Set();
            });

            await service.scanDirectory(commandInput);

            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalledTimes(2);
        });

        it('should detect and skip files with case collisions in source directory on SMB', async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32' });

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file1.txt', 'File1.TXT', 'FILE1.txt', 'MyFolder', 'myfolder']);
                return new Set();
            });

            (fs.promises.lstat as jest.Mock).mockImplementation(async (path: string) => {
                const isDirectory = path.includes('Folder') || path.includes('folder');
                return {
                    isDirectory: () => isDirectory,
                    isSymbolicLink: () => false,
                    size: isDirectory ? 0 : 100,
                    mtime: new Date(),
                    mode: 777,
                    uid: 0,
                    gid: 0,
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                };
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/path' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);
            (checkCaseSensitiveConflict as jest.Mock).mockImplementation(createCaseSensitiveConflictMock());

            await service.scanDirectory(commandInput);

            expect(jobContext.publishToErrorStream).toHaveBeenCalledTimes(3);
            expect(jobContext.publishToErrorStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.objectContaining({
                        message: expect.stringContaining('same name but different case')
                    })
                })
            );

            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        fPath: expect.any(String),
                        isDir: false
                    }),
                    expect.objectContaining({
                        fPath: expect.any(String),
                        isDir: true
                    })
                ])
            );
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        });

        it('should handle case collision between source and target on SMB (cutover/incremental scenario)', async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32' });

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['MyFolder', 'File1.txt', 'TestDir.txt', 'testdir.txt']);
                if (origin === Origin.DESTINATION) return new Set(['myfolder', 'free.txt', 'file1.txt', 'testdir.txt']);
                return new Set();
            });

            (fs.promises.lstat as jest.Mock).mockImplementation(async (path: string) => {
                const isDirectory = path.includes('MyFolder') || path.includes('myfolder');
                return {
                    isDirectory: () => isDirectory,
                    isSymbolicLink: () => false,
                    size: isDirectory ? 0 : 100,
                    mtime: new Date(),
                    mode: 777,
                    uid: 0,
                    gid: 0,
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                };
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/path' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);
            (checkCaseSensitiveConflict as jest.Mock).mockImplementation(createCaseSensitiveConflictMock());

            await service.scanDirectory(commandInput);

            expect(jobContext.publishToErrorStream).toHaveBeenCalledTimes(3);
            expect(jobContext.publishToErrorStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.objectContaining({
                        message: expect.stringContaining('same name but different case')
                    })
                })
            );
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalledTimes(1);

            Object.defineProperty(process, 'platform', { value: originalPlatform });
        });


        it('should not check for case collisions on non-SMB platforms', async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'linux' });

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['File1.txt', 'file1.txt']);
                return new Set();
            });

            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/path' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);
            (checkCaseSensitiveConflict as jest.Mock).mockImplementation(createCaseSensitiveConflictMock());

            await service.scanDirectory(commandInput);

            expect(jobContext.publishToErrorStream).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    operation: expect.any(String),
                    origin: Origin.SOURCE
                })
            );

            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalled();
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        });

        it('should increment dirCount and subDirs for directories and publish command if not in target', async () => {
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['dir1']);
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => true,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/dir1' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ path, origin }) => {
                if (origin === Origin.SOURCE) return new Set(['dir1']);
                return new Set();
            });

            const result = await service.scanDirectory(commandInput);
            expect(result.dirCount).toBe(1);
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalled();
        });

        it('should not increment dirCount for symlink directories', async () => {
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['dir1']);
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => true,
                isSymbolicLink: () => true,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ path, origin }) => {
                if (origin === Origin.SOURCE) return new Set(['dir1']);
                return new Set();
            });

            const result = await service.scanDirectory(commandInput);
            expect(result.dirCount).toBe(0);
            expect(result.subDirs).toHaveLength(0);
        });

        it('should build and publish command for file not present in target', async () => {
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file1']);
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/file1' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ path, origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file1']);
                return new Set();
            });

            const result = await service.scanDirectory(commandInput);
            expect(result.fileCount).toBe(1);
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalled();
        });

        it('should build and publish command for file present in target if content updated', async () => {
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file1']);
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (fs.promises.stat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 50,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/file1' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ path, origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file1']);
                if (origin === Origin.DESTINATION) return new Set(['file1']);
                return new Set();
            });

            const result = await service.scanDirectory(commandInput);
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalled();
        });

        it('should skip item if isExists returns false for sourceContentPath', async () => {
            // Mock getDirContents to return source directory contents
            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file1']);
                return new Set();
            });
            
            // Mock lstat to throw error (isExists uses lstat internally and returns false on error)
            (fs.promises.lstat as jest.Mock).mockRejectedValue({ code: 'ENOENT' });
            
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);

            const result = await service.scanDirectory(commandInput);
            expect(result.fileCount).toBe(0);
            expect(jobContext.publishBulkToCommandStream).not.toHaveBeenCalled();
        });

        it('should handle error and publish to error stream', async () => {
            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['badfile']);
                return new Set();
            });
            
            // First lstat call for isExists returns successfully, second lstat call throws
            (fs.promises.lstat as jest.Mock)
                .mockResolvedValueOnce({
                    isDirectory: () => false,
                    isSymbolicLink: () => false,
                    size: 100,
                    mtime: new Date(),
                }) // isExists check passes
                .mockRejectedValueOnce(new Error('fail')); // actual lstat call fails

            await expect(service.scanDirectory(commandInput)).rejects.toThrow('fail');
            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should handle error thrown by buildCommand and publish to error stream', async () => {
            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file1']);
                return new Set();
            });
            
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/file1' });
            (isContentUpdate as jest.Mock).mockImplementation(() => { throw new Error('buildCommand error'); });

            await expect(service.scanDirectory(commandInput)).rejects.toThrow('buildCommand error');
            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should use TRANSIENT_ERROR if retryCount exceeds maxRetryCount', async () => {
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (getFileInfo as jest.Mock).mockResolvedValue({ path: 'mock/file1' });
            (isContentUpdate as jest.Mock).mockReturnValue(true);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ path, origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file1']);
                return new Set();
            });

            const highRetryInput = {
                ...commandInput,
                command: { ...commandInput.command, retryCount: 3 }
            };

            await service.scanDirectory(highRetryInput);
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalled();
        });

        it('should handle empty source directory gracefully', async () => {
            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                return new Set();
            });

            const result = await service.scanDirectory(commandInput);
            expect(result.fileCount).toBe(0);
            expect(result.dirCount).toBe(0);
            expect(result.subDirs).toHaveLength(0);
            expect(jobContext.publishBulkToCommandStream).not.toHaveBeenCalled();
        });
        it('should skip delete when skipDelete is true', async () => {
            jobContext.jobConfig.skipDelete = true;

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set();
                if (origin === Origin.DESTINATION) return new Set(['file1', 'file2']);
                return new Set();
            });
            
            (shouldExcludeForDelete as jest.Mock).mockReturnValue(false);
            
            await service.scanDirectory(commandInput);
            expect(jobContext.publishBulkToCommandStream).not.toHaveBeenCalled();
        });

        it('should handle command publishing in chunks during delete processing', async () => {
            jobContext.jobConfig.skipDelete = false;
            service = new MigrateScanService(configService, mockLoggerFactory as LoggerFactory, fileTypeDetectionService as FileTypeDetectionService);
            (service as any).maxMigrationCommand = 2;

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                if (origin === Origin.SOURCE) return new Set();
                if (origin === Origin.DESTINATION) return new Set(['file1', 'file2', 'file3']);
                return new Set();
            });
            
            jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
            (fs.promises.lstat as jest.Mock).mockResolvedValue({
                isDirectory: () => false,
                isSymbolicLink: () => false,
                size: 100,
                mtime: new Date(),
                mode: 777,
                uid: 0,
                gid: 0,
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
            });
            (removePrefix as jest.Mock).mockImplementation((full, prefix) => full.replace(prefix, ''));
            (shouldExcludeForDelete as jest.Mock).mockReturnValue(false);

            commandInput.targetPrefix = '/dst';
            await service.scanDirectory(commandInput);
            expect(jobContext.publishBulkToCommandStream).toHaveBeenCalledTimes(2);
        });

        it('should handle empty source directory', async () => {
            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin }) => {
                return new Set();
            });

            const result = await service.scanDirectory(commandInput);

            expect(result.fileCount).toBe(0);
            expect(result.dirCount).toBe(0);
            expect(result.subDirs).toEqual([]);
            expect(jobContext.publishBulkToCommandStream).not.toHaveBeenCalled();
        });

        it('should handle target directory that does not exist during delete processing', async () => {
            jobContext.jobConfig.skipDelete = false;

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ origin, path }) => {
                if (origin === Origin.SOURCE) return new Set();
                if (origin === Origin.DESTINATION && path === '/dst') return new Set(); // Empty set for non-existent directory
                return new Set();
            });

            const result = await service.scanDirectory(commandInput);

            expect(result).toBeDefined();
            expect(jobContext.publishBulkToCommandStream).not.toHaveBeenCalled();
        });
    });
});

// --- MigrateScanService ---
describe('MigrateScanService', () => {
    let service: MigrateScanService;
    let configService: ConfigService;
    let logger: Partial<LoggerService>;
    let jobContext: any;
    let commandInput: any;
    let fileTypeDetectionService: Partial<FileTypeDetectionService>;

    const mockLoggerFactory: Partial<LoggerFactory> = {
        create: jest.fn().mockReturnValue(mockLogger),
    };

    beforeEach(() => {
        configService = {
            get: jest.fn((key: string) => {
                const values = {
                    'worker.workerId': 'test-worker',
                    'worker.maxMigrationCommand': 2,
                    'worker.maxCommandConcurrency': 5,
                    'worker.maxRetryCount': 2,
                };
                return values[key];
            }),
        } as any;

        logger = mockLogger;

        fileTypeDetectionService = {
            detectFileType: jest.fn().mockResolvedValue('mockFileType'),
        } as Partial<FileTypeDetectionService>;

        service = new MigrateScanService(configService, mockLoggerFactory as LoggerFactory, fileTypeDetectionService as FileTypeDetectionService);

        jobContext = {
            publishToErrorStream: jest.fn(),
            publishToCommandStream: jest.fn(),
            publishBulkToCommandStream: jest.fn(),
            jobConfig: {
                options: {
                    excludeOlderThan: new Date('2023-01-01'),
                },
                jobType: 'MIGRATION',
            },
        };

        commandInput = {
            jobContext,
            command: { commandId: '123', retryCount: 0, fPath: '/src/a.txt' },
            sourcePath: '/src',
            targetPath: '/dst',
            sourcePrefix: '/src',
            settings: {
                excludePatterns: [],
                skipFile: 0,
            },
        };

        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should call publishBulkToCommandStream for sync command', async () => {
        const commands = [
            new Cmd('cmd1', '/src/file1', CommandStatus.READY, false, { SYNC_FILE: { status: 'READY', params: {} } }),
        ];
        await service.publishCommands({ jobContext, commands });
        expect(jobContext.publishBulkToCommandStream).toHaveBeenCalledTimes(1);
        expect(jobContext.publishBulkToCommandStream).toHaveBeenCalledWith(commands);
    });

    it('should handle error in publishCommands gracefully', async () => {
        jobContext.publishBulkToCommandStream.mockImplementation(() => { throw new Error('fail'); });
        const commands = [
            new Cmd('cmd1', '/src/file1', CommandStatus.READY, false, { SYNC_FILE: { status: 'READY', params: {} } }),
        ];
        await expect(service.publishCommands({ jobContext, commands })).rejects.toThrow('fail');
    });

    // Add more tests as needed for coverage, e.g. for scanDirectory, buildCommand, etc.
});