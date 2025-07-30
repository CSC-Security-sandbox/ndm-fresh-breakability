import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CommandStatus, OPS_CMD, OPS_STATUS, ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as path from 'path';
import { CommandExecService } from './command-execution.service';
import { WorkerThreadService } from 'src/thread/worker.thread.service';
import { StampMetaService } from './stamp-meta.service';
import { mockLogger } from 'src/auth/auth.service.spec';

// Mock fs module
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    promises: {
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
jest.mock('src/activities/utils/utils', () => ({
    dmError: jest.fn(),
    getFilePermissions: jest.fn(),
    getFileType: jest.fn(),
}));

describe('CommandExecService', () => {
    let service: CommandExecService;
    let configService: jest.Mocked<ConfigService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;
    let workerThreadService: jest.Mocked<WorkerThreadService>;
    let stampMetaService: jest.Mocked<StampMetaService>;
    let mockJobContext: any;

    const mockFs = fs as jest.Mocked<typeof fs>;
    const mockPath = path as jest.Mocked<typeof path>;
    const { dmError, getFilePermissions, getFileType } = require('src/activities/utils/utils');

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
        } as any;

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
            const module = await Test.createTestingModule({
                providers: [
                    CommandExecService,
                    { provide: ConfigService, useValue: configService },
                    { provide: LoggerFactory, useValue: loggerFactory },
                    { provide: WorkerThreadService, useValue: workerThreadService },
                    { provide: StampMetaService, useValue: stampMetaService },
                ],
            }).compile();

            const serviceWithUndefinedId = module.get<CommandExecService>(CommandExecService);
            expect(serviceWithUndefinedId.workerId).toBe('');
        });
    });

    describe('copyFile', () => {
        const createMockCommand = (status = OPS_STATUS.READY, isDir = false) => ({
            id: 'cmd-1',
            fPath: '/test.txt',
            status: CommandStatus.READY,
            isDir,
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
                sid: 'test-sid'
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

        it('should skip if already completed', async () => {
            const input = {
                ...baseInput,
                command: createMockCommand(OPS_STATUS.COMPLETED),
            };

            const result = await service.copyFile(input);

            expect(result.shouldStampMeta).toBe(true);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(workerThreadService.migrateWorkerThread).not.toHaveBeenCalled();
        });

        it('should handle source file not exists', async () => {
            // Create fresh input to ensure we get the updated mockJobContext
            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            
            mockFs.existsSync.mockReturnValue(false);
            // When source doesn't exist, migrateWorkerThread should also fail
            const error = new Error('Source file not found') as any;
            error.code = 'ENOENT';
            workerThreadService.migrateWorkerThread.mockRejectedValue(error);
            dmError.mockReturnValue({});

            const result = await service.copyFile(input);

            expect(result.shouldStampMeta).toBe(false);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual(['ENOENT']);
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalledTimes(2); // Once for source not exists, once for migration error
            expect(dmError).toHaveBeenCalledWith(
                "OPERATION",
                "Source",
                "Copy Content",
                ErrorType.RECOVERABLE_ERROR,
                'cmd-1',
                expect.any(Error),
                { name: '/test.txt', path: '/source/test.txt' }
            );
        });

        it('should successfully copy file', async () => {
            mockFs.existsSync.mockReturnValue(true);
            workerThreadService.migrateWorkerThread.mockResolvedValue({
                sourceChecksum: 'src-checksum',
                targetChecksum: 'tgt-checksum',
            });

            const result = await service.copyFile(baseInput);

            expect(result.shouldStampMeta).toBe(true);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(workerThreadService.migrateWorkerThread).toHaveBeenCalledWith({
                sourcePath: '/source/test.txt',
                destinationPath: '/target/test.txt',
                operationId: 'cmd-1',
                size: 1024,
            });
            expect(baseInput.command.ops[OPS_CMD.COPY_FILE].status).toBe(OPS_STATUS.COMPLETED);
        });

        it('should handle copy file error', async () => {
            // Create fresh input with new command to avoid state pollution
            const input = {
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                jobContext: mockJobContext,
                command: createMockCommand(),
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            
            mockFs.existsSync.mockReturnValue(true);
            
            const error = new Error('Copy failed') as any;
            error.code = 'EACCES';
            workerThreadService.migrateWorkerThread.mockRejectedValue(error);
            dmError.mockReturnValue({});

            const result = await service.copyFile(input);

            expect(result.shouldStampMeta).toBe(false);
            expect(result.targetErrors).toEqual(['EACCES']);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Copying FILE from /source/test.txt to /target/test.txt, Error: Copy failed',
                error.stack
            );
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(input.command.ops[OPS_CMD.COPY_FILE].status).toBe(OPS_STATUS.ERROR);
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
                sid: 'test-sid'
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

        it('should skip if already completed', async () => {
            const input = {
                ...baseInput,
                command: createMockCommand(OPS_STATUS.COMPLETED),
            };

            const result = await service.copyDirectory(input);

            expect(result.shouldStampMeta).toBe(true);
            expect(mockFs.mkdirSync).not.toHaveBeenCalled();
        });

        it('should successfully create directory', async () => {
            const result = await service.copyDirectory(baseInput);

            expect(result.shouldStampMeta).toBe(true);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.mkdirSync).toHaveBeenCalledWith('/target/testdir', { recursive: true });
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
            mockFs.mkdirSync.mockImplementation(() => {
                throw error;
            });
            dmError.mockReturnValue({});

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
                sid: 'test-sid'
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
            dmError.mockReturnValue({});

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
                sid: 'test-sid'
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
            dmError.mockReturnValue({});

            const result = await service.deleteDirectory(input);

            expect(result.sourceErrors).toEqual(['EACCES']);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Deleting DIR from  /target/testdir, Error: Permission denied',
                error.stack
            );
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
            expect(input.command.ops[OPS_CMD.REMOVE_DIR].status).toBe(OPS_STATUS.ERROR);
        });
    });

    describe('executeCommand', () => {
        it('should execute copy file operation with stamping', async () => {
            const createMockCommand = () => ({
                id: 'cmd-1',
                fPath: '/test.txt',
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
                    sid: 'test-sid'
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

            mockFs.existsSync.mockReturnValue(true);
            workerThreadService.migrateWorkerThread.mockResolvedValue({
                sourceChecksum: 'src-checksum',
                targetChecksum: 'tgt-checksum',
            });
            stampMetaService.stampMetaData.mockResolvedValue({
                shouldStampMeta: false,
                sourceErrors: [],
                targetErrors: [],
            });

            jest.spyOn(service, 'publishFileInfo').mockResolvedValue();

            const result = await service.executeCommand(input);

            expect(result.cmd.status).toBe(CommandStatus.COMPLETED);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(workerThreadService.migrateWorkerThread).toHaveBeenCalled();
            expect(stampMetaService.stampMetaData).toHaveBeenCalled();
            expect(service.publishFileInfo).toHaveBeenCalled();
        });

        it('should set command status to ERROR when there are errors', async () => {
            const createMockCommand = () => ({
                id: 'cmd-1',
                fPath: '/test.txt',
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
                    sid: 'test-sid'
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

            // Mock file copy to fail
            mockFs.existsSync.mockReturnValue(true);
            const error = new Error('Copy failed') as any;
            error.code = 'EACCES';
            workerThreadService.migrateWorkerThread.mockRejectedValue(error);
            dmError.mockReturnValue({});

            // Ensure stampMetaService returns proper structure
            stampMetaService.stampMetaData.mockResolvedValue({
                shouldStampMeta: false,
                sourceErrors: [],
                targetErrors: [],
            });

            const result = await service.executeCommand(input);

            expect(result.cmd.status).toBe(CommandStatus.ERROR);
            expect(result.targetErrors).toEqual(['EACCES']);
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
        });

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
                    sid: 'test-sid'
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

            mockFs.mkdirSync.mockReturnValue('/target/testdir');
            stampMetaService.stampMetaData.mockResolvedValue({
                shouldStampMeta: false,
                sourceErrors: [],
                targetErrors: [],
            });
            jest.spyOn(service, 'publishFileInfo').mockResolvedValue();

            const result = await service.executeCommand(input);

            expect(result.cmd.status).toBe(CommandStatus.COMPLETED);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
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
                    sid: 'test-sid'
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
                    sid: 'test-sid'
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
    });

    describe('validateCommand', () => {
        const mockItemInfo = {
            fileName: '/test.txt',
            sourceMeta: {
                checksum: 'checksum-1',
                permission: '644',
                birthTime: new Date('2023-01-01'),
                accessTime: new Date('2023-01-01'),
            },
            targetMeta: {
                checksum: 'checksum-1',
                permission: '644',
                birthTime: new Date('2023-01-01'),
                accessTime: new Date('2023-01-01'),
            },
        };

        const baseValidateInput = {
            cmd: {
                id: 'cmd-1',
                fPath: '/test.txt',
            } as any,
            item: mockItemInfo as any,
            jobContext: mockJobContext,
            errorType: ErrorType.RECOVERABLE_ERROR,
        };

        it('should not report errors when metadata matches', async () => {
            await service.validateCommand(baseValidateInput);

            expect(mockJobContext.publishToErrorStream).not.toHaveBeenCalled();
        });

        it('should report checksum mismatch', async () => {
            const input = {
                cmd: {
                    id: 'cmd-1',
                    fPath: '/test.txt',
                } as any,
                item: {
                    fileName: '/test.txt',
                    sourceMeta: {
                        checksum: 'checksum-1',
                        permission: '644',
                        birthTime: new Date('2023-01-01'),
                        accessTime: new Date('2023-01-01'),
                    },
                    targetMeta: {
                        checksum: 'different-checksum',
                        permission: '644',
                        birthTime: new Date('2023-01-01'),
                        accessTime: new Date('2023-01-01'),
                    },
                } as any,
                jobContext: mockJobContext,
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            dmError.mockReturnValue({});

            await service.validateCommand(input);

            expect(dmError).toHaveBeenCalledWith(
                "OPERATION",
                "Destination",
                "Update Metadata",
                ErrorType.RECOVERABLE_ERROR,
                'cmd-1',
                expect.any(Error),
                { name: '/test.txt', path: '/test.txt' }
            );
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should report multiple mismatches', async () => {
            const input = {
                cmd: {
                    id: 'cmd-1',
                    fPath: '/test.txt',
                } as any,
                item: {
                    fileName: '/test.txt',
                    sourceMeta: {
                        checksum: 'checksum-1',
                        permission: '644',
                        birthTime: new Date('2023-01-01'),
                        accessTime: new Date('2023-01-01'),
                    },
                    targetMeta: {
                        checksum: 'different-checksum',
                        permission: '755',
                        birthTime: new Date('2023-01-02'),
                        accessTime: new Date('2023-01-01'),
                    },
                } as any,
                jobContext: mockJobContext,
                errorType: ErrorType.RECOVERABLE_ERROR,
            };

            dmError.mockReturnValue({});

            await service.validateCommand(input);

            expect(dmError).toHaveBeenCalledWith(
                "OPERATION",
                "Destination", 
                "Update Metadata",
                ErrorType.RECOVERABLE_ERROR,
                'cmd-1',
                expect.objectContaining({
                    message: expect.stringContaining('checksum'),
                }),
                { name: '/test.txt', path: '/test.txt' }
            );
            expect(mockJobContext.publishToErrorStream).toHaveBeenCalled();
        });
    });
});
