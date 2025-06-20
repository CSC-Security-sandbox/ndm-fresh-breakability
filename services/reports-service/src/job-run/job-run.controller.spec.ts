import { Test, TestingModule } from '@nestjs/testing';
import { serializeJobRunDetailsResponse } from './dto/job-rundetails.dto';
import { JobRunController } from './job-run.controller';
import { JobRunService } from './job-run.service';
import { Logger, BadRequestException } from '@nestjs/common';

const mockJobRunService = {
  getJobStatsId: jest.fn(),
  jobRunReportByJobRunId: jest.fn(),
  getJobSubStatus: jest.fn(),
};

describe('JobRunController', () => {
  let controller: JobRunController;
  let service: JobRunService;
  let logger: Logger;


  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobRunController],
      providers: [
        { provide: JobRunService, useValue: mockJobRunService },
        Logger,
      ],
    }).compile();

    controller = module.get<JobRunController>(JobRunController);
    service = module.get<JobRunService>(JobRunService);
  });
  
  it('should validate jobRunId format correctly', () => {
    const validJobRunId = 'abc123-XYZ';
    const invalidJobRunId = 'abc123@XYZ';

    expect(controller['validateJobRunId'](validJobRunId)).toBe(true);
    expect(controller['validateJobRunId'](invalidJobRunId)).toBe(false);
  });

  it('should throw BadRequestException for invalid jobRunId in getCocReportByJobRunId', async () => {
    const invalidJobRunId = 'invalid@id';

    try {
      await controller.getCocReportByJobRunId(invalidJobRunId);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toBe('Invalid JobRunId format.');
    }
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
