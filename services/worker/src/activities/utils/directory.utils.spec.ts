import * as fs from 'fs';
import * as path from 'path';
import { createDirectoryWithTildeCheck } from './directory.utils';

// Mock fs and path modules
jest.mock('fs', () => ({
    promises: {
        mkdir: jest.fn(),
        realpath: jest.fn()
    }
}));
jest.mock('path');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('createDirectoryWithTildeCheck', () => {
    let consoleSpy: jest.SpyInstance;
    let mockMkdir: jest.MockedFunction<typeof fs.promises.mkdir>;
    let mockRealpath: jest.MockedFunction<typeof fs.promises.realpath>;

    beforeEach(() => {
        // Setup fs mocks
        mockMkdir = mockFs.promises.mkdir as jest.MockedFunction<typeof fs.promises.mkdir>;
        mockRealpath = mockFs.promises.realpath as jest.MockedFunction<typeof fs.promises.realpath>;
        
        // Setup path mock
        (path.sep as any) = '\\';
        (path.join as jest.MockedFunction<typeof path.join>) = jest.fn((...args) => args.join('\\'));
        
        // Mock console.log to avoid test output noise
        consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        
        jest.clearAllMocks();
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    describe('Tilde Detection', () => {
        it('should identify tilde directories correctly', async () => {
            const testPath = 'C:\\Users\\test\\LONGLO~1\\subfolder';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\Users\\test\\LONGLO~1');

            await createDirectoryWithTildeCheck(testPath);

            expect(consoleSpy).toHaveBeenCalledWith('Found tilde directory at index 3: "LONGLO~1"');
            expect(consoleSpy).toHaveBeenCalledWith('Found tildes at indices: [3]');
        });

        it('should handle multiple tilde directories', async () => {
            const testPath = 'C:\\Users\\LONGLO~1\\SHORTF~1\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('mocked-path');

            await createDirectoryWithTildeCheck(testPath);

            expect(consoleSpy).toHaveBeenCalledWith('Found tilde directory at index 2: "LONGLO~1"');
            expect(consoleSpy).toHaveBeenCalledWith('Found tilde directory at index 3: "SHORTF~1"');
            expect(consoleSpy).toHaveBeenCalledWith('Found tildes at indices: [2, 3]');
        });

        it('should handle path with no tildes', async () => {
            const testPath = 'C:\\Users\\test\\regularfolder\\subfolder';
            mockMkdir.mockResolvedValue(undefined as any);

            await createDirectoryWithTildeCheck(testPath);

            expect(consoleSpy).toHaveBeenCalledWith('Found tildes at indices: []');
            expect(consoleSpy).toHaveBeenCalledWith('mkdir remaining: \\C:\\Users\\test\\regularfolder\\subfolder');
        });
    });

    describe('Directory Creation', () => {
        it('should create directories incrementally for tilde paths', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\subfolder';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\base\\LONGLO~1');

            await createDirectoryWithTildeCheck(testPath);

            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1\\subfolder', { recursive: true });
        });

        it('should create remaining path after last tilde directory', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\sub1\\sub2\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\base\\LONGLO~1');
            (path.join as jest.MockedFunction<typeof path.join>).mockReturnValue('C:\\base\\LONGLO~1\\sub1\\sub2\\file.txt');

            await createDirectoryWithTildeCheck(testPath);

            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1\\sub1\\sub2\\file.txt', { recursive: true });
        });

        it('should not create remaining path if tilde is last directory', async () => {
            const testPath = 'C:\\base\\LONGLO~1';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\base\\LONGLO~1');

            await createDirectoryWithTildeCheck(testPath);

            expect(mockMkdir).toHaveBeenCalledTimes(1);
            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1', { recursive: true });
        });
    });

    describe('Collision Detection', () => {
        it('should detect collision when realpath fails', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\subfolder';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockRejectedValue(new Error('ENOENT: no such file or directory'));

            await expect(createDirectoryWithTildeCheck(testPath)).rejects.toMatchObject({
                message: expect.stringContaining('8.3 short filename collision detected: Cannot create directory \'LONGLO~1\''),
                code: 'E8DOT3_COLLISION'
            });

            expect(mockRealpath).toHaveBeenCalledWith('C:\\base\\LONGLO~1');
        });

        it('should succeed when realpath succeeds (no collision)', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\subfolder';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\base\\LONGLO~1');

            await expect(createDirectoryWithTildeCheck(testPath)).resolves.toBeUndefined();

            expect(consoleSpy).toHaveBeenCalledWith('Realpath success for: LONGLO~1');
        });

        it('should handle multiple tilde directories with mixed collision results', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\SHORTF~1\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            
            // First tilde succeeds, second tilde fails (collision)
            mockRealpath
                .mockResolvedValueOnce('C:\\base\\LONGLO~1')  // First call succeeds
                .mockRejectedValueOnce(new Error('Collision')); // Second call fails

            await expect(createDirectoryWithTildeCheck(testPath)).rejects.toMatchObject({
                message: expect.stringContaining('8.3 short filename collision detected: Cannot create directory \'SHORTF~1\''),
                code: 'E8DOT3_COLLISION'
            });

            expect(mockRealpath).toHaveBeenCalledTimes(2);
        });
    });

    describe('Error Handling', () => {
        it('should propagate mkdir errors that are not collision-related', async () => {
            const testPath = 'C:\\base\\regularfolder';
            mockMkdir.mockRejectedValue(new Error('Permission denied'));

            await expect(createDirectoryWithTildeCheck(testPath)).rejects.toThrow('Permission denied');
        });

        it('should create proper error message with directory name', async () => {
            const testPath = 'C:\\base\\TESTDIR~1';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockRejectedValue(new Error('Collision'));

            await expect(createDirectoryWithTildeCheck(testPath)).rejects.toMatchObject({
                message: '8.3 short filename collision detected: Cannot create directory \'TESTDIR~1\' This indicates the directory name collided with existing 8.3 short names.',
                code: 'E8DOT3_COLLISION'
            });
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty path', async () => {
            const testPath = '';
            
            await createDirectoryWithTildeCheck(testPath);

            expect(consoleSpy).toHaveBeenCalledWith('Found tildes at indices: []');
        });

        it('should handle root path with tilde', async () => {
            const testPath = 'LONGLO~1';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('LONGLO~1');

            await createDirectoryWithTildeCheck(testPath);

            expect(mockMkdir).toHaveBeenCalledWith('LONGLO~1', { recursive: true });
            expect(mockRealpath).toHaveBeenCalledWith('LONGLO~1');
        });

        it('should handle path with tilde at the end', async () => {
            const testPath = 'C:\\Users\\Documents\\LONGLO~1';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\Users\\Documents\\LONGLO~1');

            await createDirectoryWithTildeCheck(testPath);

            expect(mockMkdir).toHaveBeenCalledTimes(1);
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\Documents\\LONGLO~1', { recursive: true });
        });
    });
});