import { Test, TestingModule } from '@nestjs/testing';
import { StampMetaService } from './stamp-meta.service';
import { ShellService } from 'src/activities/common/shell.service';
import { RedisService } from 'src/redis/redis.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import {
  OPS_CMD,
  OPS_STATUS,
  ErrorType,
} from '@netapp-cloud-datamigrate/jobs-lib';
import * as fs from 'fs';
import { CommandExecInput } from './command-execution.type';
import { AclOperations } from './aclOperations';
import { ShellPoolExecutorService } from './shell-for-meta-stamping.service';
import { Origin, Operation } from 'src/activities/utils/utils.types';
import { FileAccessError } from './aclOperations.errors';

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
  log: jest.fn(),
};

describe('StampMetaService', () => {
  let service: StampMetaService;
  let shellService: jest.Mocked<ShellService>;
  let redisService: jest.Mocked<RedisService>;
  let loggerFactory: jest.Mocked<LoggerFactory>;
  let aclOperations: jest.Mocked<AclOperations>;
  let shellPoolExecutorService: jest.Mocked<ShellPoolExecutorService>;

  const mockFs = fs as jest.Mocked<typeof fs>;
  const {
    dmError,
    formatDate,
    getUserACLs,
  } = require('src/activities/utils/utils');

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

    aclOperations = {
      stampFileACL: jest.fn(),
      getFileACL: jest.fn(),
      compareACLs: jest.fn(),
      compareFileACLs: jest.fn(),
      aclToOneLineString: jest.fn(),
      stampFileOwner: jest.fn(),
    } as any;

    shellPoolExecutorService = {
      execute: jest.fn(),
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
        { provide: AclOperations, useValue: aclOperations },
        {
          provide: ShellPoolExecutorService,
          useValue: shellPoolExecutorService,
        },
      ],
    }).compile();

    service = module.get<StampMetaService>(StampMetaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockInput = (
    metadata = {},
    jobConfig = {},
    isDir = false,
  ): CommandExecInput => ({
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
      expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(
        OPS_STATUS.COMPLETED,
      );
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
      expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(
        OPS_STATUS.ERROR,
      );
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
      expect(mockFs.promises.chmod).toHaveBeenCalledWith(
        '/target/test-file.txt',
        0o755,
      );
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
        error.stack,
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
      expect(mockFs.promises.chown).toHaveBeenCalledWith(
        '/target/test-file.txt',
        1001,
        1000,
      );
    });

    it('should successfully stamp GID and UID with identity mapping', async () => {
      const input = createMockInput(
        { gid: 1000, uid: 1001 },
        { isIdentityMappingAvailable: true },
      );
      (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);
      redisService.getOwnerIdentity
        .mockResolvedValueOnce('2000') // mapped gid
        .mockResolvedValueOnce('2001'); // mapped uid

      const result = await service.stampGIDandUID(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(redisService.getOwnerIdentity).toHaveBeenCalledWith(
        'job-run-123',
        '1000',
        'GID',
      );
      expect(redisService.getOwnerIdentity).toHaveBeenCalledWith(
        'job-run-123',
        '1001',
        'UID',
      );
      expect(mockFs.promises.chown).toHaveBeenCalledWith(
        '/target/test-file.txt',
        2001,
        2000,
      );
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
        { isIdentityMappingAvailable: true },
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
        error.stack,
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
        new Date('2023-01-02T12:00:00Z'),
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
        error.stack,
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
        { preserveAccessTime: true },
      );
      (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

      const result = await service.preserveAccessAndModifiedTime(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(mockFs.promises.utimes).toHaveBeenCalledWith(
        '/source/test-file.txt',
        new Date('2023-01-02T14:00:00Z'),
        new Date('2023-01-02T12:00:00Z'),
      );
    });

    it('should skip when preserveAccessTime is disabled', async () => {
      const input = createMockInput(
        {
          mtime: new Date('2023-01-02T12:00:00Z'),
          atime: new Date('2023-01-02T14:00:00Z'),
        },
        { preserveAccessTime: false },
      );

      const result = await service.preserveAccessAndModifiedTime(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(mockFs.promises.utimes).not.toHaveBeenCalled();
    });

    it('should skip when mtime or atime is missing', async () => {
      const input = createMockInput(
        { mtime: undefined, atime: new Date() },
        { preserveAccessTime: true },
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
        { preserveAccessTime: true },
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
        error.stack,
      );
      expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
    });

    describe('stampFileAttributeMeta', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          writable: true,
        });
      });

      it('should successfully synchronize file attributes', async () => {
        const input = createMockInput();
        shellService.runCommand
          .mockResolvedValueOnce('A H') // source attributes
          .mockResolvedValueOnce('A') // target attributes
          .mockResolvedValueOnce('A H'); // verify after change

        const result = await service.stampFileAttributeMeta(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
      });

      it('should skip when platform is not win32', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const input = createMockInput();

        const result = await service.stampFileAttributeMeta(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
      });

      it('should handle error when getting source attributes', async () => {
        const input = createMockInput();
        const error = new Error('Source not found') as any;
        error.code = 'ENOENT';
        shellService.runCommand.mockRejectedValueOnce(error);

        dmError.mockReturnValue({});

        const result = await service.stampFileAttributeMeta(input);

        expect(result.sourceErrors).toEqual(['ENOENT']);
        expect(result.targetErrors).toEqual([]);
      });

      it('should handle error when setting/removing attributes', async () => {
        const input = createMockInput();
        shellService.runCommand
          .mockResolvedValueOnce('A H') // source attributes
          .mockResolvedValueOnce('A') // target attributes
          .mockRejectedValueOnce(new Error('Failed to set attributes'));
        dmError.mockReturnValue({});

        const result = await service.stampFileAttributeMeta(input);

        expect(result.sourceErrors).toEqual([]);
      });

      it('should log warning if verifying attribute changes fails', async () => {
        const input = createMockInput();
        shellService.runCommand
          .mockResolvedValueOnce('A H') // source attributes
          .mockResolvedValueOnce('A') // target attributes
          .mockResolvedValueOnce(undefined) // attrib command
          .mockRejectedValueOnce(new Error('Verify failed')); // verify

        const result = await service.stampFileAttributeMeta(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
      });

      it('should log when no attribute changes are needed', async () => {
        const input = createMockInput();
        shellService.runCommand
          .mockResolvedValueOnce('A H') // source attributes
          .mockResolvedValueOnce('A H'); // target attributes

        const result = await service.stampFileAttributeMeta(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
      });

      it('should handle error when getting target attributes', async () => {
        const input = createMockInput();
        shellService.runCommand
          .mockResolvedValueOnce('A H') // source attributes
          .mockRejectedValueOnce(new Error('Target not found'));

        const result = await service.stampFileAttributeMeta(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
      });
    });

    describe('removeFileAttributeTemporarily', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          writable: true,
        });
      });

      it('should return false if no attributes to remove', async () => {
        shellService.runCommand.mockResolvedValueOnce('A');

        const result =
          await service.removeFileAttributeTemporarily('/some/file.txt');

        expect(result).toBe(false);
      });

      it('should handle errors gracefully', async () => {
        shellService.runCommand.mockRejectedValueOnce(new Error('Failed'));

        const result =
          await service.removeFileAttributeTemporarily('/some/file.txt');

        expect(result).toBe(false);
      });

      it('should skip on non-win32 platforms', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });

        const result =
          await service.removeFileAttributeTemporarily('/some/file.txt');

        expect(result).toBe(false);
      });
    });

    describe('restoreFileAttribute', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          writable: true,
        });
      });

      it('should return false if no attributes to add', async () => {
        shellService.runCommand.mockResolvedValueOnce('A H R');

        const result = await service.restoreFileAttribute('/some/file.txt');

        expect(result).toBe(false);
      });

      it('should handle errors gracefully', async () => {
        shellService.runCommand.mockRejectedValueOnce(new Error('Failed'));

        const result = await service.restoreFileAttribute('/some/file.txt');

        expect(result).toBe(false);
      });

      it('should skip on non-win32 platforms', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });

        const result = await service.restoreFileAttribute('/some/file.txt');

        expect(result).toBe(false);
      });
    });

    describe('stampSIDAclToObject', () => {
      it('should successfully stamp SID and ACL to object', async () => {
        const input = createMockInput();
        const mockStampData = {
          source: '/source/test-file.txt',
          target: '/target/test-file.txt',
          timestamp: '2023-01-01T10:00:00Z',
          commands: ['test-command'],
          success: true,
          operations: [
            { status: 'completed' as const, type: 'grant' as const, principal: 'test-user' },
            { status: 'completed' as const, type: 'deny' as const, principal: 'test-group' }
          ]
        };
        const mockComparisonResult = {
          isEqual: true,
          source: {
            filePath: '/source/test-file.txt',
            timestamp: '2023-01-01T10:00:00Z',
            permissions: [{ principal: 'test-user', accessType: 'allow' as const, permissions: [] }],
            inheritance: null
          },
          target: {
            filePath: '/target/test-file.txt',
            timestamp: '2023-01-01T10:00:00Z',
            permissions: [{ principal: 'test-user', accessType: 'allow' as const, permissions: [] }],
            inheritance: null
          },
          differences: { 
            onlyInSource: [], 
            onlyInTarget: [], 
            different: [],
            identical: []
          }
        };

        aclOperations.stampFileACL.mockResolvedValue(mockStampData);
        aclOperations.compareFileACLs.mockResolvedValue(mockComparisonResult);
        aclOperations.aclToOneLineString.mockReturnValue('test-acl-string');

        const result = await service.stampSIDAclToObject(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
        expect(aclOperations.stampFileACL).toHaveBeenCalledWith(
          '/source/test-file.txt',
          '/target/test-file.txt',
          expect.objectContaining({
            preserveExisting: false,
            excludePrincipals: [],
            includePrincipals: [],
            isIdentityMappingAvailable: false,
            jobID: 'job-run-123',
            disableInheritance: false
          })
        );
        expect(aclOperations.compareFileACLs).toHaveBeenCalled();
      });

      it('should handle failed ACL operations', async () => {
        const input = createMockInput();
        const mockStampData = {
          source: '/source/test-file.txt',
          target: '/target/test-file.txt',
          timestamp: '2023-01-01T10:00:00Z',
          commands: ['test-command'],
          success: false,
          operations: [
            { 
              status: 'failed' as const, 
              type: 'grant' as const, 
              principal: 'test-user',
              error: 'Permission denied'
            },
            { 
              status: 'skipped' as const, 
              type: 'skip' as const,
              principal: 'test-group',
              reason: 'unresolved SID'
            }
          ]
        };
        const mockComparisonResult = {
          isEqual: false,
          source: {
            filePath: '/source/test-file.txt',
            timestamp: '2023-01-01T10:00:00Z',
            permissions: [{ principal: 'test-user', accessType: 'allow' as const, permissions: [] }],
            inheritance: null
          },
          target: {
            filePath: '/target/test-file.txt',
            timestamp: '2023-01-01T10:00:00Z',
            permissions: [],
            inheritance: null
          },
          differences: { 
            onlyInSource: [{ principal: 'test-user', accessType: 'allow' as const, permissions: [] }], 
            onlyInTarget: [], 
            different: [],
            identical: []
          }
        };

        aclOperations.stampFileACL.mockResolvedValue(mockStampData);
        aclOperations.compareFileACLs.mockResolvedValue(mockComparisonResult);
        aclOperations.aclToOneLineString.mockReturnValue('test-acl-string');
        dmError.mockReturnValue({});

        const result = await service.stampSIDAclToObject(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
        expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        expect(dmError).toHaveBeenCalled();
      });

      it('should handle ACL comparison errors', async () => {
        const input = createMockInput();
        const mockStampData = {
          source: '/source/test-file.txt',
          target: '/target/test-file.txt',
          timestamp: '2023-01-01T10:00:00Z',
          commands: ['test-command'],
          success: true,
          operations: []
        };

        aclOperations.stampFileACL.mockResolvedValue(mockStampData);
        aclOperations.compareFileACLs.mockRejectedValue(new Error('Comparison failed'));
        dmError.mockReturnValue({});

        const result = await service.stampSIDAclToObject(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
        expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
      });

      it('should handle ACL stamp errors and classify as source or destination error', async () => {
        const input = createMockInput();
        const sourceError = new FileAccessError('/source/test-file.txt', new Error('Source access denied'));
        
        aclOperations.stampFileACL.mockRejectedValue(sourceError);
        dmError.mockReturnValue({});

        const result = await service.stampSIDAclToObject(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual(['FILE_ACCESS_ERROR']);
        expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        expect(dmError).toHaveBeenCalledWith(
          "OPERATION", 
          Origin.SOURCE, 
          Operation.STAMP_META, 
          ErrorType.RECOVERABLE_ERROR,
          'cmd-1',
          sourceError,
          { name: '/test-file.txt', path: '/source/test-file.txt' }
        );
      });

      it('should handle no mapping errors correctly', async () => {
        const input = createMockInput();
        const mockStampData = {
          source: '/source/test-file.txt',
          target: '/target/test-file.txt',
          timestamp: '2023-01-01T10:00:00Z',
          commands: ['test-command'],
          success: false,
          operations: [
            { 
              status: 'failed' as const, 
              type: 'grant' as const, 
              principal: 'test-user',
              error: 'No mapping available for this user (1332)'
            }
          ]
        };

        aclOperations.stampFileACL.mockResolvedValue(mockStampData);
        aclOperations.compareFileACLs.mockResolvedValue({
          isEqual: true,
          source: {
            filePath: '/source/test-file.txt',
            timestamp: '2023-01-01T10:00:00Z',
            permissions: [],
            inheritance: null
          },
          target: {
            filePath: '/target/test-file.txt',
            timestamp: '2023-01-01T10:00:00Z',
            permissions: [],
            inheritance: null
          },
          differences: { 
            onlyInSource: [], 
            onlyInTarget: [], 
            different: [],
            identical: []
          }
        });
        aclOperations.aclToOneLineString.mockReturnValue('test-acl-string');
        dmError.mockReturnValue({});

        const result = await service.stampSIDAclToObject(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
        expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
      });
    });

    describe('stampFileOwner', () => {
      it('should successfully stamp file owner', async () => {
        const input = createMockInput();
        
        aclOperations.stampFileOwner.mockResolvedValue(true);

        const result = await service.stampFileOwner(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
        expect(aclOperations.stampFileOwner).toHaveBeenCalledWith({
          sourcePath: '/source/test-file.txt',
          targetPath: '/target/test-file.txt',
          isIdentityMappingAvailable: false,
          jobRunId: 'job-run-123'
        });
      });

      it('should handle owner stamping failure with string error', async () => {
        const input = createMockInput();
        
        aclOperations.stampFileOwner.mockResolvedValue('Owner mapping failed');
        dmError.mockReturnValue({});

        const result = await service.stampFileOwner(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual(['UNKNOWN_ERROR']);
        expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        expect(dmError).toHaveBeenCalledWith(
          "OPERATION",
          Origin.DESTINATION,
          Operation.STAMP_META,
          ErrorType.RECOVERABLE_ERROR,
          'cmd-1',
          new Error('Owner mapping failed'),
          { name: '/test-file.txt', path: '/target/test-file.txt' }
        );
      });

      it('should handle owner stamping failure with non-boolean return', async () => {
        const input = createMockInput();
        
        aclOperations.stampFileOwner.mockResolvedValue(null);
        dmError.mockReturnValue({});

        const result = await service.stampFileOwner(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual(['UNKNOWN_ERROR']);
        expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
        expect(dmError).toHaveBeenCalledWith(
          "OPERATION",
          Origin.DESTINATION,
          Operation.STAMP_META,
          ErrorType.RECOVERABLE_ERROR,
          'cmd-1',
          new Error('Unknown error while stamping file owner'),
          { name: '/test-file.txt', path: '/target/test-file.txt' }
        );
      });

      it('should handle owner stamping exception', async () => {
        const input = createMockInput();
        const error = new Error('Access denied');
        
        aclOperations.stampFileOwner.mockRejectedValue(error);
        dmError.mockReturnValue({});

        const result = await service.stampFileOwner(input);

        expect(result.sourceErrors).toEqual(['STAMP_FILE_OWNER_ERROR']);
        expect(result.targetErrors).toEqual([]);
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error during stamping file owner from /source/test-file.txt to /target/test-file.txt: Access denied',
          error.stack
        );
      });

      it('should use identity mapping when available', async () => {
        const input = createMockInput({}, { isIdentityMappingAvailable: true });
        
        aclOperations.stampFileOwner.mockResolvedValue(true);

        await service.stampFileOwner(input);

        expect(aclOperations.stampFileOwner).toHaveBeenCalledWith({
          sourcePath: '/source/test-file.txt',
          targetPath: '/target/test-file.txt',
          isIdentityMappingAvailable: true,
          jobRunId: 'job-run-123'
        });
      });
    });
  });
});
