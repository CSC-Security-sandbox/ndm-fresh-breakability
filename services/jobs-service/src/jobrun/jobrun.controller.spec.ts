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
            getJobRun: jest.fn(),
            approveCutoverRequest: jest.fn(),
            addHocRun: jest.fn(),
            updateJobRunStatus: jest.fn(),
            cutOverApproval: jest.fn(),
            getErrorOverview: jest.fn(),
            checkWorkerHealth: jest.fn(),
            updateWorkerResponse: jest.fn(),
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
      expect(jobRunActionService.actions).toHaveBeenCalledWith(req);
    });
  });

  describe('cutoverApprove', () => {
    it('should approve cutover request', async () => {
      const approval: ApprovalRequestDTO = {} as any;
      const result = { approved: true };
      jobRunService.approveCutoverRequest.mockResolvedValue(result as any);
      expect(await controller.cutoverApprove(approval)).toBe(result);
      expect(jobRunService.approveCutoverRequest).toHaveBeenCalledWith(approval);
    });
  });

  describe('adhocRun', () => {
    it('should create ad hoc run', async () => {
      const adhoc: AdHocRunDTO = { jobConfigId: 'cfg1' } as any;
      const result = { runId: 'run1' };
      jobRunService.addHocRun.mockResolvedValue(result as any);
      expect(await controller.adhocRun(adhoc)).toBe(result);
      expect(jobRunService.addHocRun).toHaveBeenCalledWith('cfg1', undefined);
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
});