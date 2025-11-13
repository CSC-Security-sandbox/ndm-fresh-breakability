import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WinOperationService } from './win-operation.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WinShellService } from 'src/activities/common/win-shell.service';
import { RedisService } from 'src/redis/redis.service';
import { SourceAclError, TargetAclError } from './acl-operation.error';
import { LRUCache } from 'src/activities/core/utils/lru-cache';
import { OPS_CMD } from '@netapp-cloud-datamigrate/jobs-lib';
import { FileType } from 'src/activities/types/tasks';
import { NativeAclService } from './native-acl.service';

// Import correct types
type SecurityDescriptor = {
  Owner: string;
  Group: string;
  DaclAces: Ace[];
  Attributes: string;
  DaclPresent: boolean;
  DaclProtected: boolean;
  DaclAutoInherit: boolean;
  originalOwner: string;
  originalGroup: string;
};

type Ace = {
  Sid: string;
  AccessMask: number;
  AceType: number;
  AceFlags: number;
  IsInherited: boolean;
  originalSid: string;
};

interface ValidatorOutput {
  sourceSID: string;
  targetSID: string;
  inValid: string;
}

type ShareSecurityDescriptor = {
  shareName: string;
  serverName: string;
  permissions: SharePermission[];
  maxUsers: number;
  currentUsers: number;
  path: string;
  remark: string;
};

type SharePermission = {
  accountName: string;
  sid: string;
  accessMask: number;
  accessType: 'Allow' | 'Deny';
};

type SharePermissions = {
  permissions: SharePermission[];
  maxUsers?: number;
  remark?: string;
};

describe('WinOperationService', () => {
  let service: WinOperationService;
  let mockLoggerFactory: Partial<LoggerFactory>;
  let mockLogger: Partial<LoggerService>;
  let mockWinShellService: Partial<WinShellService>;
  let mockRedisService: Partial<RedisService>;
  let mockConfigService: Partial<ConfigService>;
  let mockNativeAclService: Partial<NativeAclService>;

  beforeEach(async () => {
    // Create mock logger with all required methods
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      setParentContext: jest.fn(),
    };

    mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
      configService: {} as any,
    };

    // Create mock WinShellService with minimal required methods
    mockWinShellService = {
      executeCommand: jest.fn(),
    };

    // Create mock RedisService with required methods
    mockRedisService = {
      getOwnerIdentity: jest.fn(),
      setOwnerIdentity: jest.fn(),
    };

    // Create mock ConfigService
    mockConfigService = {
      get: jest.fn().mockReturnValue('false'), // Default to PowerShell mode
    };

    // Create mock NativeAclService
    mockNativeAclService = {
      getFileSecurity: jest.fn(),
      setFileSecurity: jest.fn(),
      getShareSecurity: jest.fn(),
      setShareSecurity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WinOperationService,
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WinShellService, useValue: mockWinShellService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: NativeAclService, useValue: mockNativeAclService },
      ],
    }).compile();

    service = module.get<WinOperationService>(WinOperationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined and initialize with proper dependencies', () => {
      expect(service).toBeDefined();
      expect(mockLoggerFactory.create).toHaveBeenCalledWith(
        'WinOperationService',
      );
      expect((service as any).sidCache).toBeInstanceOf(LRUCache);
      expect((service as any).sidCache.capacity).toBe(1000);
    });
  });

  describe('getAclOperation', () => {
    const mockSecurityDescriptor: SecurityDescriptor = {
      Owner: 'S-1-5-21-123456789-123456789-123456789-1001',
      Group: 'S-1-5-21-123456789-123456789-123456789-1002',
      DaclAces: [
        {
          Sid: 'S-1-5-21-123456789-123456789-123456789-1003',
          AccessMask: 2032127,
          AceType: 0,
          AceFlags: 0,
          IsInherited: false,
          originalSid: 'S-1-5-21-123456789-123456789-123456789-1003',
        },
      ],
      Attributes: 'SE_DACL_PRESENT',
      DaclPresent: true,
      DaclProtected: false,
      DaclAutoInherit: false,
      originalOwner: 'S-1-5-21-123456789-123456789-123456789-1001',
      originalGroup: 'S-1-5-21-123456789-123456789-123456789-1002',
    };

    it('should successfully get ACL and return SecurityDescriptor', async () => {
      const testPath = 'C:\\test\\path';
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: JSON.stringify(mockSecurityDescriptor),
        stderr: '',
      });

      const result = await service.getAclOperation(testPath, true);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining(testPath),
      );
      expect(result).toEqual(mockSecurityDescriptor);
    });

    it('should handle paths with single quotes correctly', async () => {
      const testPath = "C:\\test\\path's folder";
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: JSON.stringify(mockSecurityDescriptor),
        stderr: '',
      });

      await service.getAclOperation(testPath, true);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining("C:\\test\\path''s folder"),
      );
    });

    it('should throw SourceAclError when isSource is true and command fails', async () => {
      const testPath = 'C:\\test\\path';
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: '',
        stderr: 'Access denied',
      });

      await expect(service.getAclOperation(testPath, true)).rejects.toThrow(
        SourceAclError,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get ACL for C:\\test\\path'),
      );
    });

    it('should throw TargetAclError when isSource is false and command fails', async () => {
      const testPath = 'C:\\test\\path';
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: '',
        stderr: 'Path not found',
      });

      await expect(service.getAclOperation(testPath, false)).rejects.toThrow(
        TargetAclError,
      );
    });

    it('should throw SourceAclError when JSON parsing fails and isSource is true', async () => {
      const testPath = 'C:\\test\\path';
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: 'invalid json',
        stderr: '',
      });

      await expect(service.getAclOperation(testPath, true)).rejects.toThrow(
        SourceAclError,
      );
    });

    it('should throw TargetAclError when JSON parsing fails and isSource is false', async () => {
      const testPath = 'C:\\test\\path';
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: 'invalid json',
        stderr: '',
      });

      await expect(service.getAclOperation(testPath, false)).rejects.toThrow(
        TargetAclError,
      );
    });

    it('should handle PowerShell execution errors correctly', async () => {
      const testPath = 'C:\\test\\path';
      mockWinShellService.executeCommand = jest
        .fn()
        .mockRejectedValue(new Error('PowerShell error'));

      await expect(service.getAclOperation(testPath, true)).rejects.toThrow(
        SourceAclError,
      );
    });
  });

  describe('setAclOperation', () => {
    const mockAcl: SecurityDescriptor = {
      Owner: 'S-1-5-21-123456789-123456789-123456789-1001',
      Group: 'S-1-5-21-123456789-123456789-123456789-1002',
      DaclAces: [],
      Attributes: 'SE_DACL_PRESENT',
      DaclPresent: true,
      DaclProtected: false,
      DaclAutoInherit: false,
      originalOwner: 'S-1-5-21-123456789-123456789-123456789-1001',
      originalGroup: 'S-1-5-21-123456789-123456789-123456789-1002',
    };

    it('should successfully set ACL operation', async () => {
      const testPath = 'C:\\test\\target';
      const expectedOutput = { stdout: 'Success', stderr: '' };
      mockWinShellService.executeCommand = jest
        .fn()
        .mockResolvedValue(expectedOutput);

      const result = await service.setAclOperation(testPath, mockAcl);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining(testPath),
      );
      expect(result).toEqual(expectedOutput);
    });

    it('should handle paths with quotes correctly in ACL setting', async () => {
      const testPath = "C:\\test\\target's folder";
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: 'Success',
        stderr: '',
      });

      await service.setAclOperation(testPath, mockAcl);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining("C:\\test\\target''s folder"),
      );
    });

    it('should handle ACL JSON with quotes correctly', async () => {
      const testPath = 'C:\\test\\target';
      const aclWithQuotes: SecurityDescriptor = {
        Owner: "S-1-5-21-domain's-sid",
        Group: 'S-1-5-21-123456789-123456789-123456789-1002',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: "S-1-5-21-domain's-sid",
        originalGroup: 'S-1-5-21-123456789-123456789-123456789-1002',
      };
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: 'Success',
        stderr: '',
      });

      await service.setAclOperation(testPath, aclWithQuotes);

      const call = (mockWinShellService.executeCommand as jest.Mock).mock
        .calls[0][0];
      expect(call).toContain("S-1-5-21-domain''s-sid");
    });

    it('should throw TargetAclError when command fails', async () => {
      const testPath = 'C:\\test\\target';
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: '',
        stderr: 'Access denied',
      });

      await expect(service.setAclOperation(testPath, mockAcl)).rejects.toThrow(
        TargetAclError,
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to set ACL for C:\\test\\target'),
      );
    });

    it('should throw TargetAclError when PowerShell execution fails', async () => {
      const testPath = 'C:\\test\\target';
      mockWinShellService.executeCommand = jest
        .fn()
        .mockRejectedValue(new Error('PowerShell error'));

      await expect(service.setAclOperation(testPath, mockAcl)).rejects.toThrow(
        TargetAclError,
      );
    });
  });

  describe('stampAclOperation', () => {
    let mockCommand: any;
    let mockJobContext: any;

    beforeEach(() => {
      mockCommand = {
        ops: {
          [OPS_CMD.STAMP_META]: {
            params: {},
          },
        },
      };

      mockJobContext = {
        jobRunId: 'test-job-run-123',
        jobConfig: {
          options: {
            isIdentityMappingAvailable: false,
          },
        },
      };
    });

    it('should successfully stamp ACL without identity mapping', async () => {
      const sourceAcl: SecurityDescriptor = {
        Owner: 'S-1-5-21-source',
        Group: 'S-1-5-21-source-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-source',
        originalGroup: 'S-1-5-21-source-group',
      };

      const targetAcl: SecurityDescriptor = { ...sourceAcl };

      jest
        .spyOn(service, 'getAclOperation')
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(targetAcl);
      jest
        .spyOn(service, 'setAclOperation')
        .mockResolvedValue({ stdout: 'Success' });
      jest.spyOn(service, 'validateAclOperation').mockResolvedValue({
        sourceSID: 'S-1-5-21-source',
        targetSID: 'S-1-5-21-source',
        inValid: '',
      });

      const result = await service.stampAclOperation({
        command: mockCommand,
        jobContext: mockJobContext,
        sourcePath: 'C:\\source',
        targetPath: 'C:\\target',
      } as any);

      expect(result.errors).toEqual([]);
      expect(mockCommand.ops[OPS_CMD.STAMP_META].params.sidMap).toBeDefined();
    });

    it('should handle identity mapping when available', async () => {
      mockJobContext.jobConfig.options.isIdentityMappingAvailable = true;

      const sourceAcl: SecurityDescriptor = {
        Owner: 'S-1-5-21-source',
        Group: 'S-1-5-21-source-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-source',
        originalGroup: 'S-1-5-21-source-group',
      };

      jest
        .spyOn(service, 'getAclOperation')
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(sourceAcl);
      jest.spyOn(service, 'mapSIDToTarget').mockResolvedValue(sourceAcl);
      jest
        .spyOn(service, 'setAclOperation')
        .mockResolvedValue({ stdout: 'Success' });
      jest.spyOn(service, 'validateAclOperation').mockResolvedValue({
        sourceSID: 'S-1-5-21-source',
        targetSID: 'S-1-5-21-source',
        inValid: '',
      });

      await service.stampAclOperation({
        command: mockCommand,
        jobContext: mockJobContext,
        sourcePath: 'C:\\source',
        targetPath: 'C:\\target',
      } as any);

      expect(service.mapSIDToTarget).toHaveBeenCalledWith(
        sourceAcl,
        'test-job-run-123',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Mapping SID to target: true',
      );
    });

    it('should handle invalid owner SID mapping', async () => {
      const sourceAcl: SecurityDescriptor = {
        Owner: 'Invalid',
        originalOwner: 'S-1-5-21-original-owner',
        Group: 'S-1-5-21-source-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalGroup: 'S-1-5-21-source-group',
      };

      jest
        .spyOn(service, 'getAclOperation')
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(sourceAcl);
      jest
        .spyOn(service, 'setAclOperation')
        .mockResolvedValue({ stdout: 'Success' });
      jest.spyOn(service, 'validateAclOperation').mockResolvedValue({
        sourceSID: 'S-1-5-21-source',
        targetSID: 'S-1-5-21-source',
        inValid: '',
      });

      const result = await service.stampAclOperation({
        command: mockCommand,
        jobContext: mockJobContext,
        sourcePath: 'C:\\source',
        targetPath: 'C:\\target',
      } as any);

      expect(result.errors).toContain(
        'Invalid Owner SID for S-1-5-21-original-owner found in SID mapping',
      );
    });

    it('should handle invalid group SID mapping', async () => {
      const sourceAcl: SecurityDescriptor = {
        Owner: 'S-1-5-21-source',
        Group: 'Invalid',
        originalGroup: 'S-1-5-21-original-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-source',
      };

      jest
        .spyOn(service, 'getAclOperation')
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(sourceAcl);
      jest
        .spyOn(service, 'setAclOperation')
        .mockResolvedValue({ stdout: 'Success' });
      jest.spyOn(service, 'validateAclOperation').mockResolvedValue({
        sourceSID: 'S-1-5-21-source',
        targetSID: 'S-1-5-21-source',
        inValid: '',
      });

      const result = await service.stampAclOperation({
        command: mockCommand,
        jobContext: mockJobContext,
        sourcePath: 'C:\\source',
        targetPath: 'C:\\target',
      } as any);

      expect(result.errors).toContain(
        'Invalid Group SID for S-1-5-21-original-group found in SID mapping',
      );
    });

    it('should handle invalid ACE SID and remove invalid ACEs', async () => {
      const sourceAcl: SecurityDescriptor = {
        Owner: 'S-1-5-21-source',
        Group: 'S-1-5-21-source-group',
        DaclAces: [
          {
            Sid: 'Invalid',
            originalSid: 'S-1-5-21-original-ace',
            AccessMask: 2032127,
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
          },
          {
            Sid: 'S-1-5-21-valid-ace',
            AccessMask: 1073741824,
            AceType: 1,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-valid-ace',
          },
        ],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-source',
        originalGroup: 'S-1-5-21-source-group',
      };

      jest
        .spyOn(service, 'getAclOperation')
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(sourceAcl);
      jest
        .spyOn(service, 'setAclOperation')
        .mockResolvedValue({ stdout: 'Success' });
      jest.spyOn(service, 'validateAclOperation').mockResolvedValue({
        sourceSID: 'S-1-5-21-source',
        targetSID: 'S-1-5-21-source',
        inValid: '',
      });

      const result = await service.stampAclOperation({
        command: mockCommand,
        jobContext: mockJobContext,
        sourcePath: 'C:\\source',
        targetPath: 'C:\\target',
      } as any);

      expect(result.errors).toContain(
        'Invalid ACL SID for S-1-5-21-original-ace found in SID mapping',
      );
    });

    it('should handle unresolved SIDs in set ACL result', async () => {
      const sourceAcl: SecurityDescriptor = {
        Owner: 'S-1-5-21-source',
        Group: 'S-1-5-21-source-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-source',
        originalGroup: 'S-1-5-21-source-group',
      };

      const setAclResult = {
        stdout: JSON.stringify({
          unresolved_sids: ['S-1-5-21-unresolved-1', 'S-1-5-21-unresolved-2'],
        }),
      };

      jest
        .spyOn(service, 'getAclOperation')
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(sourceAcl);
      jest.spyOn(service, 'setAclOperation').mockResolvedValue(setAclResult);
      jest.spyOn(service, 'validateAclOperation').mockResolvedValue({
        sourceSID: 'S-1-5-21-source',
        targetSID: 'S-1-5-21-target',
        inValid:
          'Owner mismatch: Expected(S-1-5-21-source) Target(S-1-5-21-target)',
      });

      const result = await service.stampAclOperation({
        command: mockCommand,
        jobContext: mockJobContext,
        sourcePath: 'C:\\source',
        targetPath: 'C:\\target',
      } as any);

      expect(result.errors).toContain(
        'Unresolved SID S-1-5-21-unresolved-1 found while setting ACL on target',
      );
      expect(result.errors).toContain(
        'Unresolved SID S-1-5-21-unresolved-2 found while setting ACL on target',
      );
      expect(mockCommand.ops[OPS_CMD.STAMP_META].params.error).toBe(
        'Owner mismatch: Expected(S-1-5-21-source) Target(S-1-5-21-target)',
      );
      expect(
        mockCommand.ops[OPS_CMD.STAMP_META].params.sidMap.validationError,
      ).toBe(
        'Owner mismatch: Expected(S-1-5-21-source) Target(S-1-5-21-target)',
      );
    });
  });

  describe('mapSIDToTarget', () => {
    beforeEach(() => {
      // Reset cache before each test
      (service as any).sidCache = new LRUCache(1000);
    });

    it('should map SIDs using cache when available', async () => {
      const sourceAcl: SecurityDescriptor = {
        Owner: 'S-1-5-21-source-owner',
        Group: 'S-1-5-21-source-group',
        DaclAces: [
          {
            Sid: 'S-1-5-21-source-ace',
            AccessMask: 2032127,
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-source-ace',
          },
        ],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-source-owner',
        originalGroup: 'S-1-5-21-source-group',
      };

      // Pre-populate cache with jobRunId:SID format (as used by getSIDMapping)
      (service as any).sidCache.put(
        'test-job-run:S-1-5-21-source-owner',
        'S-1-5-21-target-owner',
      );
      (service as any).sidCache.put(
        'test-job-run:S-1-5-21-source-group',
        'S-1-5-21-target-group',
      );
      (service as any).sidCache.put(
        'test-job-run:S-1-5-21-source-ace',
        'S-1-5-21-target-ace',
      );

      const result = await service.mapSIDToTarget(sourceAcl, 'test-job-run');

      expect(result.Owner).toBe('S-1-5-21-target-owner');
      expect(result.Group).toBe('S-1-5-21-target-group');
      expect(result.DaclAces[0].Sid).toBe('S-1-5-21-target-ace');
      expect(mockRedisService.getOwnerIdentity).not.toHaveBeenCalled();
    });

    it('should fetch from Redis when not in cache', async () => {
      const sourceAcl: SecurityDescriptor = {
        Owner: 'S-1-5-21-source-owner',
        Group: 'S-1-5-21-source-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-source-owner',
        originalGroup: 'S-1-5-21-source-group',
      };

      mockRedisService.getOwnerIdentity = jest
        .fn()
        .mockResolvedValueOnce('S-1-5-21-target-owner')
        .mockResolvedValueOnce('S-1-5-21-target-group');

      const result = await service.mapSIDToTarget(sourceAcl, 'test-job-run');

      expect(result.Owner).toBe('S-1-5-21-target-owner');
      expect(result.Group).toBe('S-1-5-21-target-group');
      expect(mockRedisService.getOwnerIdentity).toHaveBeenCalledTimes(2);
    });

    it('should not modify SIDs when mapping not found in Redis', async () => {
      const sourceAcl: SecurityDescriptor = {
        Owner: 'S-1-5-21-unknown-owner',
        Group: 'S-1-5-21-unknown-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-unknown-owner',
        originalGroup: 'S-1-5-21-unknown-group',
      };

      mockRedisService.getOwnerIdentity = jest.fn().mockResolvedValue(null);

      const result = await service.mapSIDToTarget(sourceAcl, 'test-job-run');

      // When mapping not found, original SIDs are kept unchanged
      expect(result.Owner).toBe('S-1-5-21-unknown-owner');
      expect(result.Group).toBe('S-1-5-21-unknown-group');
      expect(result.originalOwner).toBe('S-1-5-21-unknown-owner');
      expect(result.originalGroup).toBe('S-1-5-21-unknown-group');
    });

    it('should handle memory cache updates correctly', async () => {
      const sourceAcl: SecurityDescriptor = {
        Owner: 'S-1-5-21-owner',
        Group: 'S-1-5-21-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-owner',
        originalGroup: 'S-1-5-21-group',
      };

      mockRedisService.getOwnerIdentity = jest
        .fn()
        .mockResolvedValueOnce('S-1-5-21-target-owner')
        .mockResolvedValueOnce('S-1-5-21-target-group');

      await service.mapSIDToTarget(sourceAcl, 'test-job-run');

      // Verify cache was updated with the correct key format (jobRunId:SID)
      expect((service as any).sidCache.get('test-job-run:S-1-5-21-owner')).toBe(
        'S-1-5-21-target-owner',
      );
      expect((service as any).sidCache.get('test-job-run:S-1-5-21-group')).toBe(
        'S-1-5-21-target-group',
      );
    });
  });

  describe('validateAclOperation', () => {
    it('should return no validation errors when ACLs match perfectly', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-owner',
        Group: 'S-1-5-21-group',
        DaclAces: [
          {
            Sid: 'S-1-5-21-ace',
            AccessMask: 2032127,
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-ace',
          },
        ],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-owner',
        originalGroup: 'S-1-5-21-group',
      };

      const acl2: SecurityDescriptor = { ...acl1 };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toBe('');
      expect(result.sourceSID).toBe(
        'Owner: S-1-5-21-owner, Group: S-1-5-21-group,ACE in source: SID(S-1-5-21-ace), AccessMask(2032127), AceType(0). ',
      );
      expect(result.targetSID).toBe(
        'Owner: S-1-5-21-owner, Group: S-1-5-21-group, ACE in target: SID(S-1-5-21-ace), AccessMask(2032127), AceType(0). ',
      );
    });

    it('should detect owner mismatch', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-source-owner',
        Group: 'S-1-5-21-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-source-owner',
        originalGroup: 'S-1-5-21-group',
      };

      const acl2: SecurityDescriptor = {
        ...acl1,
        Owner: 'S-1-5-21-target-owner',
      };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toBe(
        'Owner mismatch: Expected(S-1-5-21-source-owner) Target(S-1-5-21-target-owner). ',
      );
      expect(result.sourceSID).toBe(
        'Owner: S-1-5-21-source-owner, Group: S-1-5-21-group,',
      );
      expect(result.targetSID).toBe(
        'Owner: S-1-5-21-target-owner, Group: S-1-5-21-group, ',
      );
    });

    it('should detect group mismatch', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-owner',
        Group: 'S-1-5-21-source-group',
        DaclAces: [],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-owner',
        originalGroup: 'S-1-5-21-source-group',
      };

      const acl2: SecurityDescriptor = {
        ...acl1,
        Group: 'S-1-5-21-target-group',
      };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toBe(
        'Group mismatch: Expected(S-1-5-21-source-group) Target(S-1-5-21-target-group). ',
      );
    });

    it('should detect missing ACE in target', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-owner',
        Group: 'S-1-5-21-group',
        DaclAces: [
          {
            Sid: 'S-1-5-21-ace',
            AccessMask: 2032127,
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-ace',
          },
        ],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-owner',
        originalGroup: 'S-1-5-21-group',
      };

      const acl2: SecurityDescriptor = {
        ...acl1,
        DaclAces: [],
      };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toBe(
        'Missing ACE in target: SID(S-1-5-21-ace), AccessMask(2032127), AceType(0). ',
      );
    });

    it('should detect multiple validation errors and combine them', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-source-owner',
        Group: 'S-1-5-21-source-group',
        DaclAces: [
          {
            Sid: 'S-1-5-21-ace',
            AccessMask: 2032127,
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-ace',
          },
        ],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-source-owner',
        originalGroup: 'S-1-5-21-source-group',
      };

      const acl2: SecurityDescriptor = {
        ...acl1,
        Owner: 'S-1-5-21-target-owner',
        Group: 'S-1-5-21-target-group',
        DaclAces: [],
      };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toContain('Owner mismatch');
      expect(result.inValid).toContain('Group mismatch');
      expect(result.inValid).toContain('Missing ACE in target');
    });

    it('should handle null or undefined ACE arrays', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-owner',
        Group: 'S-1-5-21-group',
        DaclAces: null as any,
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-owner',
        originalGroup: 'S-1-5-21-group',
      };

      const acl2: SecurityDescriptor = {
        ...acl1,
        DaclAces: [],
      };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toBe('');
    });

    it('should handle Creator Owner ACE (S-1-3-0) correctly', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-owner',
        Group: 'S-1-5-21-group',
        DaclAces: [
          {
            Sid: 'S-1-3-0', // Creator Owner
            AccessMask: 2032127,
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-3-0',
          },
        ],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-owner',
        originalGroup: 'S-1-5-21-group',
      };

      const acl2: SecurityDescriptor = {
        ...acl1,
        DaclAces: [
          {
            Sid: 'S-1-3-0',
            AccessMask: 1073741824, // Different access mask but should still match for Creator Owner
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-3-0',
          },
        ],
      };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toBe('');
    });

    it('should handle missing Creator Owner ACE in target', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-owner',
        Group: 'S-1-5-21-group',
        DaclAces: [
          {
            Sid: 'S-1-3-0',
            AccessMask: 2032127,
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-3-0',
          },
        ],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-owner',
        originalGroup: 'S-1-5-21-group',
      };

      const acl2: SecurityDescriptor = {
        ...acl1,
        DaclAces: [],
      };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toBe(
        'Missing ACE in target: SID(S-1-3-0), AceType(0). ',
      );
    });

    it('should handle ACE with matching SID and AceType but insufficient AccessMask', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-owner',
        Group: 'S-1-5-21-group',
        DaclAces: [
          {
            Sid: 'S-1-5-21-user',
            AccessMask: 2032127, // Full access
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-user',
          },
        ],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-owner',
        originalGroup: 'S-1-5-21-group',
      };

      const acl2: SecurityDescriptor = {
        ...acl1,
        DaclAces: [
          {
            Sid: 'S-1-5-21-user',
            AccessMask: 1048576, // Limited access
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-user',
          },
        ],
      };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toBe(
        'Missing ACE in target: SID(S-1-5-21-user), AccessMask(2032127), AceType(0). ',
      );
    });

    it('should filter out non-access control ACEs (AceType 3, 5)', async () => {
      const acl1: SecurityDescriptor = {
        Owner: 'S-1-5-21-owner',
        Group: 'S-1-5-21-group',
        DaclAces: [
          {
            Sid: 'S-1-5-21-user',
            AccessMask: 2032127,
            AceType: 3, // Audit ACE - should be filtered out
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-user',
          },
          {
            Sid: 'S-1-5-21-user2',
            AccessMask: 1048576,
            AceType: 0, // Access Allowed ACE
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-user2',
          },
        ],
        Attributes: 'SE_DACL_PRESENT',
        DaclPresent: true,
        DaclProtected: false,
        DaclAutoInherit: false,
        originalOwner: 'S-1-5-21-owner',
        originalGroup: 'S-1-5-21-group',
      };

      const acl2: SecurityDescriptor = {
        ...acl1,
        DaclAces: [
          {
            Sid: 'S-1-5-21-user2',
            AccessMask: 1048576,
            AceType: 0,
            AceFlags: 0,
            IsInherited: false,
            originalSid: 'S-1-5-21-user2',
          },
        ],
      };

      const result = await service.validateAclOperation(acl1, acl2);

      expect(result.inValid).toBe(''); // Should be valid because audit ACE is ignored
    });
  });

  describe('resetFileAttributes', () => {
    it('should successfully reset file attributes', async () => {
      const testPath = 'C:\\test\\file.txt';
      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: 'Attributes reset successfully',
        stderr: '',
      });

      const result = await service.resetFileAttributes(testPath);

      expect(result).toBe(true);
      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        `attrib -H -R "${testPath}"`,
      );
    });

    it('should throw error when attribute reset fails', async () => {
      const testPath = 'C:\\test\\file.txt';
      mockWinShellService.executeCommand = jest
        .fn()
        .mockRejectedValue(new Error('Access denied'));

      await expect(service.resetFileAttributes(testPath)).rejects.toThrow(
        'Failed to reset file attributes for C:\\test\\file.txt',
      );
    });
  });

  describe('resolveUsernamesToSids', () => {
    it('should resolve multiple usernames to SIDs', async () => {
      const usernames = ['user1', 'user2', 'user3'];
      const mockOutput = [
        { username: 'user1', sid: 'S-1-5-21-1001' },
        { username: 'user2', sid: 'S-1-5-21-1002' },
        { username: 'user3', sid: 'S-1-5-21-1003' },
      ];

      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: JSON.stringify(mockOutput),
        stderr: '',
      });

      const result = await service.resolveUsernamesToSids(usernames);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        'Resolve-UsernamesToSid -Username user1,user2,user3',
      );
      expect(result.get('user1')).toBe('S-1-5-21-1001');
      expect(result.get('user2')).toBe('S-1-5-21-1002');
      expect(result.get('user3')).toBe('S-1-5-21-1003');
      expect(result.size).toBe(3);
    });

    it('should handle single username resolution', async () => {
      const usernames = ['singleuser'];
      const mockOutput = { username: 'singleuser', sid: 'S-1-5-21-1001' };

      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: JSON.stringify(mockOutput),
        stderr: '',
      });

      const result = await service.resolveUsernamesToSids(usernames);

      expect(result.get('singleuser')).toBe('S-1-5-21-1001');
      expect(result.size).toBe(1);
    });

    it('should handle empty array response', async () => {
      const usernames = ['nonexistentuser'];
      const mockOutput: any[] = [];

      mockWinShellService.executeCommand = jest.fn().mockResolvedValue({
        stdout: JSON.stringify(mockOutput),
        stderr: '',
      });

      const result = await service.resolveUsernamesToSids(usernames);

      expect(result.size).toBe(1);
      expect(result.get(undefined as any)).toBe(undefined);
    });
  });

  describe('getSIDMapping', () => {
    beforeEach(() => {
      // Reset cache before each test
      (service as any).sidCache = new LRUCache(1000);
    });

    it('should return cached value when available', async () => {
      const sourceSid = 'S-1-5-21-source';
      const jobRunId = 'test-job';
      const cachedValue = 'S-1-5-21-target';

      (service as any).sidCache.put(`${jobRunId}:${sourceSid}`, cachedValue);

      const result = await (service as any).getSIDMapping(sourceSid, jobRunId);

      expect(result).toBe(cachedValue);
      expect(mockRedisService.getOwnerIdentity).not.toHaveBeenCalled();
    });

    it('should query Redis when not in cache and cache the result', async () => {
      const sourceSid = 'S-1-5-21-source';
      const jobRunId = 'test-job';
      const redisValue = 'S-1-5-21-target';

      mockRedisService.getOwnerIdentity = jest
        .fn()
        .mockResolvedValue(redisValue);

      const result = await (service as any).getSIDMapping(sourceSid, jobRunId);

      expect(result).toBe(redisValue);
      expect(mockRedisService.getOwnerIdentity).toHaveBeenCalledWith(
        jobRunId,
        sourceSid,
        'SID',
      );
      expect((service as any).sidCache.get(`${jobRunId}:${sourceSid}`)).toBe(
        redisValue,
      );
    });

    it('should return null when SID not found in Redis', async () => {
      const sourceSid = 'S-1-5-21-unknown';
      const jobRunId = 'test-job';

      mockRedisService.getOwnerIdentity = jest.fn().mockResolvedValue(null);

      const result = await (service as any).getSIDMapping(sourceSid, jobRunId);

      expect(result).toBe(null);
      expect(mockRedisService.getOwnerIdentity).toHaveBeenCalledWith(
        jobRunId,
        sourceSid,
        'SID',
      );
    });
  });

  describe('detectSymbolicLinkType', () => {
    it('should return JUNCTION when IsJunction is true', async () => {
      const testPath = 'C:\\test\\junction';
      const mockOutput = {
        stdout: JSON.stringify({ IsJunction: true, IsSymbolicLink: false }),
        stderr: '',
      };

      mockWinShellService.executeCommand = jest.fn().mockResolvedValue(mockOutput);

      const result = await service.detectSymbolicLinkType(testPath);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining(testPath.replace(/'/g, "''")),
      );
      expect(result).toBe(FileType.JUNCTION);
    });

    it('should return SYMBOLIC_LINK when IsSymbolicLink is true', async () => {
      const testPath = 'C:\\test\\symlink';
      const mockOutput = {
        stdout: JSON.stringify({ IsJunction: false, IsSymbolicLink: true }),
        stderr: '',
      };

      mockWinShellService.executeCommand = jest.fn().mockResolvedValue(mockOutput);

      const result = await service.detectSymbolicLinkType(testPath);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining(testPath.replace(/'/g, "''")),
      );
      expect(result).toBe(FileType.SYMBOLIC_LINK);
    });

    it('should return UNKNOWN when neither IsJunction nor IsSymbolicLink is true', async () => {
      const testPath = 'C:\\test\\unknown';
      const mockOutput = {
        stdout: JSON.stringify({ IsJunction: false, IsSymbolicLink: false }),
        stderr: '',
      };

      mockWinShellService.executeCommand = jest.fn().mockResolvedValue(mockOutput);

      const result = await service.detectSymbolicLinkType(testPath);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining(testPath.replace(/'/g, "''")),
      );
      expect(result).toBe(FileType.UNKNOWN);
    });

    it('should return UNKNOWN and log error when PowerShell command fails', async () => {
      const testPath = 'C:\\test\\error';
      const errorMessage = 'PowerShell execution error';
      mockWinShellService.executeCommand = jest
        .fn()
        .mockRejectedValue(new Error(errorMessage));

      const result = await service.detectSymbolicLinkType(testPath);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining(testPath.replace(/'/g, "''")),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to detect symbolic link for ${testPath}`),
      );
      expect(result).toBe(FileType.UNKNOWN);
    });

    it('should return UNKNOWN and log error when stderr is present in output', async () => {
      const testPath = 'C:\\test\\stderr';
      const mockOutput = {
        stdout: '',
        stderr: 'Access denied',
      };

      mockWinShellService.executeCommand = jest.fn().mockResolvedValue(mockOutput);

      const result = await service.detectSymbolicLinkType(testPath);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining(testPath.replace(/'/g, "''")),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to detect symbolic link for ${testPath}`),
      );
      expect(result).toBe(FileType.UNKNOWN);
    });

    it('should handle paths with single quotes correctly', async () => {
      const testPath = "C:\\test\\path's folder";
      const mockOutput = {
        stdout: JSON.stringify({ IsJunction: false, IsSymbolicLink: true }),
        stderr: '',
      };

      mockWinShellService.executeCommand = jest.fn().mockResolvedValue(mockOutput);

      const result = await service.detectSymbolicLinkType(testPath);

      expect(mockWinShellService.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining("C:\\test\\path''s folder"),
      );
      expect(result).toBe(FileType.SYMBOLIC_LINK);
    });
  });

  describe('Native ACL Mode', () => {
    let nativeService: WinOperationService;
    const mockSecurityDescriptor: SecurityDescriptor = {
      Owner: 'S-1-5-21-123456789-123456789-123456789-1001',
      Group: 'S-1-5-21-123456789-123456789-123456789-1002',
      DaclAces: [
        {
          Sid: 'S-1-5-21-123456789-123456789-123456789-1003',
          AccessMask: 2032127,
          AceType: 0,
          AceFlags: 0,
          IsInherited: false,
          originalSid: 'S-1-5-21-123456789-123456789-123456789-1003',
        },
      ],
      Attributes: 'Archive',
      DaclPresent: true,
      DaclProtected: false,
      DaclAutoInherit: false,
      originalOwner: 'S-1-5-21-123456789-123456789-123456789-1001',
      originalGroup: 'S-1-5-21-123456789-123456789-123456789-1002',
    };

    beforeEach(async () => {
      // Create service with native ACL enabled
      const nativeConfigService = {
        get: jest.fn().mockReturnValue('true'), // Enable native mode
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WinOperationService,
          { provide: LoggerFactory, useValue: mockLoggerFactory },
          { provide: ConfigService, useValue: nativeConfigService },
          { provide: WinShellService, useValue: mockWinShellService },
          { provide: RedisService, useValue: mockRedisService },
          { provide: NativeAclService, useValue: mockNativeAclService },
        ],
      }).compile();

      nativeService = module.get<WinOperationService>(WinOperationService);
    });

    it('should use native ACL service when enabled', async () => {
      const testPath = 'C:\\test\\path';
      mockNativeAclService.getFileSecurity = jest
        .fn()
        .mockResolvedValue(mockSecurityDescriptor);

      const result = await nativeService.getAclOperation(testPath, true);

      expect(mockNativeAclService.getFileSecurity).toHaveBeenCalledWith(testPath);
      expect(mockWinShellService.executeCommand).not.toHaveBeenCalled();
      expect(result).toEqual(mockSecurityDescriptor);
    });

    it('should use native ACL service for setAclOperation when enabled', async () => {
      const testPath = 'C:\\test\\path';
      const mockResult = { success: true, unresolved_sids: [] };
      mockNativeAclService.setFileSecurity = jest
        .fn()
        .mockResolvedValue(mockResult);

      const result = await nativeService.setAclOperation(testPath, mockSecurityDescriptor);

      expect(mockNativeAclService.setFileSecurity).toHaveBeenCalledWith(
        testPath,
        mockSecurityDescriptor,
      );
      expect(mockWinShellService.executeCommand).not.toHaveBeenCalled();
      expect(result.stdout).toContain('"success":true');
    });
  });

  describe('Share-level Permissions', () => {
    const mockShareSecurity: ShareSecurityDescriptor = {
      shareName: 'TestShare',
      serverName: 'localhost',
      permissions: [
        {
          accountName: 'DOMAIN\\User',
          sid: 'S-1-5-21-123456789-123456789-123456789-1001',
          accessMask: 2032127,
          accessType: 'Allow',
        },
      ],
      maxUsers: 10,
      currentUsers: 0,
      path: 'C:\\Shares\\TestShare',
      remark: 'Test share',
    };

    beforeEach(() => {
      // Enable native mode for share permissions
      mockConfigService.get = jest.fn().mockReturnValue('true');
    });

    it('should get share security when native ACL is enabled', async () => {
      mockNativeAclService.getShareSecurity = jest
        .fn()
        .mockResolvedValue(mockShareSecurity);

      const result = await service.getShareSecurity('localhost', 'TestShare');

      expect(mockNativeAclService.getShareSecurity).toHaveBeenCalledWith(
        'localhost',
        'TestShare',
      );
      expect(result).toEqual(mockShareSecurity);
    });

    it('should throw error when share security is requested but native ACL is disabled', async () => {
      mockConfigService.get = jest.fn().mockReturnValue('false');

      // Recreate service with native disabled
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WinOperationService,
          { provide: LoggerFactory, useValue: mockLoggerFactory },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: WinShellService, useValue: mockWinShellService },
          { provide: RedisService, useValue: mockRedisService },
          { provide: NativeAclService, useValue: mockNativeAclService },
        ],
      }).compile();

      const disabledService = module.get<WinOperationService>(WinOperationService);

      await expect(
        disabledService.getShareSecurity('localhost', 'TestShare'),
      ).rejects.toThrow('Share-level permissions require native Windows API');
    });

    it('should set share security when native ACL is enabled', async () => {
      const sharePermissions: SharePermissions = {
        permissions: [
          {
            accountName: 'DOMAIN\\User',
            sid: 'S-1-5-21-123456789-123456789-123456789-1001',
            accessMask: 2032127,
            accessType: 'Allow',
          },
        ],
        maxUsers: 10,
        remark: 'Test share',
      };

      mockNativeAclService.setShareSecurity = jest
        .fn()
        .mockResolvedValue(true);

      const result = await service.setShareSecurity(
        'localhost',
        'TestShare',
        sharePermissions,
      );

      expect(mockNativeAclService.setShareSecurity).toHaveBeenCalledWith(
        'localhost',
        'TestShare',
        sharePermissions,
      );
      expect(result).toBe(true);
    });
  });
});
