import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StampMetaService } from './stamp-meta.service';
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
import { MetricsService } from 'src/metrics/metrics.service';
import { CommandExecInput } from './command-execution.type';
import { WinOperationService } from './win-opeartions/win-operation.service';
import { DeferredDirStampService } from '../../shared/deferred-dir-stamp.service';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    chmod: jest.fn(),
    chown: jest.fn(),
    utimes: jest.fn(),
    lutimes: jest.fn(),
    lstat: jest.fn(),
  },
}));

// Mock utils functions (keep getErrorCode real; dmError is asserted via mockReturnValue)
jest.mock('src/activities/utils/utils', () => ({
  ...jest.requireActual<typeof import('src/activities/utils/utils')>(
    'src/activities/utils/utils',
  ),
  dmError: jest.fn(),
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
  let redisService: jest.Mocked<RedisService>;
  let loggerFactory: jest.Mocked<LoggerFactory>;
  let winOperationService: jest.Mocked<WinOperationService>;

  const mockFs = fs as jest.Mocked<typeof fs>;
  const { dmError } = require('src/activities/utils/utils');

  beforeEach(async () => {
    redisService = {
      getOwnerIdentity: jest.fn(),
    } as any;

    loggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    } as any;

    winOperationService = {
      stampAclOperation: jest.fn(),
      resetFileAttributes: jest.fn(),
    } as any;

    const mockMetricsService = {
      runWithTiming: jest.fn().mockImplementation((_workflowId: string, _spec: string, fn: () => unknown) =>
        typeof fn === 'function' ? Promise.resolve(fn()) : Promise.resolve(),
      ),
    };

    // Setup fs.promises mocks
    (mockFs.promises.chmod as jest.Mock).mockResolvedValue(undefined);
    (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);
    (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);
    (mockFs.promises.lutimes as jest.Mock).mockResolvedValue(undefined);
    (mockFs.promises.lstat as jest.Mock).mockResolvedValue({ ctimeMs: 1000000 });

    const mockConfigService = {
      get: jest.fn().mockImplementation((_key: string, defaultValue?: any) => {
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StampMetaService,
        { provide: RedisService, useValue: redisService },
        { provide: LoggerFactory, useValue: loggerFactory },
        { provide: WinOperationService, useValue: winOperationService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: DeferredDirStampService, useValue: { add: jest.fn(), popBatch: jest.fn(), cleanup: jest.fn(), count: jest.fn() } },
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
    it('should successfully stamp all metadata on Windows when STAMP_META operation is ready', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });
      const input = createMockInput();

      // Mock successful operations
      (mockFs.promises.chmod as jest.Mock).mockResolvedValue(undefined);
      (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);
      winOperationService.stampAclOperation.mockResolvedValue({
        output: null,
        errors: [],
      });

      const result = await service.stampMetaData(input);

      expect(result.shouldStampMeta).toBe(false);
      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(
        OPS_STATUS.COMPLETED,
      );
    });

    it('should successfully stamp all metadata on Linux when STAMP_META operation is ready', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });
      const input = createMockInput();

      // Mock successful operations
      (mockFs.promises.chmod as jest.Mock).mockResolvedValue(undefined);
      (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);
      (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

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
      const input = createMockInput({}, { preservePermissions: true });

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
      const input = createMockInput({ mode: 0o755 }, { preservePermissions: true });
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
      const input = createMockInput({ mode: 0o755 }, { preservePermissions: true });
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
      const input = createMockInput({ gid: 1000, uid: 1001 }, { preservePermissions: true });
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
        { isIdentityMappingAvailable: true, preservePermissions: true },
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

    it('should stamp when GID is 0 (root) without identity mapping', async () => {
      const input = createMockInput({ gid: 0, uid: 3001 }, { preservePermissions: true });
      (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);

      const result = await service.stampGIDandUID(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(mockFs.promises.chown).toHaveBeenCalledWith(
        '/target/test-file.txt',
        3001,
        0,
      );
    });

    it('should stamp when UID is 0 (root) without identity mapping', async () => {
      const input = createMockInput({ gid: 1000, uid: 0 }, { preservePermissions: true });
      (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);

      const result = await service.stampGIDandUID(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(mockFs.promises.chown).toHaveBeenCalledWith(
        '/target/test-file.txt',
        0,
        1000,
      );
    });

    it('should apply mapped value of "0" from identity mapping', async () => {
      const input = createMockInput(
        { gid: 0, uid: 3001 },
        { isIdentityMappingAvailable: true, preservePermissions: true },
      );
      (mockFs.promises.chown as jest.Mock).mockResolvedValue(undefined);
      redisService.getOwnerIdentity
        .mockResolvedValueOnce('0')    // mapped gid stays 0
        .mockResolvedValueOnce('0');   // mapped uid 3001 → 0

      const result = await service.stampGIDandUID(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(mockFs.promises.chown).toHaveBeenCalledWith(
        '/target/test-file.txt',
        0,
        0,
      );
    });

    it('should publish error and not chown when identity mapping is missing in Redis', async () => {
      const input = createMockInput(
        { gid: 1000, uid: 3001 },
        { isIdentityMappingAvailable: true, preservePermissions: true },
      );
      dmError.mockReturnValue({});
      redisService.getOwnerIdentity
        .mockResolvedValueOnce(null) // no mapping for gid
        .mockResolvedValueOnce(null); // no mapping for uid

      const result = await service.stampGIDandUID(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual(['IDENTITY_MAPPING_NOT_FOUND']);
      expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
      expect(mockFs.promises.chown).not.toHaveBeenCalled();
    });

    it('should skip when GID or UID is missing', async () => {
      const input = createMockInput({ gid: undefined, uid: 1001 });

      const result = await service.stampGIDandUID(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(mockFs.promises.chown).not.toHaveBeenCalled();
    });

    it('should publish error and not chown when identity mapping returns null values', async () => {
      const input = createMockInput(
        { gid: 1000, uid: 1001 },
        { isIdentityMappingAvailable: true, preservePermissions: true },
      );
      dmError.mockReturnValue({});
      redisService.getOwnerIdentity
        .mockResolvedValueOnce(null) // mapped gid is null
        .mockResolvedValueOnce('2001'); // mapped uid

      const result = await service.stampGIDandUID(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual(['IDENTITY_MAPPING_NOT_FOUND']);
      expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
      expect(mockFs.promises.chown).not.toHaveBeenCalled();
    });

    it('should publish error and not chown when Redis returns empty string mapping', async () => {
      const input = createMockInput(
        { gid: 1000, uid: 1001 },
        { isIdentityMappingAvailable: true, preservePermissions: true },
      );
      dmError.mockReturnValue({});
      redisService.getOwnerIdentity
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('2001');

      const result = await service.stampGIDandUID(input);

      expect(result.targetErrors).toEqual(['IDENTITY_MAPPING_NOT_FOUND']);
      expect(mockFs.promises.chown).not.toHaveBeenCalled();
    });

    it('should handle chown errors gracefully', async () => {
      const input = createMockInput({ gid: 1000, uid: 1001 }, { preservePermissions: true });
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

    // Directory mtimes/atimes are clobbered by every child write, so the per-command
    // stamp is intentionally skipped — the deferred restamp pass at the end of
    // ChildSyncWorkflow re-applies them deepest-first. See DeferredDirStampService.
    it('should skip utimes/lutimes when command is a directory (deferred restamp owns it)', async () => {
      const input = createMockInput(
        {
          mtime: new Date('2023-01-02T12:00:00Z'),
          atime: new Date('2023-01-02T14:00:00Z'),
        },
        {},
        true, // isDir
      );

      const result = await service.stampAccessAndModifiedTime(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(mockFs.promises.utimes).not.toHaveBeenCalled();
      expect((mockFs.promises as any).lutimes).not.toHaveBeenCalled();
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

    it('should use lutimes for symlinks when preserving access time', async () => {
      const input = createMockInput(
        {
          mtime: new Date('2023-01-02T12:00:00Z'),
          atime: new Date('2023-01-02T14:00:00Z'),
          isSymLink: true,
        },
        { preserveAccessTime: true },
      );
      (mockFs.promises.lutimes as jest.Mock).mockResolvedValue(undefined);

      const result = await service.preserveAccessAndModifiedTime(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(mockFs.promises.lutimes).toHaveBeenCalledWith(
        '/source/test-file.txt',
        new Date('2023-01-02T14:00:00Z'),
        new Date('2023-01-02T12:00:00Z'),
      );
      expect(mockFs.promises.utimes).not.toHaveBeenCalled();
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
  });

  describe('stampObjectACL', () => {
    it('should successfully stamp ACL', async () => {
      const input = createMockInput({}, { preservePermissions: true });

      winOperationService.stampAclOperation.mockResolvedValue({
        output: null,
        errors: [],
      });

      const result = await service.stampObjectACL(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(winOperationService.stampAclOperation).toHaveBeenCalledWith(input);
    });

    it('should handle ACL stamping errors and propagate to targetErrors', async () => {
      const input = createMockInput({}, { preservePermissions: true });

      winOperationService.stampAclOperation.mockResolvedValue({
        output: null,
        errors: ['ACL operation failed'],
      });
      dmError.mockReturnValue({});

      const result = await service.stampObjectACL(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual(['ACL operation failed']);
      expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
    });

    it('should propagate multiple errors to targetErrors', async () => {
      const input = createMockInput({}, { preservePermissions: true });

      winOperationService.stampAclOperation.mockResolvedValue({
        output: null,
        errors: [
          'Invalid Owner SID for S-1-5-21-original-owner found in SID mapping',
          'Unresolved SID S-1-5-21-unresolved found while setting ACL on target',
        ],
      });
      dmError.mockReturnValue({});

      const result = await service.stampObjectACL(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([
        'Invalid Owner SID for S-1-5-21-original-owner found in SID mapping',
        'Unresolved SID S-1-5-21-unresolved found while setting ACL on target',
      ]);
      expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
    });

    it('should not stamp ACL or populate targetErrors when preservePermissions is false', async () => {
      const input = createMockInput({}, { preservePermissions: false });

      const result = await service.stampObjectACL(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(winOperationService.stampAclOperation).not.toHaveBeenCalled();
    });

    it('should handle ACL stamping exceptions', async () => {
      const input = createMockInput({}, { preservePermissions: true });
      const error = new Error('ACL operation failed') as any;
      error.code = 'ACCESS_DENIED';

      winOperationService.stampAclOperation.mockRejectedValue(error);
      dmError.mockReturnValue({});

      const result = await service.stampObjectACL(input);

      expect(result.sourceErrors).toEqual(['ACCESS_DENIED']);
      expect(result.targetErrors).toEqual([]);
      expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Stamping ACL from /source/test-file.txt to /target/test-file.txt, Error: ACL operation failed',
        error.stack,
      );
    });
  });

  describe('resetFileAttributes', () => {
    it('should successfully reset file attributes', async () => {
      winOperationService.resetFileAttributes.mockResolvedValue(true);

      const result = await service.resetFileAttributes('/test/path.txt');

      expect(result).toBe(true);
      expect(winOperationService.resetFileAttributes).toHaveBeenCalledWith(
        '/test/path.txt',
      );
    });

    it('should return false when reset fails', async () => {
      winOperationService.resetFileAttributes.mockResolvedValue(false);

      const result = await service.resetFileAttributes('/test/path.txt');

      expect(result).toBe(false);
      expect(winOperationService.resetFileAttributes).toHaveBeenCalledWith(
        '/test/path.txt',
      );
    });

    it('should propagate errors from winOperationService', async () => {
      winOperationService.resetFileAttributes.mockRejectedValue(
        new Error('Access denied'),
      );

      await expect(
        service.resetFileAttributes('/test/path.txt'),
      ).rejects.toThrow('Access denied');
      expect(winOperationService.resetFileAttributes).toHaveBeenCalledWith(
        '/test/path.txt',
      );
    });
  });

  describe('preservePermissions flag behavior', () => {
    describe('Linux - chmod and chown operations', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'linux',
          writable: true,
        });
      });

      it('should skip chmod when preservePermissions is false', async () => {
        const input = createMockInput({}, { preservePermissions: false });

        const result = await service.stampMetaData(input);

        expect(mockFs.promises.chmod).not.toHaveBeenCalled();
        expect(result.targetErrors).toEqual([]);
        expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.COMPLETED);
      });

      it('should execute chmod when preservePermissions is true', async () => {
        const input = createMockInput(
          { mode: 0o755 },
          { preservePermissions: true }
        );

        await service.stampMetaData(input);

        expect(mockFs.promises.chmod).toHaveBeenCalledWith(
          '/target/test-file.txt',
          0o755
        );
      });

      it('should skip chown when preservePermissions is false', async () => {
        const input = createMockInput(
          { gid: 1000, uid: 1001 },
          { preservePermissions: false }
        );

        const result = await service.stampMetaData(input);

        expect(mockFs.promises.chown).not.toHaveBeenCalled();
        expect(result.targetErrors).toEqual([]);
      });

      it('should execute chown when preservePermissions is true', async () => {
        const input = createMockInput(
          { gid: 1000, uid: 1001 },
          { preservePermissions: true }
        );

        await service.stampMetaData(input);

        expect(mockFs.promises.chown).toHaveBeenCalledWith(
          '/target/test-file.txt',
          1001,
          1000
        );
      });

      it('should call chmod before utimes on target so chmod does not overwrite atime', async () => {
        const input = createMockInput(
          {
            mode: 0o755,
            gid: 1000,
            uid: 1001,
            atime: new Date('2023-01-02T14:00:00Z'),
            mtime: new Date('2023-01-02T12:00:00Z'),
          },
          { preservePermissions: true }
        );

        await service.stampMetaData(input);

        // preserveAccessAndModifiedTime calls utimes on source first,
        // then stampPermission calls chmod on target,
        // then stampAccessAndModifiedTime calls utimes on target.
        // chmod must run before the final utimes so it does not overwrite atime.
        const chmodOrder = (mockFs.promises.chmod as jest.Mock).mock.invocationCallOrder[0];
        const utimesCalls = (mockFs.promises.utimes as jest.Mock).mock.invocationCallOrder;
        const utimesTargetOrder = utimesCalls[utimesCalls.length - 1]; // last utimes is on target
        expect(chmodOrder).toBeLessThan(utimesTargetOrder);
      });

      it('should still stamp atime when preservePermissions is false but preserveAccessTime is true', async () => {
        const input = createMockInput(
          { atime: new Date('2023-01-02T14:00:00Z'), mtime: new Date('2023-01-02T12:00:00Z') },
          { preservePermissions: false, preserveAccessTime: true }
        );

        await service.stampMetaData(input);

        expect(mockFs.promises.chmod).not.toHaveBeenCalled();
        expect(mockFs.promises.chown).not.toHaveBeenCalled();
        expect(mockFs.promises.utimes).toHaveBeenCalledWith(
          '/target/test-file.txt',
          expect.any(Date),
          expect.any(Date)
        );
      });
    });

    describe('Windows - ACL operations', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          writable: true,
        });
      });

      it('should skip ACL stamping when preservePermissions is false', async () => {
        const input = createMockInput(
          { sid: 'S-1-5-21-123456789' },
          { preservePermissions: false }
        );

        const result = await service.stampMetaData(input);

        expect(winOperationService.stampAclOperation).not.toHaveBeenCalled();
        expect(result.targetErrors).toEqual([]);
        expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.COMPLETED);
      });

      it('should execute ACL stamping when preservePermissions is true', async () => {
        const input = createMockInput(
          { sid: 'S-1-5-21-123456789' },
          { preservePermissions: true }
        );

        winOperationService.stampAclOperation.mockResolvedValue({
          output: null,
          errors: [],
        });

        await service.stampMetaData(input);

        expect(winOperationService.stampAclOperation).toHaveBeenCalled();
      });

      it('should skip both chmod and ACL when preservePermissions is false on Windows', async () => {
        const input = createMockInput(
          { mode: 0o644, sid: 'S-1-5-21-123456789' },
          { preservePermissions: false }
        );

        await service.stampMetaData(input);

        expect(mockFs.promises.chmod).not.toHaveBeenCalled();
        expect(winOperationService.stampAclOperation).not.toHaveBeenCalled();
      });

      it('should not call stampAccessAndModifiedTime when stampObjectACL fails with errors', async () => {
        const input = createMockInput(
          {
            atime: new Date('2023-01-02T14:00:00Z'),
            mtime: new Date('2023-01-02T12:00:00Z'),
          },
          { preservePermissions: true, preserveAccessTime: false }
        );

        winOperationService.stampAclOperation.mockResolvedValue({
          output: null,
          errors: ['ACL operation failed'],
        });
        dmError.mockReturnValue({});

        const result = await service.stampMetaData(input);

        expect(result.targetErrors).toContain('ACL operation failed');
        expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.ERROR);
        // stampAccessAndModifiedTime must not run when ACL has errors, so utimes (target) is never called
        expect(mockFs.promises.utimes).not.toHaveBeenCalled();
      });

      it('should call stampAccessAndModifiedTime on target when ACL stamping succeeds with no errors', async () => {
        const input = createMockInput(
          {
            atime: new Date('2023-01-02T14:00:00Z'),
            mtime: new Date('2023-01-02T12:00:00Z'),
          },
          { preservePermissions: true, preserveAccessTime: false }
        );

        winOperationService.stampAclOperation.mockResolvedValue({
          output: null,
          errors: [],
        });
        (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

        await service.stampMetaData(input);

        expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.COMPLETED);
        expect(mockFs.promises.utimes).toHaveBeenCalledWith(
          '/target/test-file.txt',
          new Date('2023-01-02T14:00:00Z'),
          new Date('2023-01-02T12:00:00Z'),
        );
      });
    });

    describe('Edge cases', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'linux',
          writable: true,
        });
      });

      it('should default to skipping permissions when preservePermissions is undefined', async () => {
        const input = createMockInput({ mode: 0o755 }, {});
        delete input.jobContext.jobConfig.options.preservePermissions;

        await service.stampMetaData(input);

        expect(mockFs.promises.chmod).not.toHaveBeenCalled();
      });

      it('should handle preservePermissions true with identity mapping enabled', async () => {
        redisService.getOwnerIdentity.mockResolvedValueOnce('2000'); // mapped gid
        redisService.getOwnerIdentity.mockResolvedValueOnce('2001'); // mapped uid

        const input = createMockInput(
          { gid: 1000, uid: 1001 },
          { preservePermissions: true, isIdentityMappingAvailable: true }
        );

        await service.stampMetaData(input);

        expect(redisService.getOwnerIdentity).toHaveBeenCalledTimes(2);
        expect(mockFs.promises.chown).toHaveBeenCalledWith(
          '/target/test-file.txt',
          2001,
          2000
        );
      });

      it('should not error when permissions operations are skipped', async () => {
        const input = createMockInput(
          { mode: 0o755, gid: 1000, uid: 1001 },
          { preservePermissions: false }
        );

        const result = await service.stampMetaData(input);

        expect(result.sourceErrors).toEqual([]);
        expect(result.targetErrors).toEqual([]);
        expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.COMPLETED);
      });
    });
  });

  describe('executeStampAtimeAndPreserveSource (via STAMP_ATIME op)', () => {
    const createAtimeInput = (
      metadata = {},
      jobConfig = {},
      isDir = false,
    ): CommandExecInput => ({
      command: {
        id: 'cmd-atime',
        fPath: '/test-file.txt',
        isDir,
        ops: {
          [OPS_CMD.STAMP_ATIME]: { status: OPS_STATUS.READY, params: {} },
        },
        metadata: {
          mode: 0o644,
          birthtime: new Date('2023-01-01T10:00:00Z'),
          gid: 1000,
          uid: 1001,
          sid: 'test-sid',
          mtime: new Date('2023-01-02T12:00:00Z'),
          atime: new Date('2023-01-02T14:00:00Z'),
          ...metadata,
        },
        serialize: jest.fn(),
      } as any,
      jobContext: {
        jobRunId: 'job-run-atime',
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

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
    });

    it('should stamp atime/mtime on target and set STAMP_ATIME status to COMPLETED', async () => {
      const input = createAtimeInput();
      (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

      const result = await service.stampMetaData(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.COMPLETED);
      expect(mockFs.promises.utimes).toHaveBeenCalledWith(
        '/target/test-file.txt',
        new Date('2023-01-02T14:00:00Z'),
        new Date('2023-01-02T12:00:00Z'),
      );
    });

    it('should also preserve atime/mtime on source when preserveAccessTime is enabled', async () => {
      const input = createAtimeInput({}, { preserveAccessTime: true });
      (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

      await service.stampMetaData(input);

      const utimesCalls = (mockFs.promises.utimes as jest.Mock).mock.calls;
      const sourceCalls = utimesCalls.filter(c => c[0] === '/source/test-file.txt');
      const targetCalls = utimesCalls.filter(c => c[0] === '/target/test-file.txt');
      expect(sourceCalls).toHaveLength(1);
      expect(targetCalls).toHaveLength(1);
    });

    it('should NOT call preserve on source when preserveAccessTime is disabled', async () => {
      const input = createAtimeInput({}, { preserveAccessTime: false });
      (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

      await service.stampMetaData(input);

      const utimesCalls = (mockFs.promises.utimes as jest.Mock).mock.calls;
      const sourceCalls = utimesCalls.filter(c => c[0] === '/source/test-file.txt');
      expect(sourceCalls).toHaveLength(0);
    });

    it('directory: preserve runs on source, stampAccessAndModifiedTime skips dest (isDir early return)', async () => {
      const input = createAtimeInput({}, { preserveAccessTime: true }, true /* isDir */);
      input.sourcePath = '/source/test-dir';
      input.targetPath = '/target/test-dir';
      (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

      await service.stampMetaData(input);

      const utimesCalls = (mockFs.promises.utimes as jest.Mock).mock.calls;
      const sourceCalls = utimesCalls.filter(c => c[0] === '/source/test-dir');
      const targetCalls = utimesCalls.filter(c => c[0] === '/target/test-dir');
      // preserve normalizes source dir atime so it matches what DeferredDirStampService stamps on dest
      expect(sourceCalls).toHaveLength(1);
      // stampAccessAndModifiedTime returns early for dirs — dest is handled by DeferredDirStampService
      expect(targetCalls).toHaveLength(0);
      expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.COMPLETED);
    });

    it('should NOT call chown (stampGIDandUID is skipped)', async () => {
      const input = createAtimeInput({ gid: 1000, uid: 1001 }, { preservePermissions: true });

      await service.stampMetaData(input);

      expect(mockFs.promises.chown).not.toHaveBeenCalled();
    });

    it('should NOT call chmod (stampPermission is skipped)', async () => {
      const input = createAtimeInput({ mode: 0o755 }, { preservePermissions: true });

      await service.stampMetaData(input);

      expect(mockFs.promises.chmod).not.toHaveBeenCalled();
    });

    it('should NOT call stampAclOperation even on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
      const input = createAtimeInput({ sid: 'S-1-5-21-123' }, { preservePermissions: true });
      (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

      await service.stampMetaData(input);

      expect(winOperationService.stampAclOperation).not.toHaveBeenCalled();
    });

    it('should set STAMP_ATIME status to ERROR and propagate targetErrors when stampAccessAndModifiedTime fails', async () => {
      const input = createAtimeInput();
      const error = new Error('utimes failed') as any;
      error.code = 'EIO';
      (mockFs.promises.utimes as jest.Mock).mockRejectedValue(error);
      dmError.mockReturnValue({});

      const result = await service.stampMetaData(input);

      expect(result.targetErrors).toContain('EIO');
      expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.ERROR);
    });

    it('should set STAMP_ATIME status to ERROR and propagate sourceErrors when preserve fails', async () => {
      const input = createAtimeInput({}, { preserveAccessTime: true });
      const error = new Error('utimes source failed') as any;
      error.code = 'EPERM';
      (mockFs.promises.utimes as jest.Mock).mockRejectedValue(error);
      dmError.mockReturnValue({});

      const result = await service.stampMetaData(input);

      expect(result.sourceErrors).toContain('EPERM');
      expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.ERROR);
    });

    it('should skip execution when STAMP_ATIME op is already COMPLETED', async () => {
      const input = createAtimeInput();
      input.command.ops[OPS_CMD.STAMP_ATIME].status = OPS_STATUS.COMPLETED;

      await service.stampMetaData(input);

      expect(mockFs.promises.utimes).not.toHaveBeenCalled();
    });

    it('should process STAMP_ATIME independently of STAMP_META (both can coexist in ops)', async () => {
      const input = createAtimeInput();
      // Add a STAMP_META op alongside STAMP_ATIME — STAMP_META runs first, STAMP_ATIME runs after
      input.command.ops[OPS_CMD.STAMP_META] = { status: OPS_STATUS.READY, params: {} };
      (mockFs.promises.utimes as jest.Mock).mockResolvedValue(undefined);

      const result = await service.stampMetaData(input);

      // Both ops processed; STAMP_META runs first (full stamp), STAMP_ATIME runs after
      expect(input.command.ops[OPS_CMD.STAMP_ATIME].status).toBe(OPS_STATUS.COMPLETED);
      expect(input.command.ops[OPS_CMD.STAMP_META].status).toBe(OPS_STATUS.COMPLETED);
      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
    });
  });

  describe('symlink branches', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
    });

    it('stampGIDandUID uses lchown for symlinks', async () => {
      (mockFs.promises as any).lchown = jest.fn().mockResolvedValue(undefined);
      const input = createMockInput(
        { gid: 1000, uid: 1001, isSymLink: true },
        { preservePermissions: true }
      );
      await service.stampMetaData(input);
      expect((mockFs.promises as any).lchown).toHaveBeenCalled();
    });

    it('stampAccessAndModifiedTime uses lutimes for symlinks', async () => {
      const input = createMockInput(
        { isSymLink: true },
        {}
      );
      await service.stampMetaData(input);
      expect(mockFs.promises.lutimes).toHaveBeenCalled();
    });
  });
});