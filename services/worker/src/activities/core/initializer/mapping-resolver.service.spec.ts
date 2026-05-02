import { Test, TestingModule } from '@nestjs/testing';
import { MappingResolverService } from './mapping-resolver.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { RedisService } from '../../../redis/redis.service';
import { WinOperationService } from '../migrate/command-execution/win-opeartions/win-operation.service';
import { JobManagerContext } from '@netapp-cloud-datamigrate/jobs-lib';
import { ProtocolTypes } from '../../../protocols/protocols';

describe('MappingResolverService', () => {
  let service: MappingResolverService;
  let loggerFactory: jest.Mocked<LoggerFactory>;
  let logger: jest.Mocked<LoggerService>;
  let redisService: jest.Mocked<RedisService>;
  let winOperationService: jest.Mocked<WinOperationService>;

  const mockJobRunId = 'test-job-run-id';

  beforeEach(async () => {
    // Mock logger
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    } as any;

    loggerFactory = {
      create: jest.fn().mockReturnValue(logger),
    } as any;

    // Mock RedisService
    redisService = {
      getJobManagerContext: jest.fn(),
      getMappingKeys: jest.fn(),
      getOwnerIdentity: jest.fn(),
      setOwnerIdentity: jest.fn(),
    } as any;

    // Mock WinOperationService
    winOperationService = {
      resolveUsernamesToSids: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MappingResolverService,
        { provide: LoggerFactory, useValue: loggerFactory },
        { provide: RedisService, useValue: redisService },
        { provide: WinOperationService, useValue: winOperationService },
      ],
    }).compile();

    service = module.get<MappingResolverService>(MappingResolverService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create logger with correct service name', () => {
      expect(loggerFactory.create).toHaveBeenCalledWith(
        'MappingResolverService',
      );
    });

    it('should handle null logger factory gracefully', () => {
      const nullLoggerFactory = null as any;
      const nullRedisService = null as any;
      const nullWinOperationService = null as any;

      expect(() => {
        new MappingResolverService(
          nullLoggerFactory,
          nullRedisService,
          nullWinOperationService,
        );
      }).toThrow();
    });

    it('should handle undefined dependencies', () => {
      const undefinedLoggerFactory = undefined as any;
      const undefinedRedisService = undefined as any;
      const undefinedWinOperationService = undefined as any;

      expect(() => {
        new MappingResolverService(
          undefinedLoggerFactory,
          undefinedRedisService,
          undefinedWinOperationService,
        );
      }).toThrow();
    });
  });

  describe('resolveUsernamesToSids', () => {
    const createMockJobContext = (
      protocolType: string = ProtocolTypes.SMB,
      isIdentityMappingAvailable: boolean = true,
    ): JobManagerContext =>
      ({
        jobConfig: {
          destinationFileServer: {
            protocols: [{ type: protocolType }],
          },
          options: {
            isIdentityMappingAvailable,
          },
        },
      }) as any;

    describe('when identity mapping is not available', () => {
      it('should return early and log debug message when protocol is not SMB', async () => {
        const jobContext = createMockJobContext(ProtocolTypes.NFS, true);
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });

      it('should return early when isIdentityMappingAvailable is false', async () => {
        const jobContext = createMockJobContext(ProtocolTypes.SMB, false);
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });

      it('should return early when jobConfig is null', async () => {
        const jobContext = { jobConfig: null } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });

      it('should return early when destinationFileServer is null', async () => {
        const jobContext = {
          jobConfig: {
            destinationFileServer: null,
            options: { isIdentityMappingAvailable: true },
          },
        } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });

      it('should return early when protocols array is empty', async () => {
        const jobContext = {
          jobConfig: {
            destinationFileServer: { protocols: [] },
            options: { isIdentityMappingAvailable: true },
          },
        } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });

      it('should return early when protocol type does not include SMB', async () => {
        const jobContext = {
          jobConfig: {
            destinationFileServer: { protocols: [{ type: 'NFS_ONLY' }] },
            options: { isIdentityMappingAvailable: true },
          },
        } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });

      it('should proceed when protocol type includes SMB in compound string', async () => {
        const jobContext = {
          jobConfig: {
            destinationFileServer: { protocols: [{ type: 'SMB_V2' }] },
            options: { isIdentityMappingAvailable: true },
          },
        } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);
        redisService.getMappingKeys.mockResolvedValue([]);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).not.toHaveBeenCalled();
        expect(redisService.getMappingKeys).toHaveBeenCalledWith(
          mockJobRunId,
          'SID',
        );
      });

      it('should proceed when exact SMB protocol with identity mapping enabled', async () => {
        // This ensures we test the successful branch of both conditions
        const jobContext = {
          jobConfig: {
            destinationFileServer: { protocols: [{ type: ProtocolTypes.SMB }] },
            options: { isIdentityMappingAvailable: true },
          },
        } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);
        redisService.getMappingKeys.mockResolvedValue([]);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).not.toHaveBeenCalled();
        expect(redisService.getMappingKeys).toHaveBeenCalledWith(
          mockJobRunId,
          'SID',
        );
      });

      it('should return early when protocol type is empty string', async () => {
        const jobContext = {
          jobConfig: {
            destinationFileServer: { protocols: [{ type: '' }] },
            options: { isIdentityMappingAvailable: true },
          },
        } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });

      it('should return early when isIdentityMappingAvailable is false even with SMB protocol', async () => {
        // This tests the second part of the OR condition specifically
        const jobContext = {
          jobConfig: {
            destinationFileServer: { protocols: [{ type: ProtocolTypes.SMB }] },
            options: { isIdentityMappingAvailable: false },
          },
        } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });

      it('should return early when protocol is not SMB even with identity mapping enabled', async () => {
        // This tests the first part of the OR condition specifically
        const jobContext = {
          jobConfig: {
            destinationFileServer: { protocols: [{ type: ProtocolTypes.NFS }] },
            options: { isIdentityMappingAvailable: true },
          },
        } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });

      it('should return early when protocols[0] is undefined', async () => {
        const jobContext = {
          jobConfig: {
            destinationFileServer: { protocols: [undefined] },
            options: { isIdentityMappingAvailable: true },
          },
        } as any;
        redisService.getJobManagerContext.mockResolvedValue(jobContext);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(logger.debug).toHaveBeenCalledWith(
          `Identity mapping not available for jobRunId: ${mockJobRunId}`,
        );
        expect(redisService.getMappingKeys).not.toHaveBeenCalled();
      });
    });

    describe('when identity mapping is available', () => {
      beforeEach(() => {
        const jobContext = createMockJobContext();
        redisService.getJobManagerContext.mockResolvedValue(jobContext);
      });

      it('should process empty SID list', async () => {
        redisService.getMappingKeys.mockResolvedValue([]);

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(redisService.getMappingKeys).toHaveBeenCalledWith(
          mockJobRunId,
          'SID',
        );
        expect(redisService.getOwnerIdentity).not.toHaveBeenCalled();
        expect(
          winOperationService.resolveUsernamesToSids,
        ).not.toHaveBeenCalled();
      });

      it('should process single batch with all resolved SIDs', async () => {
        const sourceSIDs = ['S-1-5-21-123456789-1', 'S-1-5-21-123456789-2'];
        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity
          .mockResolvedValueOnce('S-1-5-21-987654321-1')
          .mockResolvedValueOnce('S-1-5-21-987654321-2');

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(redisService.getMappingKeys).toHaveBeenCalledWith(
          mockJobRunId,
          'SID',
        );
        expect(redisService.getOwnerIdentity).toHaveBeenCalledTimes(2);
        expect(redisService.getOwnerIdentity).toHaveBeenCalledWith(
          mockJobRunId,
          sourceSIDs[0],
          'SID',
        );
        expect(redisService.getOwnerIdentity).toHaveBeenCalledWith(
          mockJobRunId,
          sourceSIDs[1],
          'SID',
        );
        expect(
          winOperationService.resolveUsernamesToSids,
        ).not.toHaveBeenCalled();
      });

      it('should resolve usernames to SIDs when source is username', async () => {
        const sourceSIDs = ['testuser1'];
        const resolvedSidMap = new Map([['testuser1', 'S-1-5-21-resolved-1']]);

        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockResolvedValue('S-1-5-21-target-1');
        winOperationService.resolveUsernamesToSids.mockResolvedValue(
          resolvedSidMap,
        );

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(winOperationService.resolveUsernamesToSids).toHaveBeenCalledWith(
          ['testuser1'],
        );
        expect(redisService.setOwnerIdentity).toHaveBeenCalledWith(
          mockJobRunId,
          'S-1-5-21-resolved-1',
          'SID',
          'S-1-5-21-target-1',
        );
      });

      it('should resolve usernames to SIDs when destination is username', async () => {
        const sourceSIDs = ['S-1-5-21-source-1'];
        const resolvedSidMap = new Map([['testuser2', 'S-1-5-21-resolved-2']]);

        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockResolvedValue('testuser2');
        winOperationService.resolveUsernamesToSids.mockResolvedValue(
          resolvedSidMap,
        );

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(winOperationService.resolveUsernamesToSids).toHaveBeenCalledWith(
          ['testuser2'],
        );
        expect(redisService.setOwnerIdentity).toHaveBeenCalledWith(
          mockJobRunId,
          'S-1-5-21-source-1',
          'SID',
          'S-1-5-21-resolved-2',
        );
      });

      it('should resolve both source and destination when both are usernames', async () => {
        const sourceSIDs = ['testuser1'];
        const resolvedSidMap = new Map([
          ['testuser1', 'S-1-5-21-resolved-1'],
          ['testuser2', 'S-1-5-21-resolved-2'],
        ]);

        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockResolvedValue('testuser2');
        winOperationService.resolveUsernamesToSids.mockResolvedValue(
          resolvedSidMap,
        );

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(winOperationService.resolveUsernamesToSids).toHaveBeenCalledWith(
          ['testuser1', 'testuser2'],
        );
        expect(redisService.setOwnerIdentity).toHaveBeenCalledWith(
          mockJobRunId,
          'S-1-5-21-resolved-1',
          'SID',
          'S-1-5-21-resolved-2',
        );
      });

      it('should handle multiple batches (>50 SIDs)', async () => {
        // Create 75 SIDs to test batching (50 + 25)
        const sourceSIDs = Array.from(
          { length: 75 },
          (_, i) => `testuser${i + 1}`,
        );
        const resolvedSidMap = new Map(
          sourceSIDs.map((username, i) => [
            username,
            `S-1-5-21-resolved-${i + 1}`,
          ]),
        );

        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockImplementation((_, sid) =>
          Promise.resolve(`S-1-5-21-target-${sid.replace('testuser', '')}`),
        );
        winOperationService.resolveUsernamesToSids.mockResolvedValue(
          resolvedSidMap,
        );

        await service.resolveUsernamesToSids(mockJobRunId);

        // Should be called twice - once for first 50, once for remaining 25
        expect(
          winOperationService.resolveUsernamesToSids,
        ).toHaveBeenCalledTimes(2);
        expect(redisService.setOwnerIdentity).toHaveBeenCalledTimes(75);
      });

      it('should skip batch when no unresolved SIDs', async () => {
        const sourceSIDs = ['S-1-5-21-123456789-1', 'S-1-5-21-123456789-2'];
        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity
          .mockResolvedValueOnce('S-1-5-21-987654321-1')
          .mockResolvedValueOnce('S-1-5-21-987654321-2');

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(
          winOperationService.resolveUsernamesToSids,
        ).not.toHaveBeenCalled();
        expect(redisService.setOwnerIdentity).not.toHaveBeenCalled();
      });

      it('should handle mixed SIDs and usernames in same batch', async () => {
        const sourceSIDs = [
          'S-1-5-21-source-1',
          'testuser2',
          'S-1-5-21-source-3',
        ];
        const resolvedSidMap = new Map([
          ['testuser2', 'S-1-5-21-resolved-2'],
          ['testuser4', 'S-1-5-21-resolved-4'],
        ]);

        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity
          .mockResolvedValueOnce('S-1-5-21-target-1') // for S-1-5-21-source-1
          .mockResolvedValueOnce('testuser4') // for testuser2
          .mockResolvedValueOnce('S-1-5-21-target-3'); // for S-1-5-21-source-3
        winOperationService.resolveUsernamesToSids.mockResolvedValue(
          resolvedSidMap,
        );

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(winOperationService.resolveUsernamesToSids).toHaveBeenCalledWith(
          ['testuser2', 'testuser4'],
        );
        expect(redisService.setOwnerIdentity).toHaveBeenCalledTimes(1);
        expect(redisService.setOwnerIdentity).toHaveBeenCalledWith(
          mockJobRunId,
          'S-1-5-21-resolved-2',
          'SID',
          'S-1-5-21-resolved-4',
        );
      });

      it('should skip setOwnerIdentity when resolved SID map is empty (both usernames unresolvable)', async () => {
        const sourceSIDs = ['testuser1'];
        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockResolvedValue('testuser2');
        winOperationService.resolveUsernamesToSids.mockResolvedValue(new Map());

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(winOperationService.resolveUsernamesToSids).toHaveBeenCalledWith(
          ['testuser1', 'testuser2'],
        );
        // Both usernames unresolvable → sourceSid and targetSid are undefined → skip guard fires
        expect(redisService.setOwnerIdentity).not.toHaveBeenCalled();
      });

      it('should skip setOwnerIdentity when target username cannot be resolved', async () => {
        const sourceSIDs = ['testuser1'];
        const resolvedSidMap = new Map([['testuser1', 'S-1-5-21-resolved-1']]);

        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockResolvedValue('testuser2'); // not in resolved map
        winOperationService.resolveUsernamesToSids.mockResolvedValue(
          resolvedSidMap,
        );

        await service.resolveUsernamesToSids(mockJobRunId);

        // testuser2 not in resolvedSidMap → targetSid is undefined → skip guard fires
        expect(redisService.setOwnerIdentity).not.toHaveBeenCalled();
      });

      it('should handle case where source is SID but destination is username', async () => {
        const sourceSIDs = ['S-1-5-21-source-1'];
        const resolvedSidMap = new Map([
          ['targetuser', 'S-1-5-21-resolved-target'],
        ]);

        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockResolvedValue('targetuser'); // username destination
        winOperationService.resolveUsernamesToSids.mockResolvedValue(
          resolvedSidMap,
        );

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(winOperationService.resolveUsernamesToSids).toHaveBeenCalledWith(
          ['targetuser'],
        );
        expect(redisService.setOwnerIdentity).toHaveBeenCalledWith(
          mockJobRunId,
          'S-1-5-21-source-1', // source already a SID
          'SID',
          'S-1-5-21-resolved-target', // destination resolved from username
        );
      });

      it('should handle case where both source and destination are SIDs (no resolution needed)', async () => {
        const sourceSIDs = ['S-1-5-21-source-1'];

        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockResolvedValue('S-1-5-21-target-1'); // SID destination
        winOperationService.resolveUsernamesToSids.mockResolvedValue(new Map());

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(
          winOperationService.resolveUsernamesToSids,
        ).not.toHaveBeenCalled();
        expect(redisService.setOwnerIdentity).not.toHaveBeenCalled();
      });

      it.each([
        ['undefined', undefined],
        ['null', null],
        ['empty string', ''],
      ])(
        'should skip SIDs whose Redis mapping value is %s and not crash',
        async (_label, missingValue) => {
          const sourceSIDs = ['S-1-5-21-source-1', 'S-1-5-21-source-2'];

          redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
          redisService.getOwnerIdentity
            .mockResolvedValueOnce('S-1-5-21-target-1')
            .mockResolvedValueOnce(missingValue as any);

          await expect(
            service.resolveUsernamesToSids(mockJobRunId),
          ).resolves.not.toThrow();

          expect(logger.warn).toHaveBeenCalledWith(
            `No mapping value found for SID S-1-5-21-source-2 in jobRunId ${mockJobRunId}, skipping`,
          );
          expect(
            winOperationService.resolveUsernamesToSids,
          ).not.toHaveBeenCalled();
          expect(redisService.setOwnerIdentity).not.toHaveBeenCalled();
        },
      );

      it('should still resolve usernames in the same batch when some SIDs have undefined values', async () => {
        const sourceSIDs = ['testuser1', 'S-1-5-21-orphan'];
        const resolvedSidMap = new Map([['testuser1', 'S-1-5-21-resolved-1']]);

        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity
          .mockResolvedValueOnce('S-1-5-21-target-1')
          .mockResolvedValueOnce(undefined as any);
        winOperationService.resolveUsernamesToSids.mockResolvedValue(
          resolvedSidMap,
        );

        await service.resolveUsernamesToSids(mockJobRunId);

        expect(winOperationService.resolveUsernamesToSids).toHaveBeenCalledWith(
          ['testuser1'],
        );
        expect(redisService.setOwnerIdentity).toHaveBeenCalledTimes(1);
        expect(redisService.setOwnerIdentity).toHaveBeenCalledWith(
          mockJobRunId,
          'S-1-5-21-resolved-1',
          'SID',
          'S-1-5-21-target-1',
        );
      });
    });

    describe('error handling', () => {
      it('should handle Redis errors gracefully', async () => {
        const jobContext = createMockJobContext();
        redisService.getJobManagerContext.mockResolvedValue(jobContext);
        redisService.getMappingKeys.mockRejectedValue(
          new Error('Redis connection failed'),
        );

        await expect(
          service.resolveUsernamesToSids(mockJobRunId),
        ).rejects.toThrow('Redis connection failed');
      });

      it('should handle WinOperationService errors gracefully', async () => {
        const sourceSIDs = ['testuser1'];
        const jobContext = createMockJobContext();

        redisService.getJobManagerContext.mockResolvedValue(jobContext);
        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockResolvedValue('testuser2');
        winOperationService.resolveUsernamesToSids.mockRejectedValue(
          new Error('PowerShell execution failed'),
        );

        await expect(
          service.resolveUsernamesToSids(mockJobRunId),
        ).rejects.toThrow('PowerShell execution failed');
      });

      it('should handle getOwnerIdentity errors gracefully', async () => {
        const sourceSIDs = ['testuser1'];
        const jobContext = createMockJobContext();

        redisService.getJobManagerContext.mockResolvedValue(jobContext);
        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockRejectedValue(
          new Error('Failed to get owner identity'),
        );

        await expect(
          service.resolveUsernamesToSids(mockJobRunId),
        ).rejects.toThrow('Failed to get owner identity');
      });

      it('should propagate setOwnerIdentity errors when both SIDs resolve successfully', async () => {
        const sourceSIDs = ['testuser1'];
        // Both source and target resolve → guard passes → setOwnerIdentity called → error thrown
        const resolvedSidMap = new Map([
          ['testuser1', 'S-1-5-21-resolved-1'],
          ['testuser2', 'S-1-5-21-resolved-2'],
        ]);
        const jobContext = createMockJobContext();

        redisService.getJobManagerContext.mockResolvedValue(jobContext);
        redisService.getMappingKeys.mockResolvedValue(sourceSIDs);
        redisService.getOwnerIdentity.mockResolvedValue('testuser2');
        winOperationService.resolveUsernamesToSids.mockResolvedValue(
          resolvedSidMap,
        );
        redisService.setOwnerIdentity.mockRejectedValue(
          new Error('Failed to set owner identity'),
        );

        await expect(
          service.resolveUsernamesToSids(mockJobRunId),
        ).rejects.toThrow('Failed to set owner identity');
      });
    });
  });
});
