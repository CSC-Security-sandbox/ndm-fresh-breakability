import { ConfigService } from '@nestjs/config';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import { DirStreamingService, StreamDirToRedisInput } from './dir-streaming.service';
import { Origin, Operation } from 'src/activities/utils/utils.types';
import { FatalError } from 'src/errors/errors.types';

const mockDmError = jest.fn().mockReturnValue({ error: 'mock' });
const mockIsPathExists = jest.fn();

jest.mock('src/activities/utils/utils', () => ({
    dmError: (...args: unknown[]) => mockDmError(...args),
}));

jest.mock('../utils/utils', () => ({
    isPathExists: (...args: unknown[]) => mockIsPathExists(...args),
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    promises: {
        ...jest.requireActual('fs').promises,
        opendir: jest.fn(),
    },
}));

function makeDirent(name: string, isFile = true): fs.Dirent {
    return {
        name,
        isFile: () => isFile,
        isDirectory: () => !isFile,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        isSymbolicLink: () => false,
        parentPath: '/test',
        path: '/test',
    } as fs.Dirent;
}

async function* asyncIterator<T>(items: T[]): AsyncGenerator<T> {
    for (const item of items) {
        yield item;
    }
}

function mockOpendir(dirents: fs.Dirent[]) {
    (fs.promises.opendir as jest.Mock).mockResolvedValue({
        [Symbol.asyncIterator]: () => asyncIterator(dirents),
        close: jest.fn().mockResolvedValue(undefined),
    });
}

describe('DirStreamingService', () => {
    let service: DirStreamingService;
    let mockLogger: jest.Mocked<LoggerService>;

    const mockJobContext = {
        addToDirContentSet: jest.fn(),
        publishToErrorStream: jest.fn(),
        scanDirContentSet: jest.fn(),
        areDirContentMembers: jest.fn(),
    };

    const baseCommand = { id: 'cmd-1', fPath: '/source/dir' } as any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as any;

        const configService = {
            get: jest.fn().mockReturnValue(3),
        } as unknown as jest.Mocked<ConfigService>;

        const loggerFactory = {
            create: jest.fn().mockReturnValue(mockLogger),
        } as unknown as jest.Mocked<LoggerFactory>;

        service = new DirStreamingService(configService, loggerFactory);
    });

    describe('getDirContentKey', () => {
        it('should return a 16-char hex hash of the path', () => {
            const key = service.getDirContentKey('/some/path');
            expect(key).toHaveLength(16);
            expect(key).toMatch(/^[0-9a-f]{16}$/);
        });

        it('should return the same key for the same path', () => {
            const key1 = service.getDirContentKey('/data/exports/vol1');
            const key2 = service.getDirContentKey('/data/exports/vol1');
            expect(key1).toBe(key2);
        });

        it('should return different keys for different paths', () => {
            const key1 = service.getDirContentKey('/path/a');
            const key2 = service.getDirContentKey('/path/b');
            expect(key1).not.toBe(key2);
        });
    });

    describe('streamDirToRedisSet', () => {
        const makeInput = (overrides?: Partial<StreamDirToRedisInput>): StreamDirToRedisInput => ({
            dirPath: '/source/dir',
            redisKey: 'abc123',
            jobContext: mockJobContext as any,
            origin: Origin.SOURCE,
            errorType: ErrorType.TRANSIENT_ERROR,
            command: baseCommand,
            ...overrides,
        });

        it('should stream all entries to Redis in batches', async () => {
            mockIsPathExists.mockResolvedValue(true);
            const dirents = [makeDirent('a.txt'), makeDirent('b.txt'), makeDirent('c.txt'), makeDirent('d.txt')];
            mockOpendir(dirents);

            const result = await service.streamDirToRedisSet(makeInput());

            expect(result.totalCount).toBe(4);
            expect(result.redisKey).toBe('abc123');
            // batchSize=3: first batch of 3, then flush of 1
            expect(mockJobContext.addToDirContentSet).toHaveBeenCalledTimes(2);
            expect(mockJobContext.addToDirContentSet).toHaveBeenCalledWith('abc123', ['a.txt', 'b.txt', 'c.txt']);
            expect(mockJobContext.addToDirContentSet).toHaveBeenCalledWith('abc123', ['d.txt']);
        });

        it('should handle exact batch size without extra flush', async () => {
            mockIsPathExists.mockResolvedValue(true);
            const dirents = [makeDirent('a.txt'), makeDirent('b.txt'), makeDirent('c.txt')];
            mockOpendir(dirents);

            const result = await service.streamDirToRedisSet(makeInput());

            expect(result.totalCount).toBe(3);
            expect(mockJobContext.addToDirContentSet).toHaveBeenCalledTimes(1);
            expect(mockJobContext.addToDirContentSet).toHaveBeenCalledWith('abc123', ['a.txt', 'b.txt', 'c.txt']);
        });

        it('should handle empty directory', async () => {
            mockIsPathExists.mockResolvedValue(true);
            mockOpendir([]);

            const result = await service.streamDirToRedisSet(makeInput());

            expect(result.totalCount).toBe(0);
            expect(mockJobContext.addToDirContentSet).not.toHaveBeenCalled();
        });

        it('should build lowercase set when buildLowercaseSet is true', async () => {
            mockIsPathExists.mockResolvedValue(true);
            const dirents = [makeDirent('File.TXT'), makeDirent('Doc.PDF')];
            mockOpendir(dirents);

            const result = await service.streamDirToRedisSet(makeInput({ buildLowercaseSet: true }));

            expect(result.totalCount).toBe(2);
            expect(result.lowercaseRedisKey).toBe('abc123:lc');
            expect(mockJobContext.addToDirContentSet).toHaveBeenCalledWith('abc123', ['File.TXT', 'Doc.PDF']);
            expect(mockJobContext.addToDirContentSet).toHaveBeenCalledWith('abc123:lc', ['file.txt', 'doc.pdf']);
        });

        it('should not set lowercaseRedisKey when buildLowercaseSet is false', async () => {
            mockIsPathExists.mockResolvedValue(true);
            mockOpendir([makeDirent('a.txt')]);

            const result = await service.streamDirToRedisSet(makeInput({ buildLowercaseSet: false }));

            expect(result.lowercaseRedisKey).toBeUndefined();
        });

        it('should return totalCount 0 for non-existent destination path', async () => {
            mockIsPathExists.mockResolvedValue(false);

            const result = await service.streamDirToRedisSet(makeInput({ origin: Origin.DESTINATION }));

            expect(result.totalCount).toBe(0);
            expect(fs.promises.opendir).not.toHaveBeenCalled();
        });

        it('should throw FatalError for non-existent source path', async () => {
            mockIsPathExists.mockResolvedValue(false);

            await expect(service.streamDirToRedisSet(makeInput({ origin: Origin.SOURCE })))
                .rejects.toThrow(FatalError);

            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(mockDmError).toHaveBeenCalledWith(
                'OPERATION', Origin.SOURCE, Operation.READ_DIR, ErrorType.FATAL_ERROR,
                'cmd-1', expect.any(FatalError), { name: '/source/dir', path: '/source/dir' },
            );
        });

        it('should return totalCount 0 for ENOENT on destination', async () => {
            mockIsPathExists.mockResolvedValue(true);
            const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            (fs.promises.opendir as jest.Mock).mockRejectedValue(enoentError);

            const result = await service.streamDirToRedisSet(makeInput({ origin: Origin.DESTINATION }));

            expect(result.totalCount).toBe(0);
        });

        it('should publish error and rethrow for non-fatal errors', async () => {
            mockIsPathExists.mockResolvedValue(true);
            const permError = new Error('EACCES');
            (fs.promises.opendir as jest.Mock).mockRejectedValue(permError);

            await expect(service.streamDirToRedisSet(makeInput({ origin: Origin.SOURCE })))
                .rejects.toThrow(permError);

            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(mockDmError).toHaveBeenCalledWith(
                'OPERATION', Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR,
                'cmd-1', permError, { name: '/source/dir', path: '/source/dir' },
            );
        });
    });

    describe('streamDirEntries', () => {
        it('should yield batches of filenames', async () => {
            const dirents = [makeDirent('a'), makeDirent('b'), makeDirent('c'), makeDirent('d'), makeDirent('e')];
            mockOpendir(dirents);

            const batches: string[][] = [];
            for await (const batch of service.streamDirEntries('/test')) {
                batches.push(batch);
            }

            // batchSize=3: [a,b,c], [d,e]
            expect(batches).toEqual([['a', 'b', 'c'], ['d', 'e']]);
        });

        it('should yield nothing for empty directory', async () => {
            mockOpendir([]);

            const batches: string[][] = [];
            for await (const batch of service.streamDirEntries('/empty')) {
                batches.push(batch);
            }

            expect(batches).toEqual([]);
        });

        it('should yield single batch when entries fit within batchSize', async () => {
            const dirents = [makeDirent('x'), makeDirent('y')];
            mockOpendir(dirents);

            const batches: string[][] = [];
            for await (const batch of service.streamDirEntries('/small')) {
                batches.push(batch);
            }

            expect(batches).toEqual([['x', 'y']]);
        });
    });

    describe('streamDirEntriesWithFileTypes', () => {
        it('should yield batches of Dirent objects', async () => {
            const dirents = [makeDirent('a.txt', true), makeDirent('subdir', false), makeDirent('b.log', true), makeDirent('c.dat', true)];
            mockOpendir(dirents);

            const batches: fs.Dirent[][] = [];
            for await (const batch of service.streamDirEntriesWithFileTypes('/test')) {
                batches.push(batch);
            }

            // batchSize=3: [a.txt, subdir, b.log], [c.dat]
            expect(batches).toHaveLength(2);
            expect(batches[0].map(d => d.name)).toEqual(['a.txt', 'subdir', 'b.log']);
            expect(batches[1].map(d => d.name)).toEqual(['c.dat']);
        });

        it('should preserve Dirent file type information', async () => {
            const dirents = [makeDirent('file.txt', true), makeDirent('folder', false)];
            mockOpendir(dirents);

            const batches: fs.Dirent[][] = [];
            for await (const batch of service.streamDirEntriesWithFileTypes('/test')) {
                batches.push(batch);
            }

            expect(batches[0][0].isFile()).toBe(true);
            expect(batches[0][1].isDirectory()).toBe(true);
        });
    });

    describe('scanForNonMembers', () => {
        it('should yield entries not present in the check set', async () => {
            mockJobContext.scanDirContentSet
                .mockResolvedValueOnce({ cursor: 5, members: ['a', 'b', 'c'] })
                .mockResolvedValueOnce({ cursor: 0, members: ['d', 'e'] });
            mockJobContext.areDirContentMembers
                .mockResolvedValueOnce([true, false, true])   // b is not a member
                .mockResolvedValueOnce([false, true]);         // d is not a member

            const results: string[][] = [];
            for await (const batch of service.scanForNonMembers(mockJobContext as any, 'target-key', 'source-key')) {
                results.push(batch);
            }

            expect(results).toEqual([['b'], ['d']]);
            expect(mockJobContext.scanDirContentSet).toHaveBeenCalledWith('target-key', 0, 3);
            expect(mockJobContext.scanDirContentSet).toHaveBeenCalledWith('target-key', 5, 3);
            expect(mockJobContext.areDirContentMembers).toHaveBeenCalledWith('source-key', ['a', 'b', 'c']);
            expect(mockJobContext.areDirContentMembers).toHaveBeenCalledWith('source-key', ['d', 'e']);
        });

        it('should yield nothing when all entries are members', async () => {
            mockJobContext.scanDirContentSet
                .mockResolvedValueOnce({ cursor: 0, members: ['a', 'b'] });
            mockJobContext.areDirContentMembers
                .mockResolvedValueOnce([true, true]);

            const results: string[][] = [];
            for await (const batch of service.scanForNonMembers(mockJobContext as any, 'target', 'source')) {
                results.push(batch);
            }

            expect(results).toEqual([]);
        });

        it('should skip empty scan pages', async () => {
            mockJobContext.scanDirContentSet
                .mockResolvedValueOnce({ cursor: 3, members: [] })
                .mockResolvedValueOnce({ cursor: 0, members: ['x'] });
            mockJobContext.areDirContentMembers
                .mockResolvedValueOnce([false]);

            const results: string[][] = [];
            for await (const batch of service.scanForNonMembers(mockJobContext as any, 'target', 'source')) {
                results.push(batch);
            }

            expect(results).toEqual([['x']]);
            expect(mockJobContext.areDirContentMembers).toHaveBeenCalledTimes(1);
        });

        it('should handle single-page scan', async () => {
            mockJobContext.scanDirContentSet
                .mockResolvedValueOnce({ cursor: 0, members: ['only'] });
            mockJobContext.areDirContentMembers
                .mockResolvedValueOnce([false]);

            const results: string[][] = [];
            for await (const batch of service.scanForNonMembers(mockJobContext as any, 'target', 'source')) {
                results.push(batch);
            }

            expect(results).toEqual([['only']]);
        });
    });
});
