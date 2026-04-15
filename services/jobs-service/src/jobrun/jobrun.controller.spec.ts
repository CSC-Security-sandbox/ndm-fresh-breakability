import { Test, TestingModule } from '@nestjs/testing';
import { JobRunController } from './jobrun.controller';
import { JobRunService } from './jobrun.service';
import { JobRunInitService } from './jobrun.init.service';
import { JobRunActionService } from './jobrun-action.service';
import { JobRunPageDto } from './dto/jobrunpage.dto';
import { JobErrorQueryDto } from './dto/jobRunErrors.dto';
import { JobRunActionsReq, ApprovalRequestDTO } from './dto/jobrunactions.dto';
import { AdHocRunDTO } from './dto/adhockjobrun.dto';
import { CutOverStatus, JobRunStatus } from 'src/constants/enums';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

describe('JobRunController', () => {
  let controller: JobRunController;
  let jobRunService: jest.Mocked<JobRunService>;
  let jobRunInitService: jest.Mocked<JobRunInitService>;
  let jobRunActionService: jest.Mocked<JobRunActionService>;
  let mockLogger: LoggerService;

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ["permission1", "permission2"],
            projects: ["project1"],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  beforeEach(async () => {
    // Create mock logger
    mockLogger = {
      error: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Create mock LoggerFactory
    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobRunController],
      providers: [
        {
          provide: JobRunService,
          useValue: {
            getJobAllRuns: jest.fn(),
            getJobRunErrors: jest.fn(),
            getFailedOperations: jest.fn(),
            getJobRun: jest.fn(),
            approveCutoverRequest: jest.fn(),
            addHocRun: jest.fn(),
            updateJobRunStatus: jest.fn(),
            addExcludedSkippedEntries: jest.fn(),
            cutOverApproval: jest.fn(),
            getErrorOverview: jest.fn(),
            checkWorkerHealth: jest.fn(),
            updateWorkerResponse: jest.fn(),
            getJobRunIdentityMappings: jest.fn(),
            getInProcessFiles: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: JobRunInitService,
          useValue: {
            scheduleAJob: jest.fn(),
          },
        },
        {
          provide: JobRunActionService,
          useValue: {
            actions: jest.fn(),
          },
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    controller = module.get<JobRunController>(JobRunController);
    jobRunService = module.get(JobRunService);
    jobRunInitService = module.get(JobRunInitService);
    jobRunActionService = module.get(JobRunActionService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getJobRuns', () => {
    it('should return paginated job runs', async () => {
      const dto: JobRunPageDto = {} as any;
      const result = { items: [], total: 0 };
      jobRunService.getJobAllRuns.mockResolvedValue(result as any);
      expect(await controller.getJobRuns(dto)).toBe(result);
      expect(jobRunService.getJobAllRuns).toHaveBeenCalledWith(dto);
    });
  });

  describe('getJobRunErrors', () => {
    it('should return job run errors', async () => {
      const dto: JobErrorQueryDto = {} as any;
      const result = [{ error: 'err' }];
      jobRunService.getJobRunErrors.mockResolvedValue(result as any);
      expect(await controller.getJobRunErrors(dto)).toBe(result);
      expect(jobRunService.getJobRunErrors).toHaveBeenCalledWith(dto);
    });
  });

  describe('getFailedOperations', () => {
    it('should get failed operations with default limit and no cursor', async () => {
      const jobRunId = 'run1';
      const result = { data: [], nextCursor: null };
      jobRunService.getFailedOperations.mockResolvedValue(result);
      
      expect(await controller.getFailedOperations(jobRunId)).toBe(result);
      expect(jobRunService.getFailedOperations).toHaveBeenCalledWith(
        jobRunId,
        null,
        1000
      );
    });

    it('should get failed operations with cursor provided', async () => {
      const jobRunId = 'run1';
      const cursor = 'cursor123';
      const result = { data: [], nextCursor: null };
      jobRunService.getFailedOperations.mockResolvedValue(result);
      
      expect(await controller.getFailedOperations(jobRunId, cursor)).toBe(result);
      expect(jobRunService.getFailedOperations).toHaveBeenCalledWith(
        jobRunId,
        cursor,
        1000
      );
    });

    it('should get failed operations with custom limit', async () => {
      const jobRunId = 'run1';
      const cursor = undefined;
      const limit = '500';
      const result = { data: [], nextCursor: null };
      jobRunService.getFailedOperations.mockResolvedValue(result);
      
      expect(await controller.getFailedOperations(jobRunId, cursor, limit)).toBe(result);
      expect(jobRunService.getFailedOperations).toHaveBeenCalledWith(
        jobRunId,
        null,
        500
      );
    });

    it('should get failed operations with both cursor and custom limit', async () => {
      const jobRunId = 'run1';
      const cursor = 'cursor456';
      const limit = '250';
      const result = { data: [{ id: '1' }], nextCursor: 'next123' };
      jobRunService.getFailedOperations.mockResolvedValue(result);
      
      expect(await controller.getFailedOperations(jobRunId, cursor, limit)).toBe(result);
      expect(jobRunService.getFailedOperations).toHaveBeenCalledWith(
        jobRunId,
        cursor,
        250
      );
    });

    it('should treat empty cursor as null', async () => {
      const jobRunId = 'run1';
      const result = { data: [], nextCursor: null };
      jobRunService.getFailedOperations.mockResolvedValue(result);

      expect(await controller.getFailedOperations(jobRunId, '', '100')).toBe(result);
      expect(jobRunService.getFailedOperations).toHaveBeenCalledWith(
        jobRunId,
        null,
        100
      );
    });
  });

  describe('getJobById', () => {
    it('should return job run by id', async () => {
      const id = '123';
      const result = { id } as any;
      jobRunService.getJobRun.mockResolvedValue(result);
      expect(await controller.getJobById(id)).toBe(result);
      expect(jobRunService.getJobRun).toHaveBeenCalledWith(id);
    });
  });

  describe('actions', () => {
    it('should call jobRunActionService.actions', async () => {
      const req: JobRunActionsReq = {} as any;
      const result = { status: 'ok' };
      jobRunActionService.actions.mockResolvedValue(result as any);
      expect(await controller.actions(req)).toBe(result);
      expect(jobRunActionService.actions).toHaveBeenCalledWith(req, undefined);
    });
  });

  describe('cutoverApprove', () => {
    it('should approve cutover request', async () => {
      const approval: ApprovalRequestDTO = {} as any;
      const result = { approved: true };
      jobRunService.approveCutoverRequest.mockResolvedValue(result as any);
      expect(await controller.cutoverApprove(approval)).toBe(result);
      expect(jobRunService.approveCutoverRequest).toHaveBeenCalledWith(approval);
      expect(mockLogger.log).toHaveBeenCalledWith(JSON.stringify(approval));
    });
  });

  describe('adhocRun', () => {
    it('should create ad hoc run', async () => {
      const adhoc: AdHocRunDTO = { jobConfigId: 'cfg1' } as any;
      const result = { runId: 'run1' };
      jobRunService.addHocRun.mockResolvedValue(result as any);
      expect(await controller.adhocRun(adhoc)).toBe(result);
      expect(jobRunService.addHocRun).toHaveBeenCalledWith('cfg1', undefined, undefined);
    });

    it('should create ad hoc run with jobRunId for retry', async () => {
      const adhoc: AdHocRunDTO = { jobConfigId: 'cfg1', jobRunId: 'run1' };
      const result = { runId: 'run2' };
      jobRunService.addHocRun.mockResolvedValue(result as any);
      expect(await controller.adhocRun(adhoc)).toBe(result);
      expect(jobRunService.addHocRun).toHaveBeenCalledWith('cfg1', undefined, 'run1');
    });

    it('should pass projectId header to ad hoc run creation', async () => {
      const adhoc: AdHocRunDTO = { jobConfigId: 'cfg1' } as any;
      const result = { runId: 'run3' };
      jobRunService.addHocRun.mockResolvedValue(result as any);

      expect(await controller.adhocRun(adhoc, 'project-1')).toBe(result);
      expect(jobRunService.addHocRun).toHaveBeenCalledWith('cfg1', 'project-1', undefined);
    });
  });

  describe('updateJobRunStatus', () => {
    it('should update job run status', async () => {
      const jobRunId = 'run1';
      const status = JobRunStatus.Running;
      const result = { updated: true };
      jobRunService.updateJobRunStatus.mockResolvedValue(result as any);
      expect(await controller.updateJobRunStatus(jobRunId, status)).toBe(result);
      expect(jobRunService.updateJobRunStatus).toHaveBeenCalledWith(jobRunId, status, undefined);
    });

    it('should update job run status with projectId and log details', async () => {
      const jobRunId = 'run2';
      const status = JobRunStatus.Paused;
      const result = { updated: true };
      jobRunService.updateJobRunStatus.mockResolvedValue(result as any);

      expect(await controller.updateJobRunStatus(jobRunId, status, 'project-2')).toBe(result);
      expect(jobRunService.updateJobRunStatus).toHaveBeenCalledWith(jobRunId, status, 'project-2');
      expect(mockLogger.log).toHaveBeenCalledWith(`Updating job run status: jobRunId=${jobRunId}, status=${status}`);
    });
  });

  describe('addExcludedSkippedEntries', () => {
    it('should add excluded and skipped entries', async () => {
      const jobRunId = 'run1';
      const payload = {
        excluded: [{ path: '/a', isDirectory: false }],
        skipped: [{ path: '/b', isDirectory: true }],
      };
      const result = { added: 2 };
      jobRunService.addExcludedSkippedEntries.mockResolvedValue(result as any);

      expect(await controller.addExcludedSkippedEntries(jobRunId, payload)).toBe(result);
      expect(jobRunService.addExcludedSkippedEntries).toHaveBeenCalledWith(
        jobRunId,
        payload.excluded,
        payload.skipped,
      );
    });

    it('should default excluded and skipped arrays when body is empty', async () => {
      const jobRunId = 'run2';
      const result = { added: 0 };
      jobRunService.addExcludedSkippedEntries.mockResolvedValue(result as any);

      expect(await controller.addExcludedSkippedEntries(jobRunId, {} as any)).toBe(result);
      expect(jobRunService.addExcludedSkippedEntries).toHaveBeenCalledWith(jobRunId, [], []);
    });
  });

  describe('cutoverApproval', () => {
    it('should approve cutover', async () => {
      const jobRunId = 'run1';
      const status = CutOverStatus.APPROVED;
      const result = { cutover: true };
      jobRunService.cutOverApproval.mockResolvedValue(result as any);
      expect(await controller.cutoverApproval(jobRunId, status)).toBe(result);
      expect(jobRunService.cutOverApproval).toHaveBeenCalledWith(jobRunId, status);
    });
  });

  describe('getErrorOverview', () => {
    it('should get error overview', async () => {
      const jobRunId = 'run1';
      const result = { overview: true };
      jobRunService.getErrorOverview.mockResolvedValue(result);
      expect(await controller.getErrorOverview(jobRunId)).toBe(result);
      expect(jobRunService.getErrorOverview).toHaveBeenCalledWith(jobRunId);
    });
  });

  describe('handleCron', () => {
    it('should call jobRunInitService.scheduleAJob', async () => {
      jobRunInitService.scheduleAJob.mockResolvedValue(undefined);
      await controller.handleCron();
      expect(jobRunInitService.scheduleAJob).toHaveBeenCalled();
    });
  });

  describe('checkWorkerHealthCron', () => {
    it('should call jobRunService.checkWorkerHealth', async () => {
      jobRunService.checkWorkerHealth.mockResolvedValue(undefined);
      await controller.checkWorkerHealthCron();
      expect(jobRunService.checkWorkerHealth).toHaveBeenCalled();
    });
  });

  describe('updateWorkerResponse', () => {
    it('should update worker response', async () => {
      const jobRunId = 'run1';
      const workerId = 'worker1';
      const workerResponse = { status: 'ok' };
      const result = { updated: true };
      jobRunService.updateWorkerResponse.mockResolvedValue(result as any);
      expect(await controller.updateWorkerResponse(jobRunId, workerId, workerResponse)).toBe(result);
      expect(jobRunService.updateWorkerResponse).toHaveBeenCalledWith(jobRunId, workerId, workerResponse);
    });
  });

  describe('getJobRunIdentityMappings', () => {
    it('should return identity mappings for a job run', async () => {
      const jobRunId = 'run1';
      const result = { mappings: [{ source: 'user1', target: 'user2' }] };
      jobRunService.getJobRunIdentityMappings.mockResolvedValue(result as any);
      expect(await controller.getJobRunIdentityMappings(jobRunId)).toBe(result);
      expect(jobRunService.getJobRunIdentityMappings).toHaveBeenCalledWith(jobRunId);
    });
  });

  describe('getInProcessFiles', () => {
    const mockResult = {
      data: [
        { fileName: 'dir/file.txt', fileSize: 1024, timeElapsed: 30 },
        { fileName: 'dir/file2.txt', fileSize: null, timeElapsed: 90 },
      ],
      totalCount: 2,
    };

    it('should return in-process files with all defaulting to false when param is absent', async () => {
      const jobRunId = 'run1';
      jobRunService.getInProcessFiles.mockResolvedValue(mockResult);
      expect(await controller.getInProcessFiles(jobRunId)).toBe(mockResult);
      expect(jobRunService.getInProcessFiles).toHaveBeenCalledWith(jobRunId, false);
    });

    it('should pass all=true when query param is true', async () => {
      const jobRunId = 'run1';
      jobRunService.getInProcessFiles.mockResolvedValue(mockResult);
      expect(await controller.getInProcessFiles(jobRunId, true)).toBe(mockResult);
      expect(jobRunService.getInProcessFiles).toHaveBeenCalledWith(jobRunId, true);
    });
  });
});