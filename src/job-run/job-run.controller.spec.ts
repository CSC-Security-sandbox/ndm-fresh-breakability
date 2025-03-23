import { Test, TestingModule } from '@nestjs/testing';
import { serializeJobRunDetailsResponse } from './dto/job-rundetails.dto';
import { JobRunController } from './job-run.controller';
import { JobRunService } from './job-run.service';

const mockJobRunService = {
  getJobStatsId: jest.fn(),
  jobRunReportByJobRunId: jest.fn(),
  getJobSubStatus: jest.fn(),
};

describe('JobRunController', () => {
  let controller: JobRunController;
  let service: JobRunService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobRunController],
      providers: [
        { provide: JobRunService, useValue: mockJobRunService },
      ],
    }).compile();

    controller = module.get<JobRunController>(JobRunController);
    service = module.get<JobRunService>(JobRunService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return job run details by ID when found', async () => {
    const jobRunId = '1';
    const mockResponse = { id: jobRunId, status: 'Completed' };
    
    mockJobRunService.getJobStatsId.mockResolvedValue(mockResponse);
    mockJobRunService.getJobSubStatus.mockResolvedValue(null);

    const result = await controller.getJobStatsId(jobRunId);

    expect(result).toEqual(serializeJobRunDetailsResponse(mockResponse));
    expect(mockJobRunService.getJobStatsId).toHaveBeenCalledWith(jobRunId);
  });

  it('should throw 404 error when job run is not found', async () => {
    const jobRunId = '1';
    mockJobRunService.getJobStatsId.mockResolvedValue({ status: 'Completed' });
    mockJobRunService.getJobSubStatus.mockResolvedValue({ subStatus: '' });

    try {
      await controller.getJobStatsId(jobRunId);
    } catch (e) {
      expect(e.response.statusCode).toBe(404);
      expect(e.response.message).toBe('Job run not found.');
    }
  });

  it("should return parsed job report data when found", async () => {
    const jobRunId = "1";
    const mockReportData = `[{"category": "Number of Files", "sub_category": "<8KiB", "value": 119897}]`;

    mockJobRunService.jobRunReportByJobRunId.mockResolvedValue(mockReportData);

    const result = await controller.getJobReportById(jobRunId, "");

    expect(result).toEqual(JSON.parse(mockReportData));
    expect(mockJobRunService.jobRunReportByJobRunId).toHaveBeenCalledWith(
      jobRunId,
      ""
    );
  });
});
