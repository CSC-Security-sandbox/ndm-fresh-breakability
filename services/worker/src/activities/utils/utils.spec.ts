import * as fs from 'fs';
import * as path from 'path';
import {
    removePrefix,
    getFilePermissions,
    shouldExclude,
    shouldSkipFile,
    shouldExcludeOlderThan,
    shouldExcludeOrSkip,
    getFileType,
    isContentUpdate,
    isMetaUpdated,
    getErrorCode,
    formatDate
} from './utils';
import { JobContext, JobContextFactory } from "@netapp-cloud-datamigrate/jobs-lib";
import { FileType } from '../types/tasks';

jest.mock('fs');
jest.mock('crypto');
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    promises: {
        lstat: jest.fn(),
    }
}));
jest.mock('path', () => ({
    ...jest.requireActual('path'),
    extname: jest.fn()
}));

jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('123e4567-e89b-12d3-a456-426614174000')
}));

jest.mock('@netapp-cloud-datamigrate/jobs-lib', () => ({
    RedisUtils: {
        getClient: jest.fn().mockResolvedValue({
            isOpen: false,
            connect: jest.fn(),
            disconnect: jest.fn()
        }),
        createClient: jest.fn()
    },
    JobContextFactory: {
        getProvider: jest.fn().mockReturnValue({
            getJobContext: jest.fn()
        })
    },
    FileInfo: jest.fn().mockImplementation(() => ({
        serialize: jest.fn(),
        deserialize: jest.fn()
    })),
    ItemInfo: jest.fn().mockImplementation(() => ({
        serialize: jest.fn(),
        deserialize: jest.fn()
    })),
    Task: jest.fn(),
    TaskInfo: jest.fn().mockImplementation(() => ({
        serialize: jest.fn(),
        deserialize: jest.fn()
    })),
    DMError: jest.fn(),
    ErrorType: {
        FATAL_ERROR: 'FATAL_ERROR',
        TRANSIENT_ERROR: 'TRANSIENT_ERROR',
        RECOVERABLE_ERROR: 'RECOVERABLE_ERROR'
    },
    TaskType: {
        SCAN: 'SCAN',
        MIGRATE: 'MIGRATE'
    },
    TaskStatus: {
        PENDING: 'PENDING',
        RUNNING: 'RUNNING',
        ERRORED: 'ERRORED',
        COMPLETED: 'COMPLETED',
        COMPLETED_WITH_ERROR: 'COMPLETED_WITH_ERROR'
    }
}));

describe('utils', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Default mock implementations
        (fs.promises.lstat as jest.Mock).mockResolvedValue({
            isDirectory: () => false,
            size: 1024,
            birthtime: new Date(),
            mtime: new Date(),
            atime: new Date(),
            uid: 1001,
            gid: 1001,
            mode: 0o644
        });

        (path.extname as jest.Mock).mockReturnValue('.txt');
    });

    describe('removePrefix', () => {
        it('should remove prefix when string starts with prefix', () => {
            const result = removePrefix('prefix-test', 'prefix-');
            expect(result).toBe('test');
        });

        it('should return original string when it does not start with prefix', () => {
            const result = removePrefix('test-string', 'prefix-');
            expect(result).toBe('test-string');
        });

        it('should handle empty prefix', () => {
            const result = removePrefix('test-string', '');
            expect(result).toBe('test-string');
        });
    });

    describe('getFilePermissions', () => {
        it('should return correct permissions for file', () => {
            const mockStats = {
                mode: 0o644, // rw-r--r--
                isDirectory: jest.fn().mockReturnValue(false)
            } as unknown as fs.Stats;

            const result = getFilePermissions(mockStats, mockStats.isDirectory());
            expect(result).toBe('-rw-r--r--');
        });

        it('should return correct permissions for directory', () => {
            const mockStats = {
                mode: 0o755, // rwxr-xr-x
                isDirectory: jest.fn().mockReturnValue(true)
            } as unknown as fs.Stats;

            const result = getFilePermissions(mockStats, mockStats.isDirectory());
            expect(result).toBe('drwxr-xr-x');
        });

        it('should handle all permission combinations', () => {
            const testCases = [
                { mode: 0o777, isDir: false, expected: '-rwxrwxrwx' },
                { mode: 0o000, isDir: true, expected: 'd---------' },
                { mode: 0o111, isDir: false, expected: '---x--x--x' },
                { mode: 0o222, isDir: true, expected: 'd-w--w--w-' },
                { mode: 0o444, isDir: false, expected: '-r--r--r--' },
                { mode: 0o555, isDir: true, expected: 'dr-xr-xr-x' },
                { mode: 0o666, isDir: false, expected: '-rw-rw-rw-' },
                { mode: 0o700, isDir: true, expected: 'drwx------' },
                { mode: 0o070, isDir: false, expected: '----rwx---' },
                { mode: 0o007, isDir: true, expected: 'd------rwx' }
            ];

            testCases.forEach(({ mode, isDir, expected }) => {
                const mockStats = {
                    mode,
                    isDirectory: jest.fn().mockReturnValue(isDir)
                } as unknown as fs.Stats;
                expect(getFilePermissions(mockStats, mockStats.isDirectory())).toBe(expected);
            });
        });
    });

    describe('shouldExclude', () => {
        it('should return false when no exclude patterns', () => {
            const result = shouldExclude('some/path', []);
            expect(result).toBe(false);
        });

        it('should return false when no patterns match', () => {
            const result = shouldExclude('some/path', ['*.log', 'temp/']);
            expect(result).toBe(false);
        });

        it('should return true when path matches pattern', () => {
            const result = shouldExclude('some/path/temp/file.txt', ['temp/']);
            expect(result).toBe(false);
        });

        it('should return true when path matches wildcard pattern', () => {
            const result = shouldExclude('some/path/logs/error.log', ['*.log']);
            expect(result).toBe(true);
        });

        it('should handle exact filename match', () => {
            const result = shouldExclude('some/path/config.json', ['config.json']);
            expect(result).toBe(true);
        });

        it('should handle path with backslashes', () => {
            const result = shouldExclude('some\\path\\temp\\file.txt', ['temp/']);
            expect(result).toBe(false);
        });

        it('should handle empty patterns after trim', () => {
            const result = shouldExclude('some/path', ['  ', '\t']);
            expect(result).toBe(false);
        });

        it('should match when any pattern in array matches', () => {
            const result = shouldExclude('some/path/file.tmp', ['*.log', '*.tmp']);
            expect(result).toBe(true);
        });
    });

    describe('shouldSkipFile', () => {
        const mockStats = {
            mtime: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
        } as fs.Stats;

        it('should return false when no skipTime', () => {
            const result = shouldSkipFile(mockStats, '', 'MIGRATE');
            expect(result).toBe(false);
        });

        it('should return false when jobType is not MIGRATE', () => {
            const result = shouldSkipFile(mockStats, '30-M', 'SYNC');
            expect(result).toBe(false);
        });

        it('should return false when skipTime format is invalid', () => {
            const result = shouldSkipFile(mockStats, 'invalid', 'MIGRATE');
            expect(result).toBe(false);
        });

        it('should return false when skipValue is not a number', () => {
            const result = shouldSkipFile(mockStats, 'abc-M', 'MIGRATE');
            expect(result).toBe(false);
        });

        it('should return true when file is newer than skip minutes', () => {
            const stats = {
                mtime: new Date(Date.now() - 10 * 60 * 1000) // 10 minutes ago
            } as fs.Stats;
            const result = shouldSkipFile(stats, '30-M', 'MIGRATE');
            expect(result).toBe(true);
        });

        it('should return false when file is older than skip minutes', () => {
            const stats = {
                mtime: new Date(Date.now() - 40 * 60 * 1000) // 40 minutes ago
            } as fs.Stats;
            const result = shouldSkipFile(stats, '30-M', 'MIGRATE');
            expect(result).toBe(false);
        });

        it('should handle hours correctly', () => {
            const stats = {
                mtime: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
            } as fs.Stats;
            const result1 = shouldSkipFile(stats, '1-H', 'MIGRATE');
            expect(result1).toBe(false);

            const stats2 = {
                mtime: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
            } as fs.Stats;
            const result2 = shouldSkipFile(stats2, '1-H', 'MIGRATE');
            expect(result2).toBe(true);
        });

        it('should handle days correctly', () => {
            const stats = {
                mtime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
            } as fs.Stats;
            const result1 = shouldSkipFile(stats, '1-D', 'MIGRATE');
            expect(result1).toBe(false);

            const stats2 = {
                mtime: new Date(Date.now() - 12 * 60 * 60 * 1000) // 12 hours ago
            } as fs.Stats;
            const result2 = shouldSkipFile(stats2, '1-D', 'MIGRATE');
            expect(result2).toBe(true);
        });

        it('should return false for unknown skipType', () => {
            const result = shouldSkipFile(mockStats, '30-X', 'MIGRATE');
            expect(result).toBe(false);
        });
    });

    describe('shouldExcludeOlderThan', () => {
        it('should return false when no olderThan date', () => {
            const result = shouldExcludeOlderThan({} as fs.Stats, undefined);
            expect(result).toBe(false);
        });

        it('should return true when file is older than cutoff', () => {
            const stats = {
                mtime: new Date('2020-01-01')
            } as fs.Stats;
            const result = shouldExcludeOlderThan(stats, new Date('2021-01-01'));
            expect(result).toBe(true);
        });

        it('should return false when file is newer than cutoff', () => {
            const stats = {
                mtime: new Date('2022-01-01')
            } as fs.Stats;
            const result = shouldExcludeOlderThan(stats, new Date('2021-01-01'));
            expect(result).toBe(false);
        });
    });

    describe('shouldExcludeOrSkip', () => {
        const mockParams = {
            fullPath: 'some/path',
            stats: {
                mtime: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
            } as fs.Stats,
            excludePatterns: [],
            skipTime: '',
            olderThan: undefined,
            jobType: 'MIGRATE'
        };

        it('should return false when no conditions match', () => {
            const result = shouldExcludeOrSkip(mockParams);
            expect(result).toBe(false);
        });

        it('should return true when shouldExclude matches', () => {
            const params = {
                ...mockParams,
                excludePatterns: ['some/']
            };
            const result = shouldExcludeOrSkip(params);
            expect(result).toBe(true);
        });

        it('should return true when shouldSkipFile matches', () => {
            const params = {
                ...mockParams,
                skipTime: '60-M'
            };
            const result = shouldExcludeOrSkip(params);
            expect(result).toBe(true);
        });

        it('should return true when shouldExcludeOlderThan matches', () => {
            const params = {
                ...mockParams,
                olderThan: new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
            };
            const result = shouldExcludeOrSkip(params);
            expect(result).toBe(true);
        });

        it('should return true when multiple conditions match', () => {
            const params = {
                fullPath: 'some/path',
                stats: {
                    mtime: new Date('2020-01-01')
                } as fs.Stats,
                excludePatterns: ['some/'],
                skipTime: '60-M',
                olderThan: new Date('2021-01-01'),
                jobType: 'MIGRATE'
            };
            const result = shouldExcludeOrSkip(params);
            expect(result).toBe(true);
        });
    });

    describe('getFileType', () => {
        it('should return SYMBOLIC_LINK for symbolic links', () => {
            const stats = {
                isSymbolicLink: () => true,
                isFile: () => false,
                isDirectory: () => false,
                isSocket: () => false,
                isFIFO: () => false,
                isCharacterDevice: () => false,
                isBlockDevice: () => false
            } as unknown as fs.Stats;
            expect(getFileType(stats, stats.isDirectory())).toBe(FileType.SYMBOLIC_LINK);
        });

        it('should return FILE for regular files', () => {
            const stats = {
                isSymbolicLink: () => false,
                isFile: () => true,
                isDirectory: () => false,
                isSocket: () => false,
                isFIFO: () => false,
                isCharacterDevice: () => false,
                isBlockDevice: () => false
            } as unknown as fs.Stats;
            expect(getFileType(stats, stats.isDirectory())).toBe(FileType.FILE);
        });

        it('should return DIRECTORY for directories', () => {
            const stats = {
                isSymbolicLink: () => false,
                isFile: () => false,
                isDirectory: () => true,
                isSocket: () => false,
                isFIFO: () => false,
                isCharacterDevice: () => false,
                isBlockDevice: () => false
            } as unknown as fs.Stats;
            expect(getFileType(stats, stats.isDirectory())).toBe(FileType.DIRECTORY);
        });

        it('should return SOCKET for sockets', () => {
            const stats = {
                isSymbolicLink: () => false,
                isFile: () => false,
                isDirectory: () => false,
                isSocket: () => true,
                isFIFO: () => false,
                isCharacterDevice: () => false,
                isBlockDevice: () => false
            } as unknown as fs.Stats;
            expect(getFileType(stats, stats.isDirectory())).toBe(FileType.SOCKET);
        });

        it('should return FIFO for FIFO pipes', () => {
            const stats = {
                isSymbolicLink: () => false,
                isFile: () => false,
                isDirectory: () => false,
                isSocket: () => false,
                isFIFO: () => true,
                isCharacterDevice: () => false,
                isBlockDevice: () => false
            } as unknown as fs.Stats;
            expect(getFileType(stats, stats.isDirectory())).toBe(FileType.FIFO);
        });

        it('should return CHARACTER_DEVICE for character devices', () => {
            const stats = {
                isSymbolicLink: () => false,
                isFile: () => false,
                isDirectory: () => false,
                isSocket: () => false,
                isFIFO: () => false,
                isCharacterDevice: () => true,
                isBlockDevice: () => false
            } as unknown as fs.Stats;
            expect(getFileType(stats, stats.isDirectory())).toBe(FileType.CHARACTER_DEVICE);
        });

        it('should return BLOCK_DEVICE for block devices', () => {
            const stats = {
                isSymbolicLink: () => false,
                isFile: () => false,
                isDirectory: () => false,
                isSocket: () => false,
                isFIFO: () => false,
                isCharacterDevice: () => false,
                isBlockDevice: () => true
            } as unknown as fs.Stats;
            expect(getFileType(stats, stats.isDirectory())).toBe(FileType.BLOCK_DEVICE);
        });

        it('should return UNKNOWN for unknown file types', () => {
            const stats = {
                isSymbolicLink: () => false,
                isFile: () => false,
                isDirectory: () => false,
                isSocket: () => false,
                isFIFO: () => false,
                isCharacterDevice: () => false,
                isBlockDevice: () => false
            } as unknown as fs.Stats;
            expect(getFileType(stats, stats.isDirectory())).toBe(FileType.UNKNOWN);
        });
    });

    describe('isContentUpdate', () => {
        it('should return true when destination file is missing', () => {
            const sourceStats = { size: 100, mtime: new Date('2023-01-01') } as fs.Stats;
            expect(isContentUpdate(sourceStats)).toBe(true);
        });

        it('should return true when sizes differ', () => {
            const sourceStats = { size: 100, mtime: new Date('2023-01-01') } as fs.Stats;
            const destStats = { size: 200, mtime: new Date('2023-01-01') } as fs.Stats;
            expect(isContentUpdate(sourceStats, destStats)).toBe(true);
        });

        it('should return false when files are identical', () => {
            const date = new Date('2023-01-01');
            const sourceStats = { size: 100, mtime: date } as fs.Stats;
            const destStats = { size: 100, mtime: new Date(date) } as fs.Stats;
            expect(isContentUpdate(sourceStats, destStats)).toBe(false);
        });
    });

 

    describe('getErrorCode', () => {
        it('should return TASK error codes', () => {
            expect(getErrorCode({ code: 'ENOENT' }, 'TASK')).toBe('TASK_FILE_NOT_FOUND');
            expect(getErrorCode({ code: 'EACCES' }, 'TASK')).toBe('TASK_PERMISSION_DENIED');
            expect(getErrorCode({ code: 'ENOSPC' }, 'TASK')).toBe('TASK_NO_SPACE_LEFT');
            expect(getErrorCode({ code: 'UNKNOWN' }, 'TASK')).toBe('TASK_UNKNOWN_ERROR');
            expect(getErrorCode({}, 'TASK')).toBe('TASK_GENERAL_FAILURE');
        });

        it('should return OPERATION error codes', () => {
            expect(getErrorCode({ code: 'ENOENT' }, 'OPERATION')).toBe('OP_FILE_NOT_FOUND');
            expect(getErrorCode({ code: 'EACCES' }, 'OPERATION')).toBe('OP_PERMISSION_DENIED');
            expect(getErrorCode({ code: 'ENOSPC' }, 'OPERATION')).toBe('OP_NO_SPACE_LEFT');
            expect(getErrorCode({ code: 'UNKNOWN' }, 'OPERATION')).toBe('OP_UNKNOWN_ERROR');
            expect(getErrorCode({}, 'OPERATION')).toBe('OP_GENERAL_FAILURE');
        });

        it('should handle all error codes', () => {
            const testCases = [
                { code: 'EMFILE', task: 'TASK_TOO_MANY_OPEN_FILES', op: 'OP_TOO_MANY_OPEN_FILES' },
                { code: 'ENOTDIR', task: 'TASK_NOT_A_DIRECTORY', op: 'OP_NOT_A_DIRECTORY' },
                { code: 'EISDIR', task: 'TASK_IS_A_DIRECTORY', op: 'OP_IS_A_DIRECTORY' },
                { code: 'EROFS', task: 'TASK_READ_ONLY_FILESYSTEM', op: 'OP_READ_ONLY_FILESYSTEM' },
                { code: 'EBUSY', task: 'TASK_RESOURCE_BUSY', op: 'OP_RESOURCE_BUSY' },
                { code: 'ELOOP', task: 'TASK_TOO_MANY_SYMLINKS', op: 'OP_TOO_MANY_SYMLINKS' },
                { code: 'ECONNRESET', task: 'TASK_CONNECTION_RESET', op: 'OP_CONNECTION_RESET' },
                { code: 'ETIMEDOUT', task: 'TASK_OPERATION_TIMED_OUT', op: 'OP_OPERATION_TIMED_OUT' },
                { code: 'ENETDOWN', task: 'TASK_NETWORK_DOWN', op: 'OP_NETWORK_DOWN' },
                { code: 'ECONNREFUSED', task: 'TASK_CONNECTION_REFUSED', op: 'OP_CONNECTION_REFUSED' },
                { code: 'EPIPE', task: 'TASK_BROKEN_PIPE', op: 'OP_BROKEN_PIPE' },
                { code: 'ENAMETOOLONG', task: 'TASK_FILENAME_TOO_LONG', op: 'OP_FILENAME_TOO_LONG' },
                { code: 'EIO', task: 'TASK_SERVER_DISCONNECTED', op: 'OP_SERVER_DISCONNECTED' }
            ];

            testCases.forEach(({ code, task, op }) => {
                expect(getErrorCode({ code }, 'TASK')).toBe(task);
                expect(getErrorCode({ code }, 'OPERATION')).toBe(op);
            });
        });
    });

});


describe("formatDate", () => {
    it("should format a regular date correctly", () => {
        const date = new Date("2024-03-27T15:05:09Z");
        expect(formatDate(date)).toBeDefined();
    });


});


