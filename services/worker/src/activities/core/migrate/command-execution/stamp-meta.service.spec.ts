import { Test, TestingModule } from '@nestjs/testing';
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

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    chmod: jest.fn(),
    chown: jest.fn(),
    utimes: jest.fn(),
    lutimes: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StampMetaService,
        { provide: RedisService, useValue: redisService },
        { provide: LoggerFactory, useValue: loggerFactory },
        { provide: WinOperationService, useValue: winOperationService },
        { provide: MetricsService, useValue: mockMetricsService },
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
      const input = createMockInput();

      winOperationService.stampAclOperation.mockResolvedValue({
        output: null,
        errors: [],
      });

      const result = await service.stampObjectACL(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(winOperationService.stampAclOperation).toHaveBeenCalledWith(input);
    });

    it('should handle ACL stamping errors', async () => {
      const input = createMockInput();

      winOperationService.stampAclOperation.mockResolvedValue({
        output: null,
        errors: ['ACL operation failed'],
      });
      dmError.mockReturnValue({});

      const result = await service.stampObjectACL(input);

      expect(result.sourceErrors).toEqual([]);
      expect(result.targetErrors).toEqual([]);
      expect(input.jobContext.publishToErrorStream).toHaveBeenCalled();
    });

    it('should handle ACL stamping exceptions', async () => {
      const input = createMockInput();
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
});
