import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CommandStatus, ErrorType, OPS_CMD, OPS_STATUS } from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as path from 'path';
import { dmError, getFilePermissions, getFileType, } from 'src/activities/utils/utils';
import { mockLogger } from 'src/auth/auth.service.spec';
import { WorkerThreadService } from 'src/thread/worker.thread.service';
import { MetricsService } from 'src/metrics/metrics.service';
import { CommandExecService } from './command-execution.service';
import { StampMetaService } from './stamp-meta.service';
import { StampAtimeService } from './stamp-atime.service';
import { createDirectory } from 'src/activities/utils/directory.utils';

// Mock fs module
jest.mock('fs', () => ({
    mkdirSync: jest.fn(),
    existsSync: jest.fn(() => true), // Add existsSync mock for systeminformation module
    promises: {
        access: jest.fn(),
        mkdir: jest.fn(),
        unlink: jest.fn(),
        rm: jest.fn(),
        lstat: jest.fn(),
    },
}));

// Mock path module
jest.mock('path', () => ({
    extname: jest.fn(),
}));

// Mock utils functions
jest.mock('src/activities/utils/utils', () => {
    const actualUtils = jest.requireActual('src/activities/utils/utils');
    return {
        ...actualUtils,
        dmError: jest.fn(),
        getFilePermissions: jest.fn(),
        getFileType: jest.fn(),
    };
});
// Mock isPathExists and isNotWritable from the correct module
jest.mock('src/activities/core/utils/utils', () => {
    const actualUtils = jest.requireActual('src/activities/core/utils/utils');
    return {
        ...actualUtils,
        isPathExists: jest.fn(),
        isNotWritable: jest.fn(),
    };
});

// Mock directory utils
jest.mock('src/activities/utils/directory.utils', () => ({
    createDirectory: jest.fn(),
}));

describe('CommandExecService', () => {
    let service: CommandExecService;
    let configService: jest.Mocked<ConfigService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;
    let workerThreadService: jest.Mocked<WorkerThreadService>;
    let stampMetaService: jest.Mocked<StampMetaService>;
    let stampAtimeService: jest.Mocked<StampAtimeService>;
    let mockJobContext: any;

    const mockFs = fs as jest.Mocked<typeof fs>;
    const mockCreateDirectory = createDirectory as jest.MockedFunction<typeof createDirectory>;

    beforeEach(async () => {
        configService = {
            get: jest.fn().mockImplementation((key: string) => {
                if (key === 'worker.workerId') return 'test-worker-1';
                return undefined;
            }),
        } as any;

        loggerFactory = {
            create: jest.fn().mockReturnValue(mockLogger),
        } as any;

        workerThreadService = {
            migrateWorkerThread: jest.fn(),
        } as any;

        stampMetaService = {
            stampMetaData: jest.fn(),
            restoreFileAttribute: jest.fn(),
            removeFileAttributeTemporarily: jest.fn(),
            resetFileAttributes: jest.fn(),
        } as any;

        stampAtimeService = {
            stampAtime: jest.fn().mockResolvedValue({ shouldStampMeta: false, sourceErrors: [], targetErrors: [], shouldUpdateItemInfo: true }),
        } as any;

        const mockMetricsService = {
            runWithTiming: jest.fn().mockImplementation((_workflowId: string, _spec: string, fn: () => unknown) =>
                typeof fn === 'function' ? Promise.resolve(fn()) : Promise.resolve(),
            ),
        };

        mockJobContext = {
            publishToErrorStream: jest.fn().mockResolvedValue(undefined),
            publishToFileStream: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CommandExecService,
                { provide: ConfigService, useValue: configService },
                { provide: LoggerFactory, useValue: loggerFactory },
                { provide: WorkerThreadService, useValue: workerThreadService },
                { provide: StampMetaService, useValue: stampMetaService },
                { provide: StampAtimeService, useValue: stampAtimeService },
                { provide: MetricsService, useValue: mockMetricsService },
            ],
        }).compile();

        service = module.get<CommandExecService>(CommandExecService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with correct worker ID', () => {
            expect(service.workerId).toBe('test-worker-1');
            expect(configService.get).toHaveBeenCalledWith('worker.workerId');
        });

        it('should handle undefined workerId from config', async () => {
            configService.get.mockReturnValue(undefined);
            const mockMetricsService = {
                runWithTiming: jest.fn().mockImplementation((_workflowId: string, _spec: string, fn: () => unknown) =>
                    typeof fn === 'function' ? Promise.resolve(fn()) : Promise.resolve(),
                ),
            };
            const module = await Test.createTestingModule({
                providers: [
                    CommandExecService,
                    { provide: ConfigService, useValue: configService },
                    { provide: LoggerFactory, useValue: loggerFactory },
                    { provide: WorkerThreadService, useValue: workerThreadService },
                    { provide: StampMetaService, useValue: stampMetaService },
                    { provide: MetricsService, useValue: mockMetricsService },
                ],
            }).compile();

            const serviceWithUndefinedId = module.get<CommandExecService>(CommandExecService);
            expect(serviceWithUndefinedId.workerId).toBe('');
        });
    });

    describe('copyDirectory', () => {
        const createMockCommand = (status = OPS_STATUS.READY, isDir = true) => ({
            id: 'cmd-1',
            fPath: '/testdir',
            status: CommandStatus.READY,
            isDir,
            ops: {
                [OPS_CMD.COPY_DIR]: { 
                    status,
                    params: {}
                },
            },
            metadata: { 
                size: 1024,
                mtime: new Date(),
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                mode: 644,
                uid: 1000,
                gid: 1000,
                sid: 'test-sid',
                inode: 123456
            },
            serialize: jest.fn(),
        });

        const getBaseInput = () => ({
            sourcePath: '/source/testdir',
            targetPath: '/target/testdir',
            jobContext: mockJobContext,
            command: createMockCommand(),
            errorType: ErrorType.RECOVERABLE_ERROR,
        });

        it('should skip if already completed', async () => {
            const baseInput = getBaseInput();
            const input = {
                ...baseInput,
                command: createMockCommand(OPS_STATUS.COMPLETED),
            };

            const result = await service.copyDirectory(input);

            expect(result.shouldStampMeta).toBe(true);
            expect(mockCreateDirectory).not.toHaveBeenCalled();
        });

        it('should successfully create directory', async () => {
            mockCreateDirectory.mockResolvedValue(undefined);
            const baseInput = getBaseInput();

            const result = await service.copyDirectory(baseInput);

            expect(result.shouldStampMeta).toBe(true);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockCreateDirectory).toHaveBeenCalledWith('/target/testdir');
            expect(baseInput.command.ops[OPS_CMD.COPY_DIR].status).toBe(OPS_STATUS.COMPLETED);
        });

        it('should handle directory creation error', async () => {
            // Create fresh input to avoid state pollution
            const input = {
                sourcePath: '/source/testdir',
                targetPath: '/target/testdir',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            
            const error = new Error('Permission denied') as any;
            error.code = 'EACCES';
            mockCreateDirectory.mockRejectedValue(error);


            const result = await service.copyDirectory(input);

            expect(result.targetErrors).toEqual(['EACCES']);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Copying DIR from /source/testdir to /target/testdir, Error: Permission denied',
                error.stack
            );
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(input.command.ops[OPS_CMD.COPY_DIR].status).toBe(OPS_STATUS.ERROR);
        });
    });

    describe('deleteFile', () => {
        const createMockCommand = (status = OPS_STATUS.READY, isDir = false) => ({
            id: 'cmd-1',
            fPath: '/test.txt',
            status: CommandStatus.READY,
            isDir,
            ops: {
                [OPS_CMD.REMOVE_FILE]: { 
                    status,
                    params: {}
                },
            },
            metadata: { 
                size: 1024,
                mtime: new Date(),
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                mode: 644,
                uid: 1000,
                gid: 1000,
                sid: 'test-sid',
                inode: 123456
            },
            serialize: jest.fn(),
        });

        const baseInput = {
            sourcePath: '/source/test.txt',
            targetPath: '/target/test.txt',
            jobContext: mockJobContext,
            command: createMockCommand(),
            errorType: ErrorType.RECOVERABLE_ERROR,
        };

        beforeEach(() => {
            (mockFs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
        });

        it('should successfully delete file', async () => {
            const result = await service.deleteFile(baseInput);

            expect(result.shouldStampMeta).toBe(false);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.unlink).toHaveBeenCalledWith('/target/test.txt');
            expect(baseInput.command.ops[OPS_CMD.REMOVE_FILE].status).toBe(OPS_STATUS.COMPLETED);
        });

        it('should ignore ENOENT error (file not exists)', async () => {
            const error = new Error('File not found') as any;
            error.code = 'ENOENT';
            (mockFs.promises.unlink as jest.Mock).mockRejectedValue(error);

            const result = await service.deleteFile(baseInput);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockJobContext.publishToErrorStream).not.toHaveBeenCalled();
        });

        it('should handle other deletion errors', async () => {
            // Create fresh input to avoid state pollution
            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            
            const error = new Error('Permission denied') as any;
            error.code = 'EACCES';
            (mockFs.promises.unlink as jest.Mock).mockRejectedValue(error);


            const result = await service.deleteFile(input);

            expect(result.sourceErrors).toEqual(['EACCES']);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Deleting FILE from  /target/test.txt, Error: Permission denied',
                error.stack
            );
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(input.command.ops[OPS_CMD.REMOVE_FILE].status).toBe(OPS_STATUS.ERROR);
        });
    });

    describe('deleteDirectory', () => {
        const createMockCommand = (status = OPS_STATUS.READY, isDir = true) => ({
            id: 'cmd-1',
            fPath: '/testdir',
            status: CommandStatus.READY,
            isDir,
            ops: {
                [OPS_CMD.REMOVE_DIR]: { 
                    status,
                    params: {}
                },
            },
            metadata: { 
                size: 1024,
                mtime: new Date(),
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                mode: 644,
                uid: 1000,
                gid: 1000,
                sid: 'test-sid',
                inode: 123456
            },
            serialize: jest.fn(),
        });

        const baseInput = {
            sourcePath: '/source/testdir',
            targetPath: '/target/testdir',
            jobContext: mockJobContext,
            command: createMockCommand(),
            errorType: ErrorType.RECOVERABLE_ERROR,
        };

        beforeEach(() => {
            (mockFs.promises.rm as jest.Mock).mockResolvedValue(undefined);
        });

        it('should successfully delete directory', async () => {
            const result = await service.deleteDirectory(baseInput);

            expect(result.shouldStampMeta).toBe(false);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.rm).toHaveBeenCalledWith('/target/testdir', { 
                recursive: true, 
                force: true 
            });
            expect(baseInput.command.ops[OPS_CMD.REMOVE_DIR].status).toBe(OPS_STATUS.COMPLETED);
        });

        it('should ignore ENOENT error (directory not exists)', async () => {
            const error = new Error('Directory not found') as any;
            error.code = 'ENOENT';
            (mockFs.promises.rm as jest.Mock).mockRejectedValue(error);

            const result = await service.deleteDirectory(baseInput);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockJobContext.publishToErrorStream).not.toHaveBeenCalled();
        });

        it('should handle other deletion errors', async () => {
            // Create fresh input to avoid state pollution
            const input = {
                sourcePath: '/source/testdir',
                targetPath: '/target/testdir',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            
            const error = new Error('Permission denied') as any;
            error.code = 'EACCES';
            (mockFs.promises.rm as jest.Mock).mockRejectedValue(error);


            const result = await service.deleteDirectory(input);

            expect(result.sourceErrors).toEqual(['EACCES']);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Deleting DIR from  /target/testdir, Error: Permission denied',
                error.stack
            );
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(input.command.ops[OPS_CMD.REMOVE_DIR].status).toBe(OPS_STATUS.ERROR);
        });

        it('should publish deleted directory info to file stream on successful delete', async () => {
            const input = {
                sourcePath: '/source/testdir',
                targetPath: '/target/testdir',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            const result = await service.deleteDirectory(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockJobContext.publishToFileStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    fileName: '/testdir',  // Uses command.fPath
                    isDirectory: true,
                    isSymbolicLink: false,
                    fileType: 'directory',
                    isDeleted: true,
                })
            );
        });

        it('should publish deleted directory info with null checksumTime', async () => {
            const input = {
                sourcePath: '/source/testdir',
                targetPath: '/target/testdir',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            await service.deleteDirectory(input);

            // Assert: checksumTime should be null for delete operations (no checksum generated)
            const publishedItemInfo = mockJobContext.publishToFileStream.mock.calls[0][0];
            expect(publishedItemInfo.checksumTime).toBeNull();
        });

        it('should not publish to file stream when directory deletion fails', async () => {
            const input = {
                sourcePath: '/source/testdir',
                targetPath: '/target/testdir',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            
            const error = new Error('Permission denied') as any;
            error.code = 'EACCES';
            (mockFs.promises.rm as jest.Mock).mockRejectedValue(error);

            // Reset the mock to clear any previous calls
            mockJobContext.publishToFileStream.mockClear();

            await service.deleteDirectory(input);

            expect(mockJobContext.publishToFileStream).not.toHaveBeenCalled();
        });
    });

    describe('executeCommand', () => {

        it('should execute copy directory operation', async () => {
            const createMockCommand = () => ({
                id: 'cmd-1',
                fPath: '/testdir',
                status: CommandStatus.READY,
                isDir: true,
                ops: {
                    [OPS_CMD.COPY_DIR]: { 
                        status: OPS_STATUS.READY,
                        params: {}
                    },
                },
                metadata: { 
                    size: 1024,
                    mtime: new Date(),
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                    mode: 644,
                    uid: 1000,
                    gid: 1000,
                    sid: 'test-sid',
                    inode: 123456
                },
                serialize: jest.fn(),
            });

            const input = {
                sourcePath: '/source/testdir',
                targetPath: '/target/testdir',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            mockCreateDirectory.mockResolvedValue(undefined);
            stampMetaService.stampMetaData.mockResolvedValue({
                shouldStampMeta: false,
                sourceErrors: [],
                targetErrors: [],
                shouldUpdateItemInfo: false,
            });
            jest.spyOn(service, 'buildFileInfo').mockResolvedValue();

            const result = await service.executeCommand(input);

            expect(result.cmd.status).toBe(CommandStatus.COMPLETED);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
        });

        describe('copyContentStatus and stampMetaDataStatus (COC report)', () => {
            it('should pass copyContentStatus not_applicable and stampMetaDataStatus to buildFileInfo for COPY_DIR only', async () => {
                const createMockCommand = () => ({
                    id: 'cmd-dir',
                    fPath: '/testdir',
                    status: CommandStatus.READY,
                    isDir: true,
                    ops: {
                        [OPS_CMD.COPY_DIR]: { status: OPS_STATUS.READY, params: {} },
                    },
                    metadata: {
                        size: 0,
                        mtime: new Date(),
                        atime: new Date(),
                        ctime: new Date(),
                        birthtime: new Date(),
                        mode: 755,
                        uid: 1000,
                        gid: 1000,
                        sid: 'test-sid',
                        inode: 123456,
                    },
                    serialize: jest.fn(),
                });
                mockCreateDirectory.mockResolvedValue(undefined);
                stampMetaService.stampMetaData.mockResolvedValue({
                    shouldStampMeta: false,
                    sourceErrors: [],
                    targetErrors: [],
                    shouldUpdateItemInfo: true,
                });

                const buildFileInfoSpy = jest.spyOn(service, 'buildFileInfo').mockResolvedValue({} as any);
                const input = {
                    sourcePath: '/source/testdir',
                    targetPath: '/target/testdir',
                    jobContext: mockJobContext,
                    command: createMockCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                };

                await service.executeCommand(input);

                expect(buildFileInfoSpy).toHaveBeenCalled();
                const callInput = buildFileInfoSpy.mock.calls[0][0];
                expect(callInput.copyContentStatus).toBe('not_applicable');
                expect(callInput.stampMetaDataStatus).toBe('success');
            });

            it('should set copyContentStatus success and stampMetaDataStatus when COPY_FILE completed and stamp succeeds', async () => {
                const createMockCommand = () => ({
                    id: 'cmd-file',
                    fPath: '/test.txt',
                    status: CommandStatus.READY,
                    isDir: false,
                    ops: {
                        [OPS_CMD.COPY_FILE]: { status: OPS_STATUS.COMPLETED, params: { checksums: { sourceChecksum: 'a', targetChecksum: 'a' } } },
                    },
                    metadata: {
                        size: 1024,
                        mtime: new Date(),
                        atime: new Date(),
                        ctime: new Date(),
                        birthtime: new Date(),
                        mode: 644,
                        uid: 1000,
                        gid: 1000,
                        sid: 'test-sid',
                        inode: 123456,
                    },
                    serialize: jest.fn(),
                });
                stampMetaService.stampMetaData.mockResolvedValue({
                    shouldStampMeta: false,
                    sourceErrors: [],
                    targetErrors: [],
                    shouldUpdateItemInfo: true,
                });
                const mockItemInfo = { fileName: '/test.txt', copyContentStatus: 'success', stampMetaDataStatus: 'success' } as any;
                const buildFileInfoSpy = jest.spyOn(service, 'buildFileInfo').mockResolvedValue(mockItemInfo);
                const input = {
                    sourcePath: '/source/test.txt',
                    targetPath: '/target/test.txt',
                    jobContext: mockJobContext,
                    command: createMockCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                };

                await service.executeCommand(input);

                expect(buildFileInfoSpy).toHaveBeenCalled();
                const callInput = buildFileInfoSpy.mock.calls[0][0];
                expect(callInput.copyContentStatus).toBe('success');
                expect(callInput.stampMetaDataStatus).toBe('success');
            });

            it('should set copyContentStatus failed when stampMeta has errors', async () => {
                const createMockCommand = () => ({
                    id: 'cmd-file-fail',
                    fPath: '/test.txt',
                    status: CommandStatus.READY,
                    isDir: false,
                    ops: {
                        [OPS_CMD.COPY_FILE]: { status: OPS_STATUS.COMPLETED, params: {} },
                        [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} },
                    },
                    metadata: {
                        size: 1024,
                        mtime: new Date(),
                        atime: new Date(),
                        ctime: new Date(),
                        birthtime: new Date(),
                        mode: 644,
                        uid: 1000,
                        gid: 1000,
                        sid: 'test-sid',
                        inode: 123456,
                    },
                    serialize: jest.fn(),
                });
                stampMetaService.stampMetaData.mockResolvedValue({
                    shouldStampMeta: false,
                    sourceErrors: [],
                    targetErrors: ['EACCES'],
                    shouldUpdateItemInfo: true,
                });
                const buildFileInfoSpy = jest.spyOn(service, 'buildFileInfo').mockResolvedValue({} as any);
                const input = {
                    sourcePath: '/source/test.txt',
                    targetPath: '/target/test.txt',
                    jobContext: mockJobContext,
                    command: createMockCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                };

                await service.executeCommand(input);

                const callInput = buildFileInfoSpy.mock.calls[0][0];
                expect(callInput.stampMetaDataStatus).toBe('failed');
            });
        });

        describe('STAMP_ATIME routing', () => {
            const buildAtimeOnlyCommand = () => ({
                id: 'cmd-atime',
                fPath: '/test.txt',
                status: CommandStatus.READY,
                isDir: false,
                ops: {
                    [OPS_CMD.COPY_FILE]: { status: OPS_STATUS.COMPLETED, params: { targetExisted: true } },
                    [OPS_CMD.STAMP_ATIME]: { status: OPS_STATUS.READY, params: {} },
                },
                metadata: {
                    size: 1024,
                    mtime: new Date('2024-01-01T00:00:00.000Z'),
                    atime: new Date('2024-06-01T00:00:00.000Z'),
                    ctime: new Date('2024-01-01T00:00:00.000Z'),
                    birthtime: new Date(),
                    mode: 644,
                    uid: 1000,
                    gid: 1000,
                    sid: 'test-sid',
                    inode: 123456,
                },
                serialize: jest.fn(),
            });

            it('should invoke stampAtimeService.stampAtime (not stampMetaService) when STAMP_ATIME op is present', async () => {
                stampAtimeService.stampAtime.mockResolvedValue({
                    shouldStampMeta: false,
                    sourceErrors: [],
                    targetErrors: [],
                    shouldUpdateItemInfo: true,
                });
                const buildFileInfoSpy = jest.spyOn(service, 'buildFileInfo').mockResolvedValue({} as any);

                await service.executeCommand({
                    sourcePath: '/source/test.txt',
                    targetPath: '/target/test.txt',
                    jobContext: mockJobContext,
                    command: buildAtimeOnlyCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                });

                expect(stampAtimeService.stampAtime).toHaveBeenCalledTimes(1);
                expect(stampMetaService.stampMetaData).not.toHaveBeenCalled();
                const callInput = buildFileInfoSpy.mock.calls[0][0];
                expect(callInput.stampMetaDataStatus).toBe('success');
            });

            it('should mark stampMetaDataStatus failed when stampAtime returns errors', async () => {
                stampAtimeService.stampAtime.mockResolvedValue({
                    shouldStampMeta: false,
                    sourceErrors: [],
                    targetErrors: ['EPERM'],
                    shouldUpdateItemInfo: true,
                });
                const buildFileInfoSpy = jest.spyOn(service, 'buildFileInfo').mockResolvedValue({} as any);

                const result = await service.executeCommand({
                    sourcePath: '/source/test.txt',
                    targetPath: '/target/test.txt',
                    jobContext: mockJobContext,
                    command: buildAtimeOnlyCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                });

                const callInput = buildFileInfoSpy.mock.calls[0][0];
                expect(callInput.stampMetaDataStatus).toBe('failed');
                expect(result.cmd.status).toBe(CommandStatus.ERROR);
            });
        });

        it('should execute delete file operation', async () => {
            const createMockCommand = () => ({
                id: 'cmd-1',
                fPath: '/test.txt',
                status: CommandStatus.READY,
                isDir: false,
                ops: {
                    [OPS_CMD.REMOVE_FILE]: { 
                        status: OPS_STATUS.READY,
                        params: {}
                    },
                },
                metadata: { 
                    size: 1024,
                    mtime: new Date(),
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                    mode: 644,
                    uid: 1000,
                    gid: 1000,
                    sid: 'test-sid',
                    inode: 123456
                },
                serialize: jest.fn(),
            });

            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            (mockFs.promises.unlink as jest.Mock).mockResolvedValue(undefined);

            const result = await service.executeCommand(input);

            expect(result.cmd.status).toBe(CommandStatus.COMPLETED);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
        });

        it('should execute delete directory operation', async () => {
            const createMockCommand = () => ({
                id: 'cmd-1',
                fPath: '/testdir',
                status: CommandStatus.READY,
                isDir: true,
                ops: {
                    [OPS_CMD.REMOVE_DIR]: { 
                        status: OPS_STATUS.READY,
                        params: {}
                    },
                },
                metadata: { 
                    size: 1024,
                    mtime: new Date(),
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                    mode: 644,
                    uid: 1000,
                    gid: 1000,
                    sid: 'test-sid',
                    inode: 123456
                },
                serialize: jest.fn(),
            });

            const input = {
                sourcePath: '/source/testdir',
                targetPath: '/target/testdir',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            (mockFs.promises.rm as jest.Mock).mockResolvedValue(undefined);

            const result = await service.executeCommand(input);

            expect(result.cmd.status).toBe(CommandStatus.COMPLETED);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
        });

        describe('buildFileInfo', () => {
            const createMockCommand = () => ({
            id: 'cmd-1',
            fPath: '/test.txt',
            status: CommandStatus.READY,
            isDir: false,
            ops: {
                [OPS_CMD.COPY_FILE]: {
                status: OPS_STATUS.COMPLETED,
                params: {
                    checksums: {
                    sourceChecksum: 'src-checksum',
                    targetChecksum: 'tgt-checksum'
                    }
                }
                },
                [OPS_CMD.STAMP_META]: {
                params: {
                    sidMap: {
                    sourceAcl: 'source-sid',
                    targetAcl: 'target-sid'
                    }
                }
                }
            },
            metadata: {
                size: 1024,
                mtime: new Date(),
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                mode: 644,
                uid: 1000,
                gid: 1000,
                sid: 'test-sid',
                inode: 123456
            },
            serialize: jest.fn(),
            });

            const mockSourceStats = {
            atime: new Date('2023-01-01T00:00:00Z'),
            birthtime: new Date('2023-01-01T00:00:00Z'),
            mtime: new Date('2023-01-01T00:00:00Z'),
            isDirectory: jest.fn().mockReturnValue(false),
            uid: 1000,
            gid: 1000,
            };
            const mockTargetStats = {
            atime: new Date('2023-01-01T00:00:00Z'),
            birthtime: new Date('2023-01-01T00:00:00Z'),
            mtime: new Date('2023-01-01T00:00:00Z'),
            isDirectory: jest.fn().mockReturnValue(false),
            isSymbolicLink: jest.fn().mockReturnValue(false),
            uid: 1000,
            gid: 1000,
            size: 1024,
            };

            beforeEach(() => {
            (fs.promises.lstat as jest.Mock)
                .mockResolvedValueOnce(mockSourceStats)
                .mockResolvedValueOnce(mockTargetStats);
            (getFilePermissions as jest.Mock).mockReturnValue('755');
            (getFileType as jest.Mock).mockReturnValue('file');
            (path.extname as jest.Mock).mockReturnValue('.txt');
            });

            it('should build file info and validate command', async () => {
            const command = createMockCommand();
            const input = {
                command,
                jobContext: mockJobContext,
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            jest.spyOn(service, 'validateCommand').mockResolvedValue();

            const result = await service.buildFileInfo(input as any);

            expect(result).toBeDefined();
            expect(fs.promises.lstat).toHaveBeenCalledWith('/source/test.txt');
            expect(fs.promises.lstat).toHaveBeenCalledWith('/target/test.txt');
            expect(getFilePermissions).toHaveBeenCalledTimes(2);
            expect(getFileType).toHaveBeenCalledWith(mockTargetStats, false);
            expect(path.extname).toHaveBeenCalledWith('/target/test.txt');
            expect(service.validateCommand).toHaveBeenCalled();
            });

            it('should include checksumTime in built ItemInfo when present in command params', async () => {
            const checksumTimestamp = new Date('2026-02-04T10:30:00.000Z');
            const command = {
                ...createMockCommand(),
                ops: {
                    [OPS_CMD.COPY_FILE]: {
                        status: OPS_STATUS.COMPLETED,
                        params: {
                            checksums: {
                                sourceChecksum: 'src-checksum',
                                targetChecksum: 'tgt-checksum'
                            },
                            checksumTime: checksumTimestamp.toISOString()
                        }
                    },
                    [OPS_CMD.STAMP_META]: {
                        params: {
                            sidMap: {
                                sourceAcl: 'source-sid',
                                targetAcl: 'target-sid'
                            }
                        }
                    }
                }
            };
            const input = {
                command,
                jobContext: mockJobContext,
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            jest.spyOn(service, 'validateCommand').mockResolvedValue();

            const result = await service.buildFileInfo(input as any);

            expect(result.checksumTime).toEqual(checksumTimestamp);
            });

            it('should set checksumTime to null when not present in command params', async () => {
            const command = {
                ...createMockCommand(),
                ops: {
                    [OPS_CMD.COPY_FILE]: {
                        status: OPS_STATUS.COMPLETED,
                        params: {
                            checksums: {
                                sourceChecksum: 'src-checksum',
                                targetChecksum: 'tgt-checksum'
                            }
                            // No checksumTime
                        }
                    },
                    [OPS_CMD.STAMP_META]: {
                        params: {
                            sidMap: {
                                sourceAcl: 'source-sid',
                                targetAcl: 'target-sid'
                            }
                        }
                    }
                }
            };
            const input = {
                command,
                jobContext: mockJobContext,
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            jest.spyOn(service, 'validateCommand').mockResolvedValue();

            const result = await service.buildFileInfo(input as any);

            expect(result.checksumTime).toBeNull();
            });

            it('should set updateType to content_updated when file copy ran (checksums) and targetExisted', async () => {
            const command = {
                ...createMockCommand(),
                ops: {
                    [OPS_CMD.COPY_FILE]: {
                        status: OPS_STATUS.COMPLETED,
                        params: {
                            targetExisted: true,
                            checksums: {
                                sourceChecksum: 'src-checksum',
                                targetChecksum: 'tgt-checksum',
                            },
                        },
                    },
                    [OPS_CMD.STAMP_META]: createMockCommand().ops[OPS_CMD.STAMP_META],
                },
            };
            const input = {
                command,
                jobContext: mockJobContext,
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            jest.spyOn(service, 'validateCommand').mockResolvedValue();
            const result = await service.buildFileInfo(input as any);

            expect((result as any).updateType).toBe('content_updated');
            });

            it('should set updateType to metadata_updated when copy was skipped (no checksums) and targetExisted', async () => {
            const command = {
                ...createMockCommand(),
                ops: {
                    [OPS_CMD.COPY_FILE]: {
                        status: OPS_STATUS.COMPLETED,
                        params: { targetExisted: true },
                    },
                    [OPS_CMD.STAMP_META]: createMockCommand().ops[OPS_CMD.STAMP_META],
                },
            };
            const input = {
                command,
                jobContext: mockJobContext,
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            jest.spyOn(service, 'validateCommand').mockResolvedValue();
            const result = await service.buildFileInfo(input as any);

            expect((result as any).updateType).toBe('metadata_updated');
            });
        });

        describe('validateCommand', () => {
            const baseCmd = {
            id: 'cmd-1',
            fPath: '/test.txt',
            ops: {
                [OPS_CMD.STAMP_META]: {
                params: {
                    sidMap: {}
                }
                }
            }
            };
            const baseItem = {
            fileName: '/test.txt',
            sourceMeta: {
                checksum: 'abc',
                permission: '755',
                accessTime: new Date('2023-01-01T00:00:00Z')
            },
            targetMeta: {
                checksum: 'abc',
                permission: '755',
                accessTime: new Date('2023-01-01T00:00:00Z')
            }
            };
            const jobContext = {
            publishToErrorStream: jest.fn().mockResolvedValue(undefined),
            jobConfig: {
                options: {
                preserveAccessTime: false
                }
            }
            };

            beforeEach(() => {
            (dmError as jest.Mock).mockReturnValue({});
            });

            it('should not publish error if no mismatches', async () => {
            await service.validateCommand({
                cmd: baseCmd as any,
                item: baseItem as any,
                jobContext,
                errorType: ErrorType.RECOVERABLE_ERROR
            }as any);
            expect(jobContext.publishToErrorStream).not.toHaveBeenCalled();
            });

            it('should publish error if checksum mismatch', async () => {
            const item = {
                ...baseItem,
                sourceMeta: { ...baseItem.sourceMeta, checksum: 'abc' },
                targetMeta: { ...baseItem.targetMeta, checksum: 'def' }
            };
            await service.validateCommand({
                cmd: baseCmd as any,
                item: item as any,
                jobContext,
                errorType: ErrorType.RECOVERABLE_ERROR
            } as any);
            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
            });

            it('should publish error if permission mismatch', async () => {
            const item = {
                ...baseItem,
                sourceMeta: { ...baseItem.sourceMeta, permission: '755' },
                targetMeta: { ...baseItem.targetMeta, permission: '644' }
            };
            const ctx = {
                ...jobContext,
                jobConfig: {
                options: {
                    preservePermissions: true
                }
                }
            };
            await service.validateCommand({
                cmd: baseCmd as any,
                item: item as any,
                jobContext: ctx,
                errorType: ErrorType.RECOVERABLE_ERROR
            }as any);
            expect(ctx.publishToErrorStream).toHaveBeenCalled();
            });

            it('should publish error if accessTime mismatch and preserveAccessTime is true', async () => {
            const item = {
                ...baseItem,
                sourceMeta: { ...baseItem.sourceMeta, accessTime: new Date('2023-01-01T00:00:00Z') },
                targetMeta: { ...baseItem.targetMeta, accessTime: new Date('2023-01-02T00:00:00Z') }
            };
            const ctx = {
                ...jobContext,
                jobConfig: {
                options: {
                    preserveAccessTime: true
                }
                }
            };
            await service.validateCommand({
                cmd: baseCmd as any,
                item: item as any,
                jobContext: ctx,
                errorType: ErrorType.RECOVERABLE_ERROR
            }as any);
            expect(ctx.publishToErrorStream).toHaveBeenCalled();
            });

         

            it('should publish error if multiple mismatches occur', async () => {
                const cmd = {
                    id: 'cmd-1',
                    fPath: '/test.txt',
                    ops: {
                        [OPS_CMD.STAMP_META]: {
                            params: {
                                sidMap: {
                                    failedSid: ['sid1']
                                }
                            }
                        }
                    }
                };
                const item = {
                    fileName: '/test.txt',
                    sourceMeta: {
                        checksum: 'abc',
                        permission: '755',
                        accessTime: new Date('2023-01-01T00:00:00Z')
                    },
                    targetMeta: {
                        checksum: 'def',
                        permission: '644',
                        accessTime: new Date('2023-01-02T00:00:00Z')
                    }
                };
                const jobContext = {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                    jobConfig: {
                        options: {
                            preserveAccessTime: true
                        }
                    }
                };
                await service.validateCommand({
                    cmd: cmd as any,
                    item: item as any,
                    jobContext,
                    errorType: ErrorType.RECOVERABLE_ERROR
                } as any);
                expect(jobContext.publishToErrorStream).toHaveBeenCalled();
            });
        });


    });
    describe('copyFile', () => {
        const createMockCommand = (status = OPS_STATUS.READY) => ({
            id: 'cmd-1',
            fPath: '/test.txt',
            status: CommandStatus.READY,
            isDir: false,
            ops: {
                [OPS_CMD.COPY_FILE]: { 
                    status,
                    params: {}
                },
            },
            metadata: { 
                size: 1024,
                mtime: new Date(),
                atime: new Date(),
                ctime: new Date(),
                birthtime: new Date(),
                mode: 644,
                uid: 1000,
                gid: 1000,
                sid: 'test-sid',
                inode: 123456
            },
            serialize: jest.fn(),
        });

        const coreUtils = require('src/activities/core/utils/utils');

        beforeEach(() => {
            // Reset all mocks before each test
            coreUtils.isPathExists.mockReset();
            coreUtils.isNotWritable.mockReset();
            stampMetaService.resetFileAttributes.mockReset();
            workerThreadService.migrateWorkerThread.mockReset();
        });

        it('should skip if already completed', async () => {
            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                    jobConfig: {
                        options: {
                            preserveAccessTime: true
                        }
                    }
                },
                command: createMockCommand(OPS_STATUS.COMPLETED),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            const result = await service.copyFile(input as any);

            expect(result.shouldStampMeta).toBe(true);
            expect(result.shouldUpdateItemInfo).toBe(false);
            expect(workerThreadService.migrateWorkerThread).not.toHaveBeenCalled();
        });

        it('should return error when source path does not exist (line 83)', async () => {
            // Test for line 83: isNotWritable(targetPath) call and source path validation
            coreUtils.isPathExists.mockResolvedValue(false);  // Source path doesn't exist
            coreUtils.isNotWritable.mockResolvedValue(false); // Target path is writable

            const input = {
                sourcePath: '/source/nonexistent.txt',
                targetPath: '/target/test.txt',
                jobContext: {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                },
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            const result = await service.copyFile(input as any);

            expect(coreUtils.isPathExists).toHaveBeenCalledWith('/source/nonexistent.txt');
            expect(coreUtils.isNotWritable).toHaveBeenCalledWith('/target/test.txt');
            expect(result.sourceErrors).toEqual(['ENOENT']);
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
            expect(workerThreadService.migrateWorkerThread).not.toHaveBeenCalled();
        });

        it('should reset file attributes when target path exists (lines 92-93)', async () => {
            // Test for lines 92-93: resetFileAttributes call when targetPathExists is true
            coreUtils.isPathExists.mockResolvedValue(true);   // Source path exists
            coreUtils.isNotWritable.mockResolvedValue(true);  // Target path exists (not writable)
            workerThreadService.migrateWorkerThread.mockResolvedValue({
                sourceChecksum: 'abc123',
                targetChecksum: 'abc123'
            });

            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                },
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            const result = await service.copyFile(input as any);

            expect(stampMetaService.resetFileAttributes).toHaveBeenCalledWith('/target/test.txt');
            expect(workerThreadService.migrateWorkerThread).toHaveBeenCalledWith({
                sourcePath: '/source/test.txt',
                destinationPath: '/target/test.txt',
                operationId: 'cmd-1',
                size: 1024
            });
            expect(result.shouldStampMeta).toBe(true);
            expect(result.shouldUpdateItemInfo).toBe(true);
        });

        it('should store checksumTime in command params after successful copy', async () => {
            // Test that checksumTime is captured when checksum is generated
            coreUtils.isPathExists.mockResolvedValue(true);
            coreUtils.isNotWritable.mockResolvedValue(true);
            workerThreadService.migrateWorkerThread.mockResolvedValue({
                sourceChecksum: 'abc123',
                targetChecksum: 'abc123'
            });

            const command = createMockCommand();
            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                },
                command,
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            await service.copyFile(input as any);

            // Verify checksumTime is stored in the command params
            expect((command.ops[OPS_CMD.COPY_FILE].params as any).checksumTime).toBeInstanceOf(Date);
            expect(command.ops[OPS_CMD.COPY_FILE].status).toBe(OPS_STATUS.COMPLETED);
        });

        it('should store checksumTime in command params even when checksum mismatch occurs', async () => {
            // Test that checksumTime is captured even on checksum mismatch error
            coreUtils.isPathExists.mockResolvedValue(true);
            coreUtils.isNotWritable.mockResolvedValue(false);
            workerThreadService.migrateWorkerThread.mockResolvedValue({
                sourceChecksum: 'abc123',
                targetChecksum: 'def456' // Mismatch
            });

            const command = createMockCommand();
            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                },
                command,
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            await service.copyFile(input as any);

            // Verify checksumTime is stored even on error
            expect((command.ops[OPS_CMD.COPY_FILE].params as any).checksumTime).toBeInstanceOf(Date);
            expect(command.ops[OPS_CMD.COPY_FILE].status).toBe(OPS_STATUS.ERROR);
        });

        it('should handle checksum mismatch error (lines 95-96)', async () => {
            // Test for lines 95-96: checksum mismatch detection and error handling
            coreUtils.isPathExists.mockResolvedValue(true);
            coreUtils.isNotWritable.mockResolvedValue(false);
            workerThreadService.migrateWorkerThread.mockResolvedValue({
                sourceChecksum: 'abc123',
                targetChecksum: 'def456'  // Different checksum to trigger mismatch
            });

            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                },
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            const result = await service.copyFile(input as any);

            expect(input.command.ops[OPS_CMD.COPY_FILE].status).toBe(OPS_STATUS.ERROR);
            expect((input.command.ops[OPS_CMD.COPY_FILE].params as any).checksums).toEqual({
                sourceChecksum: 'abc123',
                targetChecksum: 'def456'
            });
            expect(result.targetErrors).toContain(undefined); // error.code will be undefined in this test
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should handle general copy errors (lines 111-114)', async () => {
            // Test for lines 111-114: catch block error handling
            coreUtils.isPathExists.mockResolvedValue(true);
            coreUtils.isNotWritable.mockResolvedValue(false);
            
            const copyError = new Error('Disk full') as any;
            copyError.code = 'ENOSPC';
            workerThreadService.migrateWorkerThread.mockRejectedValue(copyError);

            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                },
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            const result = await service.copyFile(input as any);

            expect(input.command.ops[OPS_CMD.COPY_FILE].status).toBe(OPS_STATUS.ERROR);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Copying FILE from /source/test.txt to /target/test.txt, Error: Disk full',
                copyError.stack
            );
            expect(result.targetErrors).toEqual(['ENOSPC']);
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should successfully copy file when all conditions are met', async () => {
            // Test successful copy flow
            coreUtils.isPathExists.mockResolvedValue(true);
            coreUtils.isNotWritable.mockResolvedValue(false); // Target path is writable
            workerThreadService.migrateWorkerThread.mockResolvedValue({
                sourceChecksum: 'abc123',
                targetChecksum: 'abc123'
            });

            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                },
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            const result = await service.copyFile(input as any);

            expect(result.shouldStampMeta).toBe(true);
            expect(result.shouldUpdateItemInfo).toBe(true);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(input.command.ops[OPS_CMD.COPY_FILE].status).toBe(OPS_STATUS.COMPLETED);
            expect(stampMetaService.resetFileAttributes).not.toHaveBeenCalled(); // Target not writable
        });

        describe('8.3 Collision Detection in copyFile', () => {
            it('should skip metadata stamping when E8DOT3_COLLISION occurs', async () => {
                coreUtils.isPathExists.mockResolvedValue(true);
                coreUtils.isNotWritable.mockResolvedValue(false);
                
                const collisionError: any = new Error('8.3 short filename collision detected');
                collisionError.code = 'E8DOT3_COLLISION';
                workerThreadService.migrateWorkerThread.mockRejectedValue(collisionError);

                const input = {
                    sourcePath: '/source/LONGLO~1/test.txt',
                    targetPath: '/target/LONGLO~1/test.txt',
                    jobContext: {
                        publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                    },
                    command: createMockCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                };

                const result = await service.copyFile(input as any);

                expect(result.shouldStampMeta).toBe(false);
                expect(result.shouldUpdateItemInfo).toBe(false);
                expect(result.targetErrors).toEqual(['E8DOT3_COLLISION']);
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'Skipping metadata stamping for /target/LONGLO~1/test.txt due to 8.3 collision'
                );
            });

            it('should handle non-collision errors normally', async () => {
                coreUtils.isPathExists.mockResolvedValue(true);
                coreUtils.isNotWritable.mockResolvedValue(false);
                
                const normalError: any = new Error('Permission denied');
                normalError.code = 'EACCES';
                workerThreadService.migrateWorkerThread.mockRejectedValue(normalError);

                const input = {
                    sourcePath: '/source/test.txt',
                    targetPath: '/target/test.txt',
                    jobContext: {
                        publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                    },
                    command: createMockCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                };

                const result = await service.copyFile(input as any);

                // Should not set shouldStampMeta to false explicitly (default behavior)
                expect(result.targetErrors).toEqual(['EACCES']);
                expect(mockLogger.debug).not.toHaveBeenCalledWith(
                    expect.stringContaining('Skipping metadata stamping')
                );
            });
        });

        describe('8.3 Collision Detection in copyDirectory', () => {
            const createDirMockCommand = (status = OPS_STATUS.READY) => ({
                id: 'cmd-1',
                fPath: '/LONGLO~1',
                status: CommandStatus.READY,
                isDir: true,
                ops: {
                    [OPS_CMD.COPY_DIR]: { 
                        status,
                        params: {}
                    },
                },
                metadata: { 
                    size: 0,
                    mtime: new Date(),
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                    mode: 755,
                    uid: 1000,
                    gid: 1000,
                    sid: 'test-sid',
                    inode: 123456
                },
                serialize: jest.fn(),
            });

            it('should skip metadata stamping when directory collision occurs', async () => {
                const collisionError: any = new Error('8.3 short filename collision detected');
                collisionError.code = 'E8DOT3_COLLISION';
                
                // Mock createDirectory to throw collision error
                mockCreateDirectory.mockRejectedValue(collisionError);

                const input = {
                    sourcePath: '/source/LONGLO~1',
                    targetPath: '/target/LONGLO~1',
                    jobContext: {
                        publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                    },
                    command: createDirMockCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                };

                const result = await service.copyDirectory(input as any);

                expect(result.shouldStampMeta).toBe(false);
                expect(result.shouldUpdateItemInfo).toBe(false);
                expect(result.targetErrors).toEqual(['E8DOT3_COLLISION']);
                expect(mockLogger.debug).toHaveBeenCalledWith(
                    'Skipping metadata stamping for /target/LONGLO~1 due to 8.3 collision'
                );
            });

            it('should handle successful directory creation with tilde check', async () => {
                const originalPlatform = process.platform;
                Object.defineProperty(process, 'platform', { value: 'win32' });

                mockCreateDirectory.mockResolvedValue(undefined);

                const input = {
                    sourcePath: '/source/LONGLO~1',
                    targetPath: '/target/LONGLO~1',
                    jobContext: {
                        publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                    },
                    command: createDirMockCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                };

                const result = await service.copyDirectory(input as any);

                expect(result.shouldStampMeta).toBe(true);
                expect(result.shouldUpdateItemInfo).toBe(true);
                expect(result.targetErrors).toEqual([]);
                expect(input.command.ops[OPS_CMD.COPY_DIR].status).toBe(OPS_STATUS.COMPLETED);

                // Restore platform
                Object.defineProperty(process, 'platform', { value: originalPlatform });
            });

            it('should use regular mkdir for non-Windows platforms', async () => {
                const originalPlatform = process.platform;
                Object.defineProperty(process, 'platform', { value: 'linux' });

                mockCreateDirectory.mockResolvedValue(undefined);

                const input = {
                    sourcePath: '/source/LONGLO~1',
                    targetPath: '/target/LONGLO~1',
                    jobContext: {
                        publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                    },
                    command: createDirMockCommand(),
                    errorType: ErrorType.RECOVERABLE_ERROR,
                };

                const result = await service.copyDirectory(input as any);

                // createDirectory is always called, but internally it will use regular mkdir for non-Windows
                expect(mockCreateDirectory).toHaveBeenCalledWith('/target/LONGLO~1');
                expect(result.shouldStampMeta).toBe(true);

                // Restore platform
                Object.defineProperty(process, 'platform', { value: originalPlatform });
            });
        });
    });

    describe('Stamp Meta Service Integration', () => {
        it('should not call stamp meta service when collision occurs', async () => {
            const createMockCommand = () => ({
                id: 'cmd-1',
                fPath: '/LONGLO~1/test.txt',
                status: CommandStatus.READY,
                isDir: false,
                ops: {
                    [OPS_CMD.COPY_FILE]: { 
                        status: OPS_STATUS.READY,
                        params: {}
                    },
                },
                metadata: { 
                    size: 1024,
                    mtime: new Date(),
                    atime: new Date(),
                    ctime: new Date(),
                    birthtime: new Date(),
                    mode: 644,
                    uid: 1000,
                    gid: 1000,
                    sid: 'test-sid',
                    inode: 123456
                },
                serialize: jest.fn(),
            });

            const coreUtils = require('src/activities/core/utils/utils');
            coreUtils.isPathExists.mockResolvedValue(true);
            coreUtils.isNotWritable.mockResolvedValue(false);
            
            const collisionError: any = new Error('8.3 collision');
            collisionError.code = 'E8DOT3_COLLISION';
            workerThreadService.migrateWorkerThread.mockRejectedValue(collisionError);

            const input = {
                sourcePath: '/source/LONGLO~1/test.txt',
                targetPath: '/target/LONGLO~1/test.txt',
                jobContext: {
                    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
                },
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            const result = await service.executeCommand(input as any);

            // Verify stamp meta service is not called due to shouldStampMeta being false
            expect(stampMetaService.stampMetaData).not.toHaveBeenCalled();
            expect(result.cmd.status).toBe(CommandStatus.ERROR);
        });
    });
});
