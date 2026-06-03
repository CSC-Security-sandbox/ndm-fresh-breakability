import { Test, TestingModule } from '@nestjs/testing';
import { SetupExportsPathPermissionService } from './setup-exports-path-permission.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { RedisService } from 'src/redis/redis.service';
import { ProtocolTypes } from 'src/protocols/protocols';
import { WinOperationService } from '../migrate/command-execution/win-opeartions/win-operation.service';
import { isDirectoryLevelMigration } from 'src/activities/utils/utils';

jest.mock('src/activities/utils/utils', () => ({
    ...jest.requireActual('src/activities/utils/utils'),
    isDirectoryLevelMigration: jest.fn().mockReturnValue(false),
}));

describe('SetupExportsPathPermissionService', () => {
  let service: SetupExportsPathPermissionService;
  let mockLoggerFactory: jest.Mocked<LoggerFactory>;
  let mockWinOperationService: jest.Mocked<WinOperationService>;
  let mockRedisService: jest.Mocked<RedisService>;
  let mockLogger: any;

  const makeSourceAcl = (overrides: Record<string, any> = {}): SecurityDescriptor => ({
    Owner: 'S-1-5-21-111-222-333-1001',
    Group: 'S-1-5-21-111-222-333-513',
    DaclAces: [
      { Sid: 'S-1-5-21-111-222-333-1001', AccessMask: 2032127, AceType: 0, AceFlags: 3, IsInherited: false, originalSid: undefined as any },
    ],
    Attributes: 'Directory',
    DaclPresent: true,
    DaclProtected: false,
    DaclAutoInherit: true,
    originalOwner: undefined as any,
    originalGroup: undefined as any,
    ...overrides,
  });

  beforeEach(async () => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    } as any;

    mockWinOperationService = {
      getAclOperation: jest.fn(),
      setAclOperation: jest.fn(),
      mapSIDToTarget: jest.fn(),
      validateAclOperation: jest.fn(),
    } as any;

    mockRedisService = {
      getJobManagerContext: jest.fn(),
      getOwnerIdentity: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupExportsPathPermissionService,
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: WinOperationService, useValue: mockWinOperationService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<SetupExportsPathPermissionService>(SetupExportsPathPermissionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setupExportPathPermission', () => {
    it('should return early if destination is not SMB protocol', async () => {
      const jobRunId = 'test-job-run-id';
      const jobContext = {
        jobConfig: {
          destinationFileServer: {
            protocols: [{ type: ProtocolTypes.NFS }]
          }
        }
      } as any;

      mockRedisService.getJobManagerContext.mockResolvedValue(jobContext);

      await service.setupExportPathPermission(jobRunId);

      expect(mockLogger.debug).toHaveBeenCalledWith(`Identity mapping not available for jobRunId: ${jobRunId}`);
    });

    it('should return early if preservePermissions is false', async () => {
      const jobRunId = 'test-job-run-id';
      const jobContext = {
        jobConfig: {
          destinationFileServer: {
            protocols: [{ type: ProtocolTypes.SMB }],
            hostname: 'test-host',
            path: 'test-path'
          },
          sourceFileServer: {
            hostname: 'source-host',
            path: 'source-path'
          },
          options: { preservePermissions: false }
        }
      } as any;

      mockRedisService.getJobManagerContext.mockResolvedValue(jobContext);

      await service.setupExportPathPermission(jobRunId);

      expect(mockLogger.debug).toHaveBeenCalledWith(`Skipping ACL setup for jobRunId: ${jobRunId} - preservePermissions is disabled`);
      expect(mockWinOperationService.getAclOperation).not.toHaveBeenCalled();
    });

    it('should proceed with setup for SMB protocol when preservePermissions is true', async () => {
      const jobRunId = 'test-job-run-id';
      const sourceAcl = makeSourceAcl();
      const jobContext = {
        jobConfig: {
          destinationFileServer: {
            protocols: [{ type: ProtocolTypes.SMB }],
            hostname: 'dest-host',
            path: 'dest-path'
          },
          sourceFileServer: {
            hostname: 'source-host',
            path: 'source-path'
          },
          options: { preservePermissions: true }
        }
      } as any;

      mockRedisService.getJobManagerContext.mockResolvedValue(jobContext);
      mockWinOperationService.getAclOperation
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(sourceAcl);
      mockWinOperationService.setAclOperation.mockResolvedValue({ stdout: '{"success":true}' });
      mockWinOperationService.validateAclOperation.mockResolvedValue({ sourceSID: '', targetSID: '', inValid: '' });

      await service.setupExportPathPermission(jobRunId);

      expect(mockLogger.log).toHaveBeenCalledWith(`Starting ACL setup for jobRunId: ${jobRunId}`);
      expect(mockWinOperationService.getAclOperation).toHaveBeenCalledTimes(2);
    });

    it('should publish errors from setup() to UI streams instead of throwing', async () => {
      const jobRunId = 'test-job-run-id';
      const jobContext = {
        jobConfig: {
          destinationFileServer: {
            protocols: [{ type: ProtocolTypes.SMB }],
            hostname: 'dest-host',
            path: 'dest-path',
            pathId: 'dest-path-id',
          },
          sourceFileServer: {
            hostname: 'source-host',
            path: 'source-path',
            pathId: 'source-path-id',
          },
          workerIds: ['worker-uuid-1'],
          options: { preservePermissions: true }
        },
        publishToTaskStream: jest.fn().mockResolvedValue(undefined),
        publishToErrorStream: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockRedisService.getJobManagerContext.mockResolvedValue(jobContext);
      const setupError = new Error('Unexpected runtime error');
      jest.spyOn(service, 'setup').mockRejectedValue(setupError);

      await service.setupExportPathPermission(jobRunId);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `ACL setup failed for jobRunId: ${jobRunId}: Unexpected runtime error`,
        expect.anything()
      );
      expect(jobContext.publishToTaskStream).toHaveBeenCalled();
      expect(jobContext.publishToErrorStream).toHaveBeenCalled();
    });

    it('should skip ACL setup for DLM jobs', async () => {
      const jobRunId = 'test-job-run-id';
      const jobContext = {
        jobConfig: {
          destinationFileServer: {
            protocols: [{ type: ProtocolTypes.SMB }],
            hostname: 'test-host',
            path: 'test-path'
          },
          sourceFileServer: {
            hostname: 'source-host',
            path: 'source-path'
          },
          sourceDirectoryPath: '/src',
          options: { preservePermissions: true }
        }
      } as any;

      mockRedisService.getJobManagerContext.mockResolvedValue(jobContext);
      (isDirectoryLevelMigration as jest.Mock).mockReturnValue(true);

      await service.setupExportPathPermission(jobRunId);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Skipping share-level ACL setup for jobRunId: ${jobRunId} - DLM job; ACLs stamped per directory by worker`
      );
      expect(mockLogger.log).not.toHaveBeenCalled();

      (isDirectoryLevelMigration as jest.Mock).mockReturnValue(false);
    });
  });

  describe('setup', () => {
    it('should throw error for invalid context', async () => {
      await expect(service.setup('test-id', {})).rejects.toThrow('Invalid context: missing file server configuration');
    });

    it('should read source ACL, stamp it on destination, and validate', async () => {
      const jobRunId = 'test-job-run-id';
      const sourceAcl = makeSourceAcl();
      const context = {
        jobConfig: {
          destinationFileServer: { hostname: 'dest-host', path: 'dest-path' },
          sourceFileServer: { hostname: 'source-host', path: 'source-path' },
        }
      };

      mockWinOperationService.getAclOperation
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(sourceAcl);
      mockWinOperationService.setAclOperation.mockResolvedValue({ stdout: '{"success":true}' });
      mockWinOperationService.validateAclOperation.mockResolvedValue({ sourceSID: '', targetSID: '', inValid: '' });

      await service.setup(jobRunId, context);

      expect(mockWinOperationService.getAclOperation).toHaveBeenNthCalledWith(
        1, '\\\\source-host/source-path', true, jobRunId
      );
      expect(mockWinOperationService.setAclOperation).toHaveBeenCalledWith(
        '\\\\dest-host/dest-path', sourceAcl, jobRunId
      );
      expect(mockWinOperationService.getAclOperation).toHaveBeenNthCalledWith(
        2, '\\\\dest-host/dest-path', false, jobRunId
      );
      expect(mockWinOperationService.validateAclOperation).toHaveBeenCalledWith(
        sourceAcl, sourceAcl, expect.objectContaining({ workflowId: jobRunId })
      );
    });

    it('should apply SID mapping when isIdentityMappingAvailable is true', async () => {
      const jobRunId = 'test-job-run-id';
      const sourceAcl = makeSourceAcl();
      const mappedAcl = makeSourceAcl({
        Owner: 'S-1-5-21-999-888-777-2001',
        originalOwner: sourceAcl.Owner,
      });
      const context = {
        jobConfig: {
          destinationFileServer: { hostname: 'dest-host', path: 'dest-path' },
          sourceFileServer: { hostname: 'source-host', path: 'source-path' },
          options: { isIdentityMappingAvailable: true },
        }
      };

      mockWinOperationService.getAclOperation
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(mappedAcl);
      mockWinOperationService.mapSIDToTarget.mockResolvedValue(mappedAcl);
      mockWinOperationService.setAclOperation.mockResolvedValue({ stdout: '{"success":true}' });
      mockWinOperationService.validateAclOperation.mockResolvedValue({ sourceSID: '', targetSID: '', inValid: '' });

      await service.setup(jobRunId, context);

      expect(mockWinOperationService.mapSIDToTarget).toHaveBeenCalledWith(sourceAcl, jobRunId);
      expect(mockWinOperationService.setAclOperation).toHaveBeenCalledWith(
        '\\\\dest-host/dest-path', mappedAcl, jobRunId
      );
    });

    it('should not apply SID mapping when isIdentityMappingAvailable is falsy', async () => {
      const jobRunId = 'test-job-run-id';
      const sourceAcl = makeSourceAcl();
      const context = {
        jobConfig: {
          destinationFileServer: { hostname: 'dest-host', path: 'dest-path' },
          sourceFileServer: { hostname: 'source-host', path: 'source-path' },
          options: {},
        }
      };

      mockWinOperationService.getAclOperation
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(sourceAcl);
      mockWinOperationService.setAclOperation.mockResolvedValue({ stdout: '{"success":true}' });
      mockWinOperationService.validateAclOperation.mockResolvedValue({ sourceSID: '', targetSID: '', inValid: '' });

      await service.setup(jobRunId, context);

      expect(mockWinOperationService.mapSIDToTarget).not.toHaveBeenCalled();
    });

    it('should throw when source ACL read fails', async () => {
      const jobRunId = 'test-job-run-id';
      const context = {
        jobConfig: {
          destinationFileServer: { hostname: 'dest-host', path: 'dest-path' },
          sourceFileServer: { hostname: 'source-host', path: 'source-path' },
        }
      };

      mockWinOperationService.getAclOperation.mockRejectedValue(new Error('Access denied'));

      await expect(service.setup(jobRunId, context)).rejects.toThrow('Access denied');
      expect(mockWinOperationService.setAclOperation).not.toHaveBeenCalled();
    });

    it('should throw when destination ACL set fails', async () => {
      const jobRunId = 'test-job-run-id';
      const sourceAcl = makeSourceAcl();
      const context = {
        jobConfig: {
          destinationFileServer: { hostname: 'dest-host', path: 'dest-path' },
          sourceFileServer: { hostname: 'source-host', path: 'source-path' },
        }
      };

      mockWinOperationService.getAclOperation.mockResolvedValueOnce(sourceAcl);
      mockWinOperationService.setAclOperation.mockRejectedValue(new Error('SetNamedSecurityInfo failed'));

      await expect(service.setup(jobRunId, context)).rejects.toThrow('SetNamedSecurityInfo failed');
    });

    it('should throw when destination ACL read-back fails', async () => {
      const jobRunId = 'test-job-run-id';
      const sourceAcl = makeSourceAcl();
      const context = {
        jobConfig: {
          destinationFileServer: { hostname: 'dest-host', path: 'dest-path' },
          sourceFileServer: { hostname: 'source-host', path: 'source-path' },
        }
      };

      mockWinOperationService.getAclOperation
        .mockResolvedValueOnce(sourceAcl)
        .mockRejectedValueOnce(new Error('Read-back failed'));
      mockWinOperationService.setAclOperation.mockResolvedValue({ stdout: '{"success":true}' });

      await expect(service.setup(jobRunId, context)).rejects.toThrow('Read-back failed');
      expect(mockWinOperationService.validateAclOperation).not.toHaveBeenCalled();
    });

    it('should throw when post-stamp validation finds mismatches', async () => {
      const jobRunId = 'test-job-run-id';
      const sourceAcl = makeSourceAcl();
      const destAcl = makeSourceAcl({ Owner: 'S-1-5-21-different' });
      const context = {
        jobConfig: {
          destinationFileServer: { hostname: 'dest-host', path: 'dest-path', pathId: 'dest-path-id' },
          sourceFileServer: { hostname: 'source-host', path: 'source-path', pathId: 'source-path-id' },
          workerIds: ['worker-uuid-1'],
          jobRunId,
        },
      };

      mockWinOperationService.getAclOperation
        .mockResolvedValueOnce(sourceAcl)
        .mockResolvedValueOnce(destAcl);
      mockWinOperationService.setAclOperation.mockResolvedValue({ stdout: '{"success":true}' });
      mockWinOperationService.validateAclOperation.mockResolvedValue({
        sourceSID: '',
        targetSID: '',
        inValid: 'Owner mismatch: Expected(S-1-5-21-111-222-333-1001) Target(S-1-5-21-different). ',
      });

      await expect(service.setup(jobRunId, context)).rejects.toThrow('Share root ACL validation mismatch');
    });
  });
});
