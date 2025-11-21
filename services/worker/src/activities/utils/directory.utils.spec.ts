import * as fs from 'fs';
import * as path from 'path';
import { createDirectory } from './directory.utils';

// Mock fs and path modules
jest.mock('fs', () => ({
    promises: {
        mkdir: jest.fn(),
        realpath: jest.fn()
    }
}));
jest.mock('path');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('createDirectory', () => {
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

            await createDirectory(testPath);

            expect(consoleSpy).toHaveBeenCalledWith('Realpath success for: LONGLO~1');
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\test\\LONGLO~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
        });

        it('should handle multiple tilde directories', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\SHORTF~1';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('path-resolved');

            await createDirectory(testPath);

            expect(consoleSpy).toHaveBeenCalledWith('Realpath success for: LONGLO~1');
            expect(consoleSpy).toHaveBeenCalledWith('Realpath success for: SHORTF~1');
            expect(mockRealpath).toHaveBeenCalledTimes(2);
        });

        it('should handle path with no tildes', async () => {
            const testPath = 'C:\\Users\\test\\regularfolder\\subfolder';
            mockMkdir.mockResolvedValue(undefined as any);

            await createDirectory(testPath);

            // Should only call mkdir for final path (no tilde checks)
            expect(mockMkdir).toHaveBeenCalledTimes(1);
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
            expect(mockRealpath).not.toHaveBeenCalled();
        });
    });

    describe('Directory Creation', () => {
        it('should create directories incrementally for tilde paths', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\subfolder';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\base\\LONGLO~1');

            await createDirectory(testPath);

            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1\\subfolder', { recursive: true });
        });

        it('should create remaining path after last tilde directory', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\sub1\\sub2\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\base\\LONGLO~1');
            (path.join as jest.MockedFunction<typeof path.join>).mockReturnValue('C:\\base\\LONGLO~1\\sub1\\sub2\\file.txt');

            await createDirectory(testPath);

            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1\\sub1\\sub2\\file.txt', { recursive: true });
        });

        it('should not create remaining path if tilde is last directory', async () => {
            const testPath = 'C:\\base\\LONGLO~1';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\base\\LONGLO~1');

            await createDirectory(testPath);

            // Should call mkdir only once since path ends with tilde (optimized to skip redundant final mkdir)
            expect(mockMkdir).toHaveBeenCalledTimes(1);
            expect(mockMkdir).toHaveBeenCalledWith('C:\\base\\LONGLO~1', { recursive: true });
        });
    });

    describe('Collision Detection', () => {
        it('should detect collision when realpath fails', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\subfolder';
            mockMkdir.mockResolvedValue(undefined as any);
            const error: any = new Error('ENOENT: no such file or directory');
            error.code = 'ENOENT';
            mockRealpath.mockRejectedValue(error);

            await expect(createDirectory(testPath)).rejects.toMatchObject({
                message: expect.stringContaining('Cannot copy on destination due to 8.3 collision for path: C:\\base\\LONGLO~1'),
                code: 'E8DOT3_COLLISION'
            });

            expect(mockRealpath).toHaveBeenCalledWith('C:\\base\\LONGLO~1');
        });

        it('should succeed when realpath succeeds (no collision)', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\subfolder';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\base\\LONGLO~1');

            await expect(createDirectory(testPath)).resolves.toBeUndefined();

            expect(consoleSpy).toHaveBeenCalledWith('Realpath success for: LONGLO~1');
        });

        it('should handle multiple tilde directories with mixed collision results', async () => {
            const testPath = 'C:\\base\\LONGLO~1\\SHORTF~1\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            
            const error: any = new Error('Collision');
            error.code = 'ENOENT';
            
            // First tilde succeeds, second tilde fails (collision)
            mockRealpath
                .mockResolvedValueOnce('C:\\base\\LONGLO~1')  // First call succeeds
                .mockRejectedValueOnce(error); // Second call fails

            await expect(createDirectory(testPath)).rejects.toMatchObject({
                message: expect.stringContaining('Cannot copy on destination due to 8.3 collision for path: C:\\base\\LONGLO~1\\SHORTF~1'),
                code: 'E8DOT3_COLLISION'
            });

            expect(mockRealpath).toHaveBeenCalledTimes(2);
        });
    });

    describe('Error Handling', () => {
        it('should propagate mkdir errors that are not collision-related', async () => {
            const testPath = 'C:\\base\\regularfolder';
            const error: any = new Error('Permission denied');
            error.code = 'EPERM';
            mockMkdir.mockRejectedValue(error);

            await expect(createDirectory(testPath)).rejects.toMatchObject({
                message: 'Permission denied',
                code: 'EPERM'
            });
        });

        it('should create proper error message with directory name', async () => {
            const testPath = 'C:\\base\\TESTDIR~1';
            mockMkdir.mockResolvedValue(undefined as any);
            const error: any = new Error('Collision');
            error.code = 'ENOENT';
            mockRealpath.mockRejectedValue(error);

            await expect(createDirectory(testPath)).rejects.toMatchObject({
                message: 'Cannot copy on destination due to 8.3 collision for path: C:\\base\\TESTDIR~1',
                code: 'E8DOT3_COLLISION'
            });
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty path', async () => {
            const testPath = '';
            mockMkdir.mockResolvedValue(undefined as any);
            
            await createDirectory(testPath);

            // Should just call mkdir with empty path
            expect(mockMkdir).toHaveBeenCalledWith('', { recursive: true });
        });

        it('should handle root path with tilde', async () => {
            const testPath = 'LONGLO~1';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('LONGLO~1');

            await createDirectory(testPath);

            expect(mockMkdir).toHaveBeenCalledWith('LONGLO~1', { recursive: true });
            expect(mockRealpath).toHaveBeenCalledWith('LONGLO~1');
        });

        it('should handle path with tilde at the end', async () => {
            const testPath = 'C:\\Users\\Documents\\LONGLO~1';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\Users\\Documents\\LONGLO~1');

            await createDirectory(testPath);

            // Should call mkdir only once since path ends with tilde (optimized to skip redundant final mkdir)
            expect(mockMkdir).toHaveBeenCalledTimes(1);
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\Documents\\LONGLO~1', { recursive: true });
        });

        it('should handle non-Windows platform with tilde in path', async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

            const testPath = '/home/user/LONGFO~1/data';
            mockMkdir.mockResolvedValue(undefined as any);

            await createDirectory(testPath);

            // Should use regular mkdir without realpath checks
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
            expect(mockRealpath).not.toHaveBeenCalled();

            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        });

        it('should handle path with special characters and tildes', async () => {
            const testPath = 'C:\\Users\\[test]\\LONGFO~1\\{data}\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\Users\\[test]\\LONGFO~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledWith('C:\\Users\\[test]\\LONGFO~1');
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\[test]\\LONGFO~1', { recursive: true });
        });

        it('should handle path with Unicode characters and tildes', async () => {
            const testPath = 'C:\\Users\\测试\\LONGFO~1\\données';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\Users\\测试\\LONGFO~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledWith('C:\\Users\\测试\\LONGFO~1');
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\测试\\LONGFO~1', { recursive: true });
        });

        it('should handle path with dots and tildes', async () => {
            const testPath = 'C:\\Users\\user.name\\DOCUME~1\\file.2024.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\Users\\user.name\\DOCUME~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledWith('C:\\Users\\user.name\\DOCUME~1');
        });

        it('should handle path with multiple consecutive separators', async () => {
            const testPath = 'C:\\\\Users\\\\LONGFO~1\\\\data';
            mockMkdir.mockResolvedValue(undefined as any);
            // Path.split will create empty strings for consecutive separators
            mockRealpath.mockResolvedValue('C:\\\\Users\\\\LONGFO~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalled();
        });
    });

    describe('Complex Directory Structures', () => {
        describe('Data-Driven Tests for Various Directory Patterns', () => {
            interface DirectoryTestCase {
                description: string;
                input: string;
                expectedTildePaths: string[];  // Paths where realpath should be checked
                expectedMkdirCalls: string[];  // All expected mkdir calls in order
            }

            const testCases: DirectoryTestCase[] = [
                {
                    description: 'no tildes - regular path',
                    input: 'C:\\Users\\MyUser\\Documents\\Files\\data.txt',
                    expectedTildePaths: [],
                    expectedMkdirCalls: ['C:\\Users\\MyUser\\Documents\\Files\\data.txt']
                },
                {
                    description: 'single tilde at root level',
                    input: 'C:\\PROGRA~1\\data',
                    expectedTildePaths: ['C:\\PROGRA~1'],
                    expectedMkdirCalls: ['C:\\PROGRA~1', 'C:\\PROGRA~1\\data']
                },
                {
                    description: 'single tilde at end (optimized)',
                    input: 'C:\\Users\\Documents\\LONGFO~1',
                    expectedTildePaths: ['C:\\Users\\Documents\\LONGFO~1'],
                    expectedMkdirCalls: ['C:\\Users\\Documents\\LONGFO~1']
                },
                {
                    description: 'multiple consecutive tildes',
                    input: 'C:\\PROGRA~1\\MICROS~1\\WINDOW~1\\file.txt',
                    expectedTildePaths: ['C:\\PROGRA~1', 'C:\\PROGRA~1\\MICROS~1', 'C:\\PROGRA~1\\MICROS~1\\WINDOW~1'],
                    expectedMkdirCalls: ['C:\\PROGRA~1', 'C:\\PROGRA~1\\MICROS~1', 'C:\\PROGRA~1\\MICROS~1\\WINDOW~1', 'C:\\PROGRA~1\\MICROS~1\\WINDOW~1\\file.txt']
                },
                {
                    description: 'all directories have tildes ending with tilde',
                    input: 'C:\\FIRST~1\\SECOND~1\\THIRD~1',
                    expectedTildePaths: ['C:\\FIRST~1', 'C:\\FIRST~1\\SECOND~1', 'C:\\FIRST~1\\SECOND~1\\THIRD~1'],
                    expectedMkdirCalls: ['C:\\FIRST~1', 'C:\\FIRST~1\\SECOND~1', 'C:\\FIRST~1\\SECOND~1\\THIRD~1']
                },
                {
                    description: 'alternating tilde and regular directories',
                    input: 'C:\\Users\\ADMINI~1\\AppData\\LOCALS~1\\Temp\\myfile.dat',
                    expectedTildePaths: ['C:\\Users\\ADMINI~1', 'C:\\Users\\ADMINI~1\\AppData\\LOCALS~1'],
                    expectedMkdirCalls: ['C:\\Users\\ADMINI~1', 'C:\\Users\\ADMINI~1\\AppData\\LOCALS~1', 'C:\\Users\\ADMINI~1\\AppData\\LOCALS~1\\Temp\\myfile.dat']
                },
                {
                    description: 'tilde at beginning with long tail',
                    input: 'C:\\PROGRA~1\\MyApp\\data\\cache\\temp\\logs\\file.log',
                    expectedTildePaths: ['C:\\PROGRA~1'],
                    expectedMkdirCalls: ['C:\\PROGRA~1', 'C:\\PROGRA~1\\MyApp\\data\\cache\\temp\\logs\\file.log']
                },
                {
                    description: 'tilde in middle with directories before and after',
                    input: 'C:\\base\\level1\\MIDDLE~1\\level3\\level4\\file.txt',
                    expectedTildePaths: ['C:\\base\\level1\\MIDDLE~1'],
                    expectedMkdirCalls: ['C:\\base\\level1\\MIDDLE~1', 'C:\\base\\level1\\MIDDLE~1\\level3\\level4\\file.txt']
                },
                {
                    description: 'UNC path with tildes',
                    input: '\\\\server\\share\\LONGFO~1\\SHORTF~1\\data',
                    expectedTildePaths: ['\\\\server\\share\\LONGFO~1', '\\\\server\\share\\LONGFO~1\\SHORTF~1'],
                    expectedMkdirCalls: ['\\\\server\\share\\LONGFO~1', '\\\\server\\share\\LONGFO~1\\SHORTF~1', '\\\\server\\share\\LONGFO~1\\SHORTF~1\\data']
                },
                {
                    description: 'deep nesting with 5 consecutive tildes',
                    input: 'C:\\DIR1~1\\DIR2~1\\DIR3~1\\DIR4~1\\DIR5~1\\final',
                    expectedTildePaths: ['C:\\DIR1~1', 'C:\\DIR1~1\\DIR2~1', 'C:\\DIR1~1\\DIR2~1\\DIR3~1', 'C:\\DIR1~1\\DIR2~1\\DIR3~1\\DIR4~1', 'C:\\DIR1~1\\DIR2~1\\DIR3~1\\DIR4~1\\DIR5~1'],
                    expectedMkdirCalls: ['C:\\DIR1~1', 'C:\\DIR1~1\\DIR2~1', 'C:\\DIR1~1\\DIR2~1\\DIR3~1', 'C:\\DIR1~1\\DIR2~1\\DIR3~1\\DIR4~1', 'C:\\DIR1~1\\DIR2~1\\DIR3~1\\DIR4~1\\DIR5~1', 'C:\\DIR1~1\\DIR2~1\\DIR3~1\\DIR4~1\\DIR5~1\\final']
                },
                {
                    description: 'numeric suffixes ~2 through ~9',
                    input: 'C:\\FOLDER~2\\SUBDIR~5\\FILE~9\\data.txt',
                    expectedTildePaths: ['C:\\FOLDER~2', 'C:\\FOLDER~2\\SUBDIR~5', 'C:\\FOLDER~2\\SUBDIR~5\\FILE~9'],
                    expectedMkdirCalls: ['C:\\FOLDER~2', 'C:\\FOLDER~2\\SUBDIR~5', 'C:\\FOLDER~2\\SUBDIR~5\\FILE~9', 'C:\\FOLDER~2\\SUBDIR~5\\FILE~9\\data.txt']
                },
                {
                    description: 'path with spaces and tildes',
                    input: 'C:\\Program Files\\COMMON~1\\My Folder\\SUBDIR~1\\data',
                    expectedTildePaths: ['C:\\Program Files\\COMMON~1', 'C:\\Program Files\\COMMON~1\\My Folder\\SUBDIR~1'],
                    expectedMkdirCalls: ['C:\\Program Files\\COMMON~1', 'C:\\Program Files\\COMMON~1\\My Folder\\SUBDIR~1', 'C:\\Program Files\\COMMON~1\\My Folder\\SUBDIR~1\\data']
                },
                {
                    description: 'single character dirs with tildes',
                    input: 'C:\\A~1\\B~2\\C~3\\file.txt',
                    expectedTildePaths: ['C:\\A~1', 'C:\\A~1\\B~2', 'C:\\A~1\\B~2\\C~3'],
                    expectedMkdirCalls: ['C:\\A~1', 'C:\\A~1\\B~2', 'C:\\A~1\\B~2\\C~3', 'C:\\A~1\\B~2\\C~3\\file.txt']
                },
                {
                    description: 'root level tilde only',
                    input: 'TEMPDI~1',
                    expectedTildePaths: ['TEMPDI~1'],
                    expectedMkdirCalls: ['TEMPDI~1']
                },
                {
                    description: 'two tildes with regular dir in middle',
                    input: 'C:\\FIRST~1\\regular\\SECOND~1\\file.dat',
                    expectedTildePaths: ['C:\\FIRST~1', 'C:\\FIRST~1\\regular\\SECOND~1'],
                    expectedMkdirCalls: ['C:\\FIRST~1', 'C:\\FIRST~1\\regular\\SECOND~1', 'C:\\FIRST~1\\regular\\SECOND~1\\file.dat']
                },
                {
                    description: 'empty path',
                    input: '',
                    expectedTildePaths: [],
                    expectedMkdirCalls: ['']
                }
            ];

            testCases.forEach((testCase) => {
                it(`should handle: ${testCase.description}`, async () => {
                    mockMkdir.mockResolvedValue(undefined as any);
                    
                    // Mock realpath to succeed for all expected tilde paths
                    testCase.expectedTildePaths.forEach((tildePath) => {
                        mockRealpath.mockResolvedValueOnce(tildePath);
                    });

                    await createDirectory(testCase.input);

                    // Verify realpath was called for each expected tilde path
                    expect(mockRealpath).toHaveBeenCalledTimes(testCase.expectedTildePaths.length);
                    testCase.expectedTildePaths.forEach((tildePath) => {
                        expect(mockRealpath).toHaveBeenCalledWith(tildePath);
                    });

                    // Verify mkdir was called with expected paths
                    expect(mockMkdir).toHaveBeenCalledTimes(testCase.expectedMkdirCalls.length);
                    testCase.expectedMkdirCalls.forEach((mkdirPath, index) => {
                        expect(mockMkdir).toHaveBeenNthCalledWith(index + 1, mkdirPath, { recursive: true });
                    });
                });
            });
        });

        describe('Collision Detection in Various Structures', () => {
            interface CollisionTestCase {
                description: string;
                input: string;
                collisionAtPath: string;  // Which tilde path should fail
                collisionIndex: number;    // At which realpath call should it fail (0-based)
                successfulPaths: string[]; // Paths that succeed before collision
            }

            const collisionCases: CollisionTestCase[] = [
                {
                    description: 'collision at first tilde',
                    input: 'C:\\PROGRA~1\\data\\file.txt',
                    collisionAtPath: 'C:\\PROGRA~1',
                    collisionIndex: 0,
                    successfulPaths: []
                },
                {
                    description: 'collision at second tilde after first succeeds',
                    input: 'C:\\FIRST~1\\SECOND~1\\file.txt',
                    collisionAtPath: 'C:\\FIRST~1\\SECOND~1',
                    collisionIndex: 1,
                    successfulPaths: ['C:\\FIRST~1']
                },
                {
                    description: 'collision in middle of three tildes',
                    input: 'C:\\ONE~1\\TWO~1\\THREE~1\\data',
                    collisionAtPath: 'C:\\ONE~1\\TWO~1',
                    collisionIndex: 1,
                    successfulPaths: ['C:\\ONE~1']
                },
                {
                    description: 'collision at last tilde in sequence',
                    input: 'C:\\DIR1~1\\DIR2~1\\DIR3~1',
                    collisionAtPath: 'C:\\DIR1~1\\DIR2~1\\DIR3~1',
                    collisionIndex: 2,
                    successfulPaths: ['C:\\DIR1~1', 'C:\\DIR1~1\\DIR2~1']
                },
                {
                    description: 'collision in deeply nested path',
                    input: 'C:\\base\\level1\\level2\\LONGNA~1\\level4\\level5\\file.txt',
                    collisionAtPath: 'C:\\base\\level1\\level2\\LONGNA~1',
                    collisionIndex: 0,
                    successfulPaths: []
                },
                {
                    description: 'collision in UNC path',
                    input: '\\\\server\\share\\FOLDER~1\\data',
                    collisionAtPath: '\\\\server\\share\\FOLDER~1',
                    collisionIndex: 0,
                    successfulPaths: []
                },
                {
                    description: 'collision at root level tilde',
                    input: 'TEMPDI~1\\subdir',
                    collisionAtPath: 'TEMPDI~1',
                    collisionIndex: 0,
                    successfulPaths: []
                }
            ];

            collisionCases.forEach((testCase) => {
                it(`should detect ${testCase.description}`, async () => {
                    mockMkdir.mockResolvedValue(undefined as any);
                    
                    const error: any = new Error('ENOENT');
                    error.code = 'ENOENT';
                    
                    // Mock successful realpath calls before collision
                    testCase.successfulPaths.forEach((path) => {
                        mockRealpath.mockResolvedValueOnce(path);
                    });
                    
                    // Mock the collision
                    mockRealpath.mockRejectedValueOnce(error);

                    await expect(createDirectory(testCase.input)).rejects.toMatchObject({
                        message: expect.stringContaining(`Cannot copy on destination due to 8.3 collision for path: ${testCase.collisionAtPath}`),
                        code: 'E8DOT3_COLLISION'
                    });

                    expect(mockRealpath).toHaveBeenCalledTimes(testCase.collisionIndex + 1);
                    expect(mockRealpath).toHaveBeenCalledWith(testCase.collisionAtPath);
                });
            });
        });

        it('should handle deep nested path with multiple tildes', async () => {
            const testPath = 'C:\\PROGRA~1\\MICROS~1\\WINDOW~1\\System32\\config';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath
                .mockResolvedValueOnce('C:\\PROGRA~1')
                .mockResolvedValueOnce('C:\\PROGRA~1\\MICROS~1')
                .mockResolvedValueOnce('C:\\PROGRA~1\\MICROS~1\\WINDOW~1');

            await createDirectory(testPath);

            // Should check realpath for each tilde directory
            expect(mockRealpath).toHaveBeenCalledTimes(3);
            expect(mockRealpath).toHaveBeenCalledWith('C:\\PROGRA~1');
            expect(mockRealpath).toHaveBeenCalledWith('C:\\PROGRA~1\\MICROS~1');
            expect(mockRealpath).toHaveBeenCalledWith('C:\\PROGRA~1\\MICROS~1\\WINDOW~1');
            
            // Should create all directories
            expect(mockMkdir).toHaveBeenCalledWith('C:\\PROGRA~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\PROGRA~1\\MICROS~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\PROGRA~1\\MICROS~1\\WINDOW~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
        });

        it('should handle alternating tilde and regular directories', async () => {
            const testPath = 'C:\\Users\\ADMINI~1\\AppData\\LOCALS~1\\Temp\\myfile';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath
                .mockResolvedValueOnce('C:\\Users\\ADMINI~1')
                .mockResolvedValueOnce('C:\\Users\\ADMINI~1\\AppData\\LOCALS~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledTimes(2);
            expect(mockRealpath).toHaveBeenCalledWith('C:\\Users\\ADMINI~1');
            expect(mockRealpath).toHaveBeenCalledWith('C:\\Users\\ADMINI~1\\AppData\\LOCALS~1');
            
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\ADMINI~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\ADMINI~1\\AppData\\LOCALS~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
        });

        it('should handle path with consecutive tilde directories', async () => {
            const testPath = 'C:\\DOCUME~1\\ADMINI~1\\LOCALS~1\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath
                .mockResolvedValueOnce('C:\\DOCUME~1')
                .mockResolvedValueOnce('C:\\DOCUME~1\\ADMINI~1')
                .mockResolvedValueOnce('C:\\DOCUME~1\\ADMINI~1\\LOCALS~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledTimes(3);
            expect(mockMkdir).toHaveBeenCalledWith('C:\\DOCUME~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\DOCUME~1\\ADMINI~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\DOCUME~1\\ADMINI~1\\LOCALS~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
        });

        it('should handle very long path with many subdirectories after tilde', async () => {
            const testPath = 'C:\\PROGRA~1\\data\\level1\\level2\\level3\\level4\\level5\\file.dat';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\PROGRA~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledTimes(1);
            expect(mockRealpath).toHaveBeenCalledWith('C:\\PROGRA~1');
            expect(mockMkdir).toHaveBeenCalledWith('C:\\PROGRA~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
        });

        it('should handle UNC path with tilde directories', async () => {
            const testPath = '\\\\server\\share\\LONGFO~1\\SHORTF~1\\data';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath
                .mockResolvedValueOnce('\\\\server\\share\\LONGFO~1')
                .mockResolvedValueOnce('\\\\server\\share\\LONGFO~1\\SHORTF~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledTimes(2);
            expect(mockMkdir).toHaveBeenCalledWith('\\\\server\\share\\LONGFO~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('\\\\server\\share\\LONGFO~1\\SHORTF~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
        });

        it('should handle mixed case tilde patterns', async () => {
            const testPath = 'C:\\Users\\MyUser\\DOCUME~1\\MyData~2\\Files~3\\doc.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath
                .mockResolvedValueOnce('C:\\Users\\MyUser\\DOCUME~1')
                .mockResolvedValueOnce('C:\\Users\\MyUser\\DOCUME~1\\MyData~2')
                .mockResolvedValueOnce('C:\\Users\\MyUser\\DOCUME~1\\MyData~2\\Files~3');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledTimes(3);
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\MyUser\\DOCUME~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\MyUser\\DOCUME~1\\MyData~2', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Users\\MyUser\\DOCUME~1\\MyData~2\\Files~3', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
        });

        it('should handle collision in deeply nested structure', async () => {
            const testPath = 'C:\\base\\level1\\LONGNA~1\\level3\\level4\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            const error: any = new Error('ENOENT');
            error.code = 'ENOENT';
            mockRealpath.mockRejectedValue(error);

            await expect(createDirectory(testPath)).rejects.toMatchObject({
                message: expect.stringContaining('Cannot copy on destination due to 8.3 collision for path: C:\\base\\level1\\LONGNA~1'),
                code: 'E8DOT3_COLLISION'
            });

            expect(mockRealpath).toHaveBeenCalledWith('C:\\base\\level1\\LONGNA~1');
        });

        it('should handle collision in middle of consecutive tildes', async () => {
            const testPath = 'C:\\FIRST~1\\SECOND~1\\THIRD~1\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            const error: any = new Error('ENOENT');
            error.code = 'ENOENT';
            
            mockRealpath
                .mockResolvedValueOnce('C:\\FIRST~1')  // First succeeds
                .mockRejectedValueOnce(error);          // Second fails (collision)

            await expect(createDirectory(testPath)).rejects.toMatchObject({
                message: expect.stringContaining('Cannot copy on destination due to 8.3 collision for path: C:\\FIRST~1\\SECOND~1'),
                code: 'E8DOT3_COLLISION'
            });

            expect(mockRealpath).toHaveBeenCalledTimes(2);
            expect(mockMkdir).toHaveBeenCalledWith('C:\\FIRST~1', { recursive: true });
        });

        it('should handle path with spaces and tildes', async () => {
            const testPath = 'C:\\Program Files\\COMMON~1\\My Folder\\SUBDIR~1\\data';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath
                .mockResolvedValueOnce('C:\\Program Files\\COMMON~1')
                .mockResolvedValueOnce('C:\\Program Files\\COMMON~1\\My Folder\\SUBDIR~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledTimes(2);
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Program Files\\COMMON~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith('C:\\Program Files\\COMMON~1\\My Folder\\SUBDIR~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
        });

        it('should handle single character directory names with tildes', async () => {
            const testPath = 'C:\\A~1\\B~2\\C~3\\file.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath
                .mockResolvedValueOnce('C:\\A~1')
                .mockResolvedValueOnce('C:\\A~1\\B~2')
                .mockResolvedValueOnce('C:\\A~1\\B~2\\C~3');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledTimes(3);
            expect(mockMkdir).toHaveBeenCalledTimes(4);
        });

        it('should handle numeric suffixes greater than 1', async () => {
            const testPath = 'C:\\LONGNA~2\\FOLDER~3\\SUBDIR~9\\data.txt';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath
                .mockResolvedValueOnce('C:\\LONGNA~2')
                .mockResolvedValueOnce('C:\\LONGNA~2\\FOLDER~3')
                .mockResolvedValueOnce('C:\\LONGNA~2\\FOLDER~3\\SUBDIR~9');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledTimes(3);
            expect(mockRealpath).toHaveBeenCalledWith('C:\\LONGNA~2');
            expect(mockRealpath).toHaveBeenCalledWith('C:\\LONGNA~2\\FOLDER~3');
            expect(mockRealpath).toHaveBeenCalledWith('C:\\LONGNA~2\\FOLDER~3\\SUBDIR~9');
        });

        it('should handle path ending with multiple regular directories after tilde', async () => {
            const testPath = 'C:\\PROGRA~1\\MyApp\\data\\cache\\temp\\logs';
            mockMkdir.mockResolvedValue(undefined as any);
            mockRealpath.mockResolvedValue('C:\\PROGRA~1');

            await createDirectory(testPath);

            expect(mockRealpath).toHaveBeenCalledTimes(1);
            expect(mockMkdir).toHaveBeenCalledWith('C:\\PROGRA~1', { recursive: true });
            expect(mockMkdir).toHaveBeenCalledWith(testPath, { recursive: true });
        });
    });
});