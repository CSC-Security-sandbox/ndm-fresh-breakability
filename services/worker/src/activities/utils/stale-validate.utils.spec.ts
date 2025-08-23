import { validateStale } from './stale-validate.utils';
import * as fs from 'fs';

jest.mock('fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('validateStale', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should validate existing paths without throwing', async () => {
        mockedFs.promises = {
            access: jest.fn().mockResolvedValue(undefined),
        } as any;

        await expect(validateStale(['/valid/path1', '/valid/path2'])).resolves.toBeUndefined();
        expect(mockedFs.promises.access).toHaveBeenCalledTimes(2);
    });

    it('should skip empty or falsy paths', async () => {
        mockedFs.promises = {
            access: jest.fn().mockResolvedValue(undefined),
        } as any;

        await expect(validateStale(['', null as any, undefined as any, '/valid/path'])).resolves.toBeUndefined();
        expect(mockedFs.promises.access).toHaveBeenCalledTimes(1);
    });

    it('should throw if a path does not exist', async () => {
        mockedFs.promises = {
            access: jest.fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('ENOENT')),
        } as any;

        await expect(validateStale(['/valid/path', '/invalid/path'])).rejects.toThrow(
            'Path /invalid/path does not exist or is stale.'
        );
        expect(mockedFs.promises.access).toHaveBeenCalledTimes(2);
    });

    it('should throw if access times out', async () => {
        // Simulate a never-resolving promise for access
        mockedFs.promises = {
            access: jest.fn(() => new Promise(() => {})),
        } as any;

        // Reduce timeout for test speed
        jest.useFakeTimers();
        const promise = validateStale(['/timeout/path']);
        jest.advanceTimersByTime(1001);
        await expect(promise).rejects.toThrow('Path /timeout/path does not exist or is stale.');
        jest.useRealTimers();
    });
});