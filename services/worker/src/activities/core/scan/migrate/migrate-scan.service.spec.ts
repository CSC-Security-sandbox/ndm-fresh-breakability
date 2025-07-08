import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import { getFileInfo, isContentUpdate, removePrefix, shouldExcludeOrSkip } from 'src/activities/utils/utils';
import { Origin } from 'src/activities/utils/utils.types';
import { FatalError } from 'src/errors/errors.types';
import { MigrateScanService } from './migrate-scan.service';

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

jest.mock('src/activities/utils/utils', () => ({
    dmError: jest.fn(),
    getFileInfo: jest.fn(),
    removePrefix: jest.fn(),
    shouldExcludeOrSkip: jest.fn(),
    isContentUpdate: jest.fn(),
}));

describe('MigrateScanService', () => {
    let service: MigrateScanService;
    let configService: ConfigService;
    let logger: Logger;
    let jobContext: any;
    let commandInput: any;

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

        logger = {
            debug: jest.fn(),
            error: jest.fn(),
        } as any;

        service = new MigrateScanService(configService, logger);

        jobContext = {
            publishToErrorStream: jest.fn(),
            publishToCommandStream: jest.fn(),
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

    // --- getDirContents ---
    describe('getDirContents', () => {
        it('should return directory contents', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
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
            (fs.existsSync as jest.Mock).mockReturnValue(false);
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
            (fs.existsSync as jest.Mock).mockReturnValue(false);
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
            expect(result).toBeInstanceOf(Command);
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
            expect(result).toBeInstanceOf(Command);
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
            expect(result).toBeInstanceOf(Command);
        });

        it('should return undefined if not content updated', () => {
            (isContentUpdate as jest.Mock).mockReturnValue(false);
            const result = service.buildCommand({} as any, 'file/path');
            expect(result).toBeUndefined();
        });
    });

    // --- publishCommands ---
    describe('publishCommands', () => {
        it('should call publishToCommandStream for each command in publishCommands', async () => {
            const commands = [new Command('a', {}, 'id1', 0), new Command('b', {}, 'id2', 0)];
            await service.publishCommands({ jobContext, commands });
            expect(jobContext.publishToCommandStream).toHaveBeenCalledTimes(2);
        });
    });

    // --- scanDirectory ---
    describe('scanDirectory', () => {
        it('should skip excluded items', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
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
            expect(jobContext.publishToCommandStream).not.toHaveBeenCalled();
        });

        it('should chunk commands and call publishCommands in scanDirectory', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
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

            expect(jobContext.publishToCommandStream).toHaveBeenCalledTimes(3);
        });

        it('should increment dirCount and subDirs for directories and publish command if not in target', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
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
            expect(jobContext.publishToCommandStream).toHaveBeenCalled();
        });

        it('should not increment dirCount for symlink directories', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
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
            (fs.existsSync as jest.Mock).mockReturnValue(true);
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
            expect(jobContext.publishToCommandStream).toHaveBeenCalled();
        });

        it('should build and publish command for file present in target if content updated', async () => {
            (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
                // simulate both source and target file exist
                return true;
            });
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
            (fs.statSync as jest.Mock).mockReturnValue({
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
            expect(jobContext.publishToCommandStream).toHaveBeenCalled();
        });

        it('should skip item if fs.existsSync returns false for sourceContentPath', async () => {
            // Only the directory exists, not the file inside
            (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/src');
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file1']);
            (shouldExcludeOrSkip as jest.Mock).mockReturnValue(false);

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ path, origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file1']);
                return new Set();
            });

            const result = await service.scanDirectory(commandInput);
            expect(result.fileCount).toBe(0);
            expect(jobContext.publishToCommandStream).not.toHaveBeenCalled();
        });

        it('should handle error and publish to error stream', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['badfile']);
            (fs.promises.lstat as jest.Mock).mockRejectedValue(new Error('fail'));

            await expect(service.scanDirectory(commandInput)).rejects.toThrow('fail');
            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should handle error thrown by buildCommand and publish to error stream', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
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
            (isContentUpdate as jest.Mock).mockImplementation(() => { throw new Error('buildCommand error'); });

            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ path, origin }) => {
                if (origin === Origin.SOURCE) return new Set(['file1']);
                return new Set();
            });

            await expect(service.scanDirectory(commandInput)).rejects.toThrow('buildCommand error');
            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should use TRANSIENT_ERROR if retryCount exceeds maxRetryCount', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
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

            const highRetryInput = {
                ...commandInput,
                command: { ...commandInput.command, retryCount: 3 }
            };

            await service.scanDirectory(highRetryInput);
            expect(jobContext.publishToCommandStream).toHaveBeenCalled();
        });

        it('should handle empty source directory gracefully', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.promises.readdir as jest.Mock).mockResolvedValue([]);
            jest.spyOn(service, 'getDirContents').mockImplementation(async ({ path, origin }) => {
                if (origin === Origin.SOURCE) return new Set();
                return new Set();
            });

            const result = await service.scanDirectory(commandInput);
            expect(result.fileCount).toBe(0);
            expect(result.dirCount).toBe(0);
            expect(result.subDirs).toHaveLength(0);
            expect(jobContext.publishToCommandStream).not.toHaveBeenCalled();
        });
    });
});