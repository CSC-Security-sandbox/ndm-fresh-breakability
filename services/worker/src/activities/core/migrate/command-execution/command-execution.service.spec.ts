import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CommandStatus, OPS_CMD, OPS_STATUS, ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as path from 'path';
import { CommandExecService } from './command-execution.service';
import { WorkerThreadService } from 'src/thread/worker.thread.service';
import { StampMetaService } from './stamp-meta.service';
import { mockLogger } from 'src/auth/auth.service.spec';
import { dmError, getFilePermissions, getFileType,  } from 'src/activities/utils/utils';

// Mock fs module
jest.mock('fs', () => ({
    mkdirSync: jest.fn(),
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
jest.mock('src/activities/utils/utils', () => ({
    dmError: jest.fn(),
    getFilePermissions: jest.fn(),
    getFileType: jest.fn(),
    isPathExists: jest.fn(),
}));

describe('CommandExecService', () => {
    let service: CommandExecService;
    let configService: jest.Mocked<ConfigService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;
    let workerThreadService: jest.Mocked<WorkerThreadService>;
    let stampMetaService: jest.Mocked<StampMetaService>;
    let mockJobContext: any;

    const mockFs = fs as jest.Mocked<typeof fs>;

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
            restoreFileAttribute: jest.fn()
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
            expect(mockFs.promises.mkdir).not.toHaveBeenCalled();
        });

        it('should successfully create directory', async () => {
            const result = await service.copyDirectory(baseInput);

            expect(result.shouldStampMeta).toBe(true);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.mkdir).toHaveBeenCalledWith('/target/testdir', { recursive: true });
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
            (mockFs.promises.mkdir as jest.Mock).mockRejectedValue(error);


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

            (mockFs.promises.mkdir as jest.Mock).mockResolvedValue('/target/testdir');
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

        describe('publishFileInfo', () => {
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
                sid: 'test-sid'
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

            it('should publish file info and validate command', async () => {
            const command = createMockCommand();
            const input = {
                command,
                jobContext: mockJobContext,
                sourcePath: '/source/test.txt',
                targetPath: '/target/test.txt',
                errorType: ErrorType.RECOVERABLE_ERROR,
            };
            jest.spyOn(service, 'validateCommand').mockResolvedValue();

            await service.publishFileInfo(input as any);

            expect(fs.promises.lstat).toHaveBeenCalledWith('/source/test.txt');
            expect(fs.promises.lstat).toHaveBeenCalledWith('/target/test.txt');
            expect(getFilePermissions).toHaveBeenCalledTimes(2);
            expect(getFileType).toHaveBeenCalledWith(mockTargetStats, false);
            expect(path.extname).toHaveBeenCalledWith('/target/test.txt');
            expect(service.validateCommand).toHaveBeenCalled();
            expect(mockJobContext.publishToFileStream).toHaveBeenCalledWith(expect.any(Object));
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
            await service.validateCommand({
                cmd: baseCmd as any,
                item: item as any,
                jobContext,
                errorType: ErrorType.RECOVERABLE_ERROR
            }as any);
            expect(jobContext.publishToErrorStream).toHaveBeenCalled();
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
});
