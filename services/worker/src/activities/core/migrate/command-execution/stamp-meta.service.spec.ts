import { Test, TestingModule } from '@nestjs/testing';
import { StampMetaService } from './stamp-meta.service';
import { ShellService } from 'src/activities/common/shell.service';
import { RedisService } from 'src/redis/redis.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { OPS_CMD, OPS_STATUS, ErrorType } from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import { CommandExecInput } from './command-execution.type';

// Mock fs module
jest.mock('fs', () => ({
    promises: {
        chmod: jest.fn(),
        chown: jest.fn(),
        utimes: jest.fn(),
    },
}));

// Mock utils functions
jest.mock('src/activities/utils/utils', () => ({
    dmError: jest.fn(),
    formatDate: jest.fn(),
    getUserACLs: jest.fn(),
}));

// Mock command config
jest.mock('src/config/command.config', () => ({
    CommandConfig: {
        getSMBCommand: jest.fn(),
    },
    CommandPattern: {
        GET_SID_FOR_OBJECT: 'GET_SID_FOR_OBJECT',
        SET_SID_FOR_OBJECT: 'SET_SID_FOR_OBJECT',
        SET_SID_FOR_OBJECT_DIR: 'SET_SID_FOR_OBJECT_DIR',
    },
}));

const mockLogger: Partial<LoggerService> = {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

describe('StampMetaService', () => {
    let service: StampMetaService;
    let shellService: jest.Mocked<ShellService>;
    let redisService: jest.Mocked<RedisService>;
    let loggerFactory: jest.Mocked<LoggerFactory>;

    const mockFs = fs as jest.Mocked<typeof fs>;
    const { dmError, formatDate, getUserACLs } = require('src/activities/utils/utils');
    const { CommandConfig } = require('src/config/command.config');

    beforeEach(async () => {
        shellService = {
            runCommand: jest.fn(),
        } as any;

        redisService = {
            getOwnerIdentity: jest.fn(),
        } as any;

        loggerFactory = {
            create: jest.fn().mockReturnValue(mockLogger),
        } as any;

        // Setup fs.promises mocks
        (mockFs.promises.chmod as jest.Mock).mockResolvedValue(undefined);
        (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);
        (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StampMetaService,
                { provide: ShellService, useValue: shellService },
                { provide: RedisService, useValue: redisService },
                { provide: LoggerFactory, useValue: loggerFactory },
            ],
        }).compile();

        service = module.get<StampMetaService>(StampMetaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    const createMockInput = (metadata = {}, jobConfig = {}, isDir = false): CommandExecInput => ({
        command: {
            id: 'cmd-1',
            fPath: '/test-file.txt',
            isDir,
            ops: {
                [OPS_CMD.STAMP_META]: {
                    status: OPS_STATUS.READY,
                    params: {},
                },
            },
            metadata: {
                mode: 0o644,
                birthtime: new Date('2023-01-01T10:00:00Z'),
                gid: 1000,
                uid: 1001,
                sid: 'test-sid-123',
                mtime: new Date('2023-01-02T12:00:00Z'),
                atime: new Date('2023-01-02T14:00:00Z'),
                ...metadata,
            },
            serialize: jest.fn(),
        } as any,
        jobContext: {
            jobRunId: 'job-run-123',
            jobConfig: {
                options: {
                    isIdentityMappingAvailable: false,
                    preserveAccessTime: false,
                    ...jobConfig,
                },
            },
            publishToErrorStream: jest.fn().mockResolvedValue(undefined),
        } as any,
        sourcePath: '/source/test-file.txt',
        targetPath: '/target/test-file.txt',
        errorType: ErrorType.RECOVERABLE_ERROR,
    });

    describe('stampMetaData', () => {
        it('should successfully stamp all metadata when STAMP_META operation is ready', async () => {
            const input = createMockInput();
            
            // Mock successful operations
            (mockFs.promises.chmod as jest.Mock).mockResolvedValue(undefined);
            (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);
            (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);
            shellService.runCommand.mockResolvedValue('success');
            formatDate.mockReturnValue('202301011000.00');

            const result = await service.stampMetaData(input);

            expect(result.shouldStampMeta).toBe(false);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.COMPLETED);
        });

        it('should skip stamping when STAMP_META operation is already completed', async () => {
            const input = createMockInput();
            input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.COMPLETED;

            const result = await service.stampMetaData(input);

            expect(result.shouldStampMeta).toBe(false);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.chmod).not.toHaveBeenCalled();
        });

        it('should set status to ERROR when there are errors', async () => {
            const input = createMockInput();
            
            // Mock an error in permission stamping
            const error = new Error('Permission denied') as any;
            error.code = 'EACCES';
            (mockFs.promises.chmod as jest.Mock).mockRejectedValue(error);
            dmError.mockReturnValue({});

            const result = await service.stampMetaData(input);

            expect(result.targetErrors).toEqual(['EACCES']);
            expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.ERROR);
        });

        it('should skip stamping when STAMP_META operation is not present', async () => {
            const input = createMockInput();
            delete input.command.ops[OPS_CMD.STAMP_META];

            const result = await service.stampMetaData(input);

            expect(result.shouldStampMeta).toBe(false);
            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.chmod).not.toHaveBeenCalled();
        });
    });

    describe('stampPermission', () => {
        it('should successfully stamp permissions when metadata.mode is available', async () => {
            const input = createMockInput({ mode: 0o755 });
            (mockFs.promises.chmod as jest.Mock).mockResolvedValue(undefined);

            const result = await service.stampPermission(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.chmod).toHaveBeenCalledWith('/target/test-file.txt', 0o755);
        });

        it('should skip stamping when metadata.mode is not available', async () => {
            const input = createMockInput({ mode: undefined });

            const result = await service.stampPermission(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.chmod).not.toHaveBeenCalled();
        });

        it('should handle chmod errors gracefully', async () => {
            const input = createMockInput({ mode: 0o755 });
            const error = new Error('Permission denied') as any;
            error.code = 'EACCES';
            (mockFs.promises.chmod as jest.Mock).mockRejectedValue(error);
            dmError.mockReturnValue({});

            const result = await service.stampPermission(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual(['EACCES']);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Stamping Permission from /source/test-file.txt to /target/test-file.txt, Error: Permission denied',
                error.stack
            );
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        });
    });

    describe('stampBirthTime', () => {
        beforeEach(() => {
            // Reset platform mock
            Object.defineProperty(process, 'platform', {
                value: 'linux',
                writable: true,
            });
        });

        it('should successfully stamp birth time on Linux/Unix platforms', async () => {
            const input = createMockInput({ birthtime: new Date('2023-01-01T10:00:00Z') });
            shellService.runCommand.mockResolvedValue('success');
            formatDate.mockReturnValue('202301011000.00');

            const result = await service.stampBirthTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(formatDate).toHaveBeenCalledWith(new Date('2023-01-01T10:00:00Z'));
            expect(shellService.runCommand).toHaveBeenCalledWith('touch -t 202301011000.00 /target/test-file.txt');
        });


        it('should handle directory paths correctly', async () => {
            const input = createMockInput({ birthtime: new Date('2023-01-01T10:00:00Z') }, {}, true);
            shellService.runCommand.mockResolvedValue('success');
            formatDate.mockReturnValue('202301011000.00');

            const result = await service.stampBirthTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(shellService.runCommand).toHaveBeenCalledWith('touch -t 202301011000.00 /target/test-file.txt/');
        });

        it('should skip when birthtime is not available', async () => {
            const input = createMockInput({ birthtime: undefined });

            const result = await service.stampBirthTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(shellService.runCommand).not.toHaveBeenCalled();
        });

        it('should handle shell command errors gracefully', async () => {
            const input = createMockInput({ birthtime: new Date('2023-01-01T10:00:00Z') });
            const error = new Error('Command failed') as any;
            error.code = 'ENOENT';
            shellService.runCommand.mockRejectedValue(error);
            formatDate.mockReturnValue('202301011000.00');
            dmError.mockReturnValue({});

            const result = await service.stampBirthTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual(['ENOENT']);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Stamping BirthTime from /source/test-file.txt to /target/test-file.txt, Error: Command failed',
                error.stack
            );
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        });
    });

    describe('stampGIDandUID', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', {
                value: 'linux',
                writable: true,
            });
        });

        it('should successfully stamp GID and UID without identity mapping', async () => {
            const input = createMockInput({ gid: 1000, uid: 1001 });
            (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);

            const result = await service.stampGIDandUID(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.chown).toHaveBeenCalledWith('/target/test-file.txt', 1001, 1000);
        });

        it('should successfully stamp GID and UID with identity mapping', async () => {
            const input = createMockInput(
                { gid: 1000, uid: 1001 },
                { isIdentityMappingAvailable: true }
            );
            (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);
            redisService.getOwnerIdentity
                .mockResolvedValueOnce('2000') // mapped gid
                .mockResolvedValueOnce('2001'); // mapped uid

            const result = await service.stampGIDandUID(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(redisService.getOwnerIdentity).toHaveBeenCalledWith('job-run-123', '1000', 'GID');
            expect(redisService.getOwnerIdentity).toHaveBeenCalledWith('job-run-123', '1001', 'UID');
            expect(mockFs.promises.chown).toHaveBeenCalledWith('/target/test-file.txt', 2001, 2000);
        });

        it('should skip when on Windows platform', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const input = createMockInput({ gid: 1000, uid: 1001 });

            const result = await service.stampGIDandUID(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.chown).not.toHaveBeenCalled();
        });

        it('should skip when GID or UID is missing', async () => {
            const input = createMockInput({ gid: undefined, uid: 1001 });

            const result = await service.stampGIDandUID(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.chown).not.toHaveBeenCalled();
        });

        it('should skip when identity mapping returns null values', async () => {
            const input = createMockInput(
                { gid: 1000, uid: 1001 },
                { isIdentityMappingAvailable: true }
            );
            redisService.getOwnerIdentity
                .mockResolvedValueOnce(null) // mapped gid is null
                .mockResolvedValueOnce('2001'); // mapped uid

            const result = await service.stampGIDandUID(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.chown).not.toHaveBeenCalled();
        });

        it('should handle chown errors gracefully', async () => {
            const input = createMockInput({ gid: 1000, uid: 1001 });
            const error = new Error('Operation not permitted') as any;
            error.code = 'EPERM';
            (mockFs.promises.chown as jest.Mock).mockRejectedValue(error);
            dmError.mockReturnValue({});

            const result = await service.stampGIDandUID(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual(['EPERM']);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Stamping GID and UID from /source/test-file.txt to /target/test-file.txt, Error: Operation not permitted',
                error.stack
            );
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        });
    });

    describe('stampAccessAndModifiedTime', () => {
        it('should successfully stamp access and modified time', async () => {
            const input = createMockInput({
                mtime: new Date('2023-01-02T12:00:00Z'),
                atime: new Date('2023-01-02T14:00:00Z'),
            });
            (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

            const result = await service.stampAccessAndModifiedTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.utimes).toHaveBeenCalledWith(
                '/target/test-file.txt',
                new Date('2023-01-02T14:00:00Z'),
                new Date('2023-01-02T12:00:00Z')
            );
        });

        it('should skip when mtime or atime is missing', async () => {
            const input = createMockInput({ mtime: undefined, atime: new Date() });

            const result = await service.stampAccessAndModifiedTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.utimes).not.toHaveBeenCalled();
        });

        it('should handle utimes errors gracefully', async () => {
            const input = createMockInput({
                mtime: new Date('2023-01-02T12:00:00Z'),
                atime: new Date('2023-01-02T14:00:00Z'),
            });
            const error = new Error('File not found') as any;
            error.code = 'ENOENT';
            (mockFs.promises.utimes as jest.Mock).mockRejectedValue(error);
            dmError.mockReturnValue({});

            const result = await service.stampAccessAndModifiedTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual(['ENOENT']);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Stamping Access and Modified Time  to /target/test-file.txt, Error: File not found',
                error.stack
            );
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        });
    });

    describe('preserveAccessAndModifiedTime', () => {
        it('should successfully preserve access and modified time when enabled', async () => {
            const input = createMockInput(
                {
                    mtime: new Date('2023-01-02T12:00:00Z'),
                    atime: new Date('2023-01-02T14:00:00Z'),
                },
                { preserveAccessTime: true }
            );
            (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

            const result = await service.preserveAccessAndModifiedTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.utimes).toHaveBeenCalledWith(
                '/source/test-file.txt',
                new Date('2023-01-02T14:00:00Z'),
                new Date('2023-01-02T12:00:00Z')
            );
        });

        it('should skip when preserveAccessTime is disabled', async () => {
            const input = createMockInput(
                {
                    mtime: new Date('2023-01-02T12:00:00Z'),
                    atime: new Date('2023-01-02T14:00:00Z'),
                },
                { preserveAccessTime: false }
            );

            const result = await service.preserveAccessAndModifiedTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.utimes).not.toHaveBeenCalled();
        });

        it('should skip when mtime or atime is missing', async () => {
            const input = createMockInput(
                { mtime: undefined, atime: new Date() },
                { preserveAccessTime: true }
            );

            const result = await service.preserveAccessAndModifiedTime(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(mockFs.promises.utimes).not.toHaveBeenCalled();
        });

        it('should handle utimes errors gracefully', async () => {
            const input = createMockInput(
                {
                    mtime: new Date('2023-01-02T12:00:00Z'),
                    atime: new Date('2023-01-02T14:00:00Z'),
                },
                { preserveAccessTime: true }
            );
            const error = new Error('File not found') as any;
            error.code = 'ENOENT';
            (mockFs.promises.utimes as jest.Mock).mockRejectedValue(error);
            dmError.mockReturnValue({});

            const result = await service.preserveAccessAndModifiedTime(input);

            expect(result.sourceErrors).toEqual(['ENOENT']);
            expect(result.targetErrors).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Preserve Access and Modified Time  to /source/test-file.txt, Error: File not found',
                error.stack
            );
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        });
    });

    describe('getRawSID', () => {
        it('should successfully get raw SID', async () => {
            const filePath = '/test/file.txt';
            const expectedSID = 'S-1-5-21-123456789-987654321-111111111-1001';
            
            CommandConfig.getSMBCommand.mockReturnValue('getfacl ${PATH}');
            shellService.runCommand.mockResolvedValue(expectedSID);

            const result = await service.getRawSID(filePath);

            expect(result).toBe(expectedSID);
            expect(CommandConfig.getSMBCommand).toHaveBeenCalledWith(process.platform, 'GET_SID_FOR_OBJECT');
            expect(shellService.runCommand).toHaveBeenCalledWith('getfacl /test/file.txt');
        });
    });

    describe('stampSIDtoObject', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', {
                value: 'linux',
                writable: true,
            });
        });

        it('should skip SID stamping on non-Windows platforms', async () => {
            const input = createMockInput();

            const result = await service.stampSIDtoObject(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(shellService.runCommand).not.toHaveBeenCalled();
        });

        it('should successfully stamp SID on Windows platform', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const input = createMockInput();
            
            const rawSID = 'S-1-5-21-123456789-987654321-111111111-1001';
            const mockACLs = [
                { user: 'DOMAIN\\user1', permissions: 'F' },
                { user: 'DOMAIN\\user2', permissions: 'R' },
            ];

            CommandConfig.getSMBCommand
                .mockReturnValueOnce('getfacl ${PATH}') // for getRawSID
                .mockReturnValue('icacls ${PATH} /grant ${USER}:${ACL}'); // for setSID
            shellService.runCommand
                .mockResolvedValueOnce(rawSID) // getRawSID
                .mockResolvedValueOnce('success') // first setSID
                .mockResolvedValueOnce('success'); // second setSID
            getUserACLs.mockReturnValue(mockACLs);

            const result = await service.stampSIDtoObject(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(getUserACLs).toHaveBeenCalledWith(rawSID, '/source/test-file.txt');
            expect(shellService.runCommand).toHaveBeenCalledTimes(3); // getRawSID + 2 setSID calls
        });

        it('should handle identity mapping for SID stamping', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const input = createMockInput({}, { isIdentityMappingAvailable: true });
            
            const rawSID = 'S-1-5-21-123456789-987654321-111111111-1001';
            const mockACLs = [{ user: 'DOMAIN\\user1', permissions: 'F' }];

            CommandConfig.getSMBCommand
                .mockReturnValueOnce('getfacl ${PATH}')
                .mockReturnValue('icacls ${PATH} /grant ${USER}:${ACL}');
            shellService.runCommand
                .mockResolvedValueOnce(rawSID)
                .mockResolvedValueOnce('success');
            getUserACLs.mockReturnValue(mockACLs);
            redisService.getOwnerIdentity.mockResolvedValue('MAPPED\\user1');

            const result = await service.stampSIDtoObject(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(redisService.getOwnerIdentity).toHaveBeenCalledWith('job-run-123', 'DOMAIN\\user1', 'SID');
        });

        it('should handle directory vs file command patterns', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const input = createMockInput({}, {}, true); // isDir = true
            
            const rawSID = 'S-1-5-21-123456789-987654321-111111111-1001';
            const mockACLs = [{ user: 'DOMAIN\\user1', permissions: 'F' }];

            CommandConfig.getSMBCommand
                .mockReturnValueOnce('getfacl ${PATH}')
                .mockReturnValue('icacls ${PATH} /grant ${USER}:${ACL} /T');
            shellService.runCommand
                .mockResolvedValueOnce(rawSID)
                .mockResolvedValueOnce('success');
            getUserACLs.mockReturnValue(mockACLs);

            const result = await service.stampSIDtoObject(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(CommandConfig.getSMBCommand).toHaveBeenCalledWith(process.platform, 'SET_SID_FOR_OBJECT_DIR');
        });

        it('should handle getRawSID errors gracefully', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const input = createMockInput();
            
            const error = new Error('Access denied') as any;
            error.code = 'EACCES';
            CommandConfig.getSMBCommand.mockReturnValue('getfacl ${PATH}');
            shellService.runCommand.mockRejectedValue(error);
            dmError.mockReturnValue({});

            const result = await service.stampSIDtoObject(input);

            expect(result.sourceErrors).toEqual(['EACCES']);
            expect(result.targetErrors).toEqual([]);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Getting ACL for /source/test-file.txt, Error: Access denied',
                error.stack
            );
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should handle setSID errors gracefully', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const input = createMockInput();
            
            const rawSID = 'S-1-5-21-123456789-987654321-111111111-1001';
            const mockACLs = [{ user: 'DOMAIN\\user1', permissions: 'F' }];
            const error = new Error('Permission denied') as any;
            error.code = 'EPERM';

            CommandConfig.getSMBCommand
                .mockReturnValueOnce('getfacl ${PATH}')
                .mockReturnValue('icacls ${PATH} /grant ${USER}:${ACL}');
            shellService.runCommand
                .mockResolvedValueOnce(rawSID)
                .mockRejectedValueOnce(error);
            getUserACLs.mockReturnValue(mockACLs);
            dmError.mockReturnValue({});

            const result = await service.stampSIDtoObject(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual(['EPERM']);
            expect(mockLogger.error).toHaveBeenCalledWith('Error setting ownership: Permission denied');
            expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        });

        it('should skip users when identity mapping returns null', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const input = createMockInput({}, { isIdentityMappingAvailable: true });
            
            const rawSID = 'S-1-5-21-123456789-987654321-111111111-1001';
            const mockACLs = [
                { user: 'DOMAIN\\user1', permissions: 'F' },
                { user: 'DOMAIN\\user2', permissions: 'R' },
            ];

            CommandConfig.getSMBCommand
                .mockReturnValueOnce('getfacl ${PATH}')
                .mockReturnValue('icacls ${PATH} /grant ${USER}:${ACL}');
            shellService.runCommand
                .mockResolvedValueOnce(rawSID)
                .mockResolvedValueOnce('success');
            getUserACLs.mockReturnValue(mockACLs);
            redisService.getOwnerIdentity
                .mockResolvedValueOnce('MAPPED\\user1') // user1 mapped
                .mockResolvedValueOnce(null); // user2 not mapped

            const result = await service.stampSIDtoObject(input);

            expect(result.sourceErrors).toEqual([]);
            expect(result.targetErrors).toEqual([]);
            expect(shellService.runCommand).toHaveBeenCalledTimes(2); // getRawSID + 1 setSID (user2 skipped)
        });
    });
});
