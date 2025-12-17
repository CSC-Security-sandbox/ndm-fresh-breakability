import { Test, TestingModule } from '@nestjs/testing';
import { WinOperationService } from './win-operation.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WinShellService } from 'src/activities/common/win-shell.service';
import { RedisService } from 'src/redis/redis.service';
import { SourceAclError, TargetAclError, WindowsAPINotAvailableError } from './acl-operation.error';
import { LRUCache } from 'src/activities/core/utils/lru-cache';
import { OPS_CMD } from '@netapp-cloud-datamigrate/jobs-lib';
import { FileType } from 'src/activities/types/tasks';

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

describe('WinOperationService', () => {
  let service: WinOperationService;
  let mockLoggerFactory: Partial<LoggerFactory>;
  let mockLogger: Partial<LoggerService>;
  let mockWinShellService: Partial<WinShellService>;
  let mockRedisService: Partial<RedisService>;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WinOperationService,
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: WinShellService, useValue: mockWinShellService },
        { provide: RedisService, useValue: mockRedisService },
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

  describe('detectADSInfo', () => {
    // Helper to create Uint16Array from string for decodeStreamName tests
    const createUint16Array = (str: string, addGarbageAfter = false): Uint16Array => {
      const arr = new Uint16Array(296);
      for (let i = 0; i < str.length; i++) {
        arr[i] = str.charCodeAt(i);
      }
      arr[str.length] = 0; // Null terminator
      if (addGarbageAfter) {
        arr[str.length + 1] = 65;
        arr[str.length + 2] = 66;
      }
      return arr;
    };

    // Mock jobContext and command for detectADSInfo tests
    let mockJobContextForADS: any;
    let mockCommandForADS: any;

    beforeEach(() => {
      mockJobContextForADS = {
        jobRunId: 'test-job-run-123',
        jobConfig: {
          jobType: 'DISCOVERY',
          options: {},
          scanADS: true,
        },
        publishToErrorStream: jest.fn(),
        publishToFileStream: jest.fn(),
      };

      mockCommandForADS = {
        id: 'test-cmd-id',
        fPath: 'test/path',
        ops: {},
      };
    });

    describe('when Windows API is not available', () => {
      it('should return default empty result after first WindowsAPINotAvailableError and set hasWindowsAPIs to false', async () => {
        // Arrange: Create a fresh service instance with mocked initializeWindowsAPI
        const module = await Test.createTestingModule({
          providers: [
            WinOperationService,
            { provide: LoggerFactory, useValue: mockLoggerFactory },
            { provide: WinShellService, useValue: mockWinShellService },
            { provide: RedisService, useValue: mockRedisService },
          ],
        }).compile();

        const freshService = module.get<WinOperationService>(WinOperationService);
        
        // Mock initializeWindowsAPI to prevent actual Windows API initialization
        jest.spyOn(freshService, 'initializeWindowsAPI').mockImplementation(() => {});
        
        // First call throws WindowsAPINotAvailableError and sets hasWindowsAPIs to false
        const result = await freshService.detectADSInfo(mockJobContextForADS, mockCommandForADS, 'C:\\test\\file.txt');
        
        // Should return default result after error is caught and logged
        expect(result).toEqual({
          hasADS: false,
          streamCount: 0,
          streamNames: [],
          streamSizes: [],
          totalSize: 0,
        });
        expect(mockJobContextForADS.publishToErrorStream).toHaveBeenCalled();
      });

      it('should return empty result on subsequent calls after Windows API is unavailable', async () => {
        // Arrange: Create a fresh service instance with mocked initializeWindowsAPI
        const module = await Test.createTestingModule({
          providers: [
            WinOperationService,
            { provide: LoggerFactory, useValue: mockLoggerFactory },
            { provide: WinShellService, useValue: mockWinShellService },
            { provide: RedisService, useValue: mockRedisService },
          ],
        }).compile();

        const freshService = module.get<WinOperationService>(WinOperationService);
        jest.spyOn(freshService, 'initializeWindowsAPI').mockImplementation(() => {});

        // First call sets hasWindowsAPIs to false
        await freshService.detectADSInfo(mockJobContextForADS, mockCommandForADS, 'C:\\test\\file1.txt');
        
        // Reset mock to verify second call doesn't publish error again
        mockJobContextForADS.publishToErrorStream.mockClear();
        
        // Second call should return default result immediately without throwing
        const result = await freshService.detectADSInfo(mockJobContextForADS, mockCommandForADS, 'C:\\test\\file2.txt');
        
        expect(result).toEqual({
          hasADS: false,
          streamCount: 0,
          streamNames: [],
          streamSizes: [],
          totalSize: 0,
        });
        // Should not publish error again since hasWindowsAPIs is already false
        expect(mockJobContextForADS.publishToErrorStream).not.toHaveBeenCalled();
      });
    });

    describe('file with no alternate data streams', () => {
      it.each([
        ['regular file with default stream only', 'C:\\test\\regular_file.txt'],
        ['nonexistent file', 'C:\\nonexistent\\file.txt'],
      ])('should return empty result for %s when Windows API is unavailable', async (_description, testPath) => {
        // On non-Windows platforms, Windows API is not available, so it returns default result
        const result = await service.detectADSInfo(mockJobContextForADS, mockCommandForADS, testPath);
        
        expect(result).toEqual({
          hasADS: false,
          streamCount: 0,
          streamNames: [],
          streamSizes: [],
          totalSize: 0,
        });
      });
    });

    describe('extractADSName - valid stream types', () => {
      const validStreamTestCases = [
        // Zone.Identifier streams (downloaded files)
        { category: 'Zone.Identifier', streamName: ':Zone.Identifier:$DATA', expected: 'Zone.Identifier' },

        // Empty/whitespace streams
        { category: 'Empty stream', streamName: ':EmptyStream:$DATA', expected: 'EmptyStream' },
        { category: 'Whitespace stream', streamName: ':   :$DATA', expected: '   ' },

        // Binary streams
        { category: 'Binary data', streamName: ':BinaryData:$DATA', expected: 'BinaryData' },
        { category: 'Hidden executable', streamName: ':hidden_executable:$DATA', expected: 'hidden_executable' },
        { category: 'Thumbnail image', streamName: ':thumbnail:$DATA', expected: 'thumbnail' },

        // Office document streams
        { category: 'SummaryInformation', streamName: ':SummaryInformation:$DATA', expected: 'SummaryInformation' },
        { category: 'DocumentSummaryInformation', streamName: ':DocumentSummaryInformation:$DATA', expected: 'DocumentSummaryInformation' },

        // System/attribute streams
        { category: 'Attribute list', streamName: ':$ATTRIBUTE_LIST:$DATA', expected: '$ATTRIBUTE_LIST' },

        // Mac compatibility streams
        { category: 'AFP_AfpInfo (Mac)', streamName: ':AFP_AfpInfo:$DATA', expected: 'AFP_AfpInfo' },
        { category: 'AFP_Resource (Mac)', streamName: ':AFP_Resource:$DATA', expected: 'AFP_Resource' },

        // Antivirus markers
        { category: 'CA_INOCULATEIT (antivirus)', streamName: ':CA_INOCULATEIT:$DATA', expected: 'CA_INOCULATEIT' },

        // Special characters
        { category: 'Special characters', streamName: ':stream-with_special.chars123:$DATA', expected: 'stream-with_special.chars123' },
        { category: 'Unicode characters', streamName: ':日本語ストリーム:$DATA', expected: '日本語ストリーム' },
        { category: 'Embedded colons', streamName: ':stream:with:colons:$DATA', expected: 'stream:with:colons' },
      ];

      it.each(validStreamTestCases)(
        'should extract $category stream name correctly',
        ({ streamName, expected }) => {
          const extractedName = (service as any).extractADSName(streamName);
          expect(extractedName).toBe(expected);
        },
      );

      it('should handle very long stream names (200 chars)', () => {
        const longName = 'a'.repeat(200);
        const streamName = `:${longName}:$DATA`;

        const extractedName = (service as any).extractADSName(streamName);

        expect(extractedName).toBe(longName);
        expect(extractedName.length).toBe(200);
      });
    });

    describe('extractADSName - invalid stream formats', () => {
      const invalidStreamTestCases = [
        { description: 'default stream (::$DATA)', streamName: '::$DATA' },
        { description: 'stream not starting with colon', streamName: 'InvalidStream:$DATA' },
        { description: 'stream not ending with :$DATA', streamName: ':InvalidStream' },
        { description: 'empty string', streamName: '' },
        { description: 'only suffix', streamName: ':$DATA' },
      ];

      it.each(invalidStreamTestCases)(
        'should return null for $description',
        ({ streamName }) => {
          const extractedName = (service as any).extractADSName(streamName);
          expect(extractedName).toBeNull();
        },
      );
    });

    describe('extractADSName - multiple streams parsing', () => {
      it('should correctly parse multiple stream names', () => {
        const streamNames = [
          ':Zone.Identifier:$DATA',
          ':metadata:$DATA',
          ':backup:$DATA',
        ];

        const extractedNames = streamNames.map((name) =>
          (service as any).extractADSName(name),
        );

        expect(extractedNames).toEqual(['Zone.Identifier', 'metadata', 'backup']);
      });
    });

    describe('decodeStreamName', () => {
      const decodeTestCases = [
        { description: 'UTF-16 encoded stream name', input: ':TestStream:$DATA', expected: ':TestStream:$DATA' },
        { description: 'unicode characters', input: ':データ:$DATA', expected: ':データ:$DATA' },
        { description: 'short name with garbage after null', input: ':Short', expected: ':Short', addGarbage: true },
      ];

      it.each(decodeTestCases)(
        'should decode $description correctly',
        ({ input, expected, addGarbage }) => {
          const uint16Array = createUint16Array(input, addGarbage);
          const decoded = (service as any).decodeStreamName(uint16Array);
          expect(decoded).toBe(expected);
        },
      );

      it('should handle empty stream name (immediate null terminator)', () => {
        const uint16Array = new Uint16Array(296);
        uint16Array[0] = 0;

        const decoded = (service as any).decodeStreamName(uint16Array);

        expect(decoded).toBe('');
      });
    });

    describe('error handling', () => {
      it.each([
        ['null handle from FindFirstStreamW', 'C:\\test\\file.txt'],
        ['exception during detection', 'C:\\test\\problematic_file.txt'],
      ])('should return empty result for %s when Windows API is unavailable', async (_description, testPath) => {
        // On non-Windows platforms, Windows API is not available, so it returns default result
        const result = await service.detectADSInfo(mockJobContextForADS, mockCommandForADS, testPath);
        
        expect(result).toEqual({
          hasADS: false,
          streamCount: 0,
          streamNames: [],
          streamSizes: [],
          totalSize: 0,
        });
      });
    });

    describe('ADSInfo result structure', () => {
      it('should return correct default ADSInfo structure when Windows API is unavailable', async () => {
        // On non-Windows platforms, Windows API is not available, so it returns default result
        const result = await service.detectADSInfo(mockJobContextForADS, mockCommandForADS, 'C:\\test\\file.txt');
        
        // Verify structure and types
        expect(result).toMatchObject({
          hasADS: expect.any(Boolean),
          streamCount: expect.any(Number),
          streamNames: expect.any(Array),
          streamSizes: expect.any(Array),
          totalSize: expect.any(Number),
        });

        // Verify consistency for default result
        expect(result.streamCount).toBe(result.streamNames.length);
        expect(result.streamCount).toBe(result.streamSizes.length);
        expect(result.hasADS).toBe(result.streamNames.length > 0);
      });

      it('should correctly calculate totalSize as sum of all stream sizes', () => {
        const sizes = [100, 200, 300];
        const expectedTotal = sizes.reduce((sum, size) => sum + size, 0);
        expect(expectedTotal).toBe(600);
      });
    });

    describe('file path handling', () => {
      const pathTestCases = [
        { description: 'UNC paths', path: '\\\\server\\share\\file.txt' },
        { description: 'paths with spaces', path: 'C:\\Program Files\\My App\\data file.txt' },
        { description: 'paths with special characters', path: 'C:\\test\\file (1) [copy].txt' },
        { description: 'very long paths', path: 'C:\\' + 'a'.repeat(200) + '\\file.txt' },
      ];

      it.each(pathTestCases)(
        'should return empty result for $description when Windows API is unavailable',
        async ({ path }) => {
          // On non-Windows platforms, Windows API is not available, so it returns default result
          const result = await service.detectADSInfo(mockJobContextForADS, mockCommandForADS, path);
          
          expect(result).toBeDefined();
          expect(result).toHaveProperty('hasADS');
          expect(result).toHaveProperty('streamCount');
        },
      );
    });
  });
});
