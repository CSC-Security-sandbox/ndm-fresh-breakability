import { Test, TestingModule } from '@nestjs/testing';
import { serializeJobRunDetailsResponse } from './dto/job-rundetails.dto';
import { JobRunController } from './job-run.controller';
import { JobRunService } from './job-run.service';

const mockJobRunService = {
  getJobStatsId: jest.fn(),
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

    const result = await controller.getJobStatsId(jobRunId);
    expect(result).toEqual(serializeJobRunDetailsResponse(mockResponse)); // Verify serialization
    expect(mockJobRunService.getJobStatsId).toHaveBeenCalledWith(jobRunId); // Ensure service method was called with the correct parameter
  });

  it('should throw 404 error when job run is not found', async () => {
    const jobRunId = '1';
    mockJobRunService.getJobStatsId.mockResolvedValue(null);

    try {
      await controller.getJobStatsId(jobRunId);
    } catch (e) {
      expect(e.response.statusCode).toBe(404); // Check if it throws the NotFoundException
      expect(e.response.message).toBe('Job run not found.');
    }
  });
});
