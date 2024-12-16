import { Test, TestingModule } from '@nestjs/testing';
import { JobConfigController } from './jobconfig.controller';
import { JobConfigService } from './jobconfig.service';
import { BadRequestException } from '@nestjs/common';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigDiscoverBulk } from './dto/jobdicoverybulk.dto';
import { JobStatus } from 'src/constants/enums';

describe('JobConfigController', () => {
  let controller: JobConfigController;
  let service: JobConfigService;

  const mockJobConfigService = {
    createJobConfig: jest.fn(),
    createBulkDiscovery: jest.fn(),
    getAllJobConfig: jest.fn(),
    getJobConfigById: jest.fn(),
    updateJobConfig: jest.fn(),
    deleteJobConfig: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobConfigController],
      providers: [
        {
          provide: JobConfigService,
          useValue: mockJobConfigService,
        },
      ],
    }).compile();

    controller = module.get<JobConfigController>(JobConfigController);
    service = module.get<JobConfigService>(JobConfigService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createJobConfig', () => {
    it('should create a job config', async () => {
      const jobConfigDto: JobConfigDto = { id: 'asd', status: JobStatus.Active } as any;
      const jobConfigEntity: JobConfigEntity = { id: '1' } as JobConfigEntity;

      mockJobConfigService.createJobConfig.mockResolvedValue(jobConfigEntity);

      const result = await controller.createJobConfig(jobConfigDto);
      expect(result).toEqual(jobConfigEntity);
      expect(mockJobConfigService.createJobConfig).toHaveBeenCalledWith(jobConfigDto);
    });
  });

  describe('createBulkDiscovery', () => {
    it('should create bulk discovery jobs', async () => {
      const bulkDiscovery: JobConfigDiscoverBulk = { sourcePathIds: ['123'] } as  JobConfigDiscoverBulk ;
      const jobConfigEntities: JobConfigEntity[] = [
        { id: '1', },
        { id: '2', },
      ] as JobConfigEntity[];

      mockJobConfigService.createBulkDiscovery.mockResolvedValue(jobConfigEntities);

      const result = await controller.createBulkDiscovery(bulkDiscovery);
      expect(result).toEqual(jobConfigEntities);
      expect(mockJobConfigService.createBulkDiscovery).toHaveBeenCalledWith(bulkDiscovery);
    });
  });

  describe('getAllJobConfig', () => {
    it('should throw BadRequestException if projectId is missing', async () => {
      await expect(controller.getAllJobConfig('')).rejects.toThrow(BadRequestException);
    });

    it('should return all job configs for a project', async () => {
      const projectId = 'project1';
      const jobListing: JobListingDTO[] = [{ jobConfigId: '1', }] as JobListingDTO[];

      mockJobConfigService.getAllJobConfig.mockResolvedValue(jobListing);

      const result = await controller.getAllJobConfig(projectId);
      expect(result).toEqual(jobListing);
      expect(mockJobConfigService.getAllJobConfig).toHaveBeenCalledWith(projectId);
    });
  });

  describe('getJobConfigById', () => {
    it('should return a job by its ID', async () => {
      const jobId = '1';
      const job = { id: jobId, name: 'Test Job' };

      mockJobConfigService.getJobConfigById.mockResolvedValue(job);

      const result = await controller.getJobConfigById(jobId);
      expect(result).toEqual(job);
      expect(mockJobConfigService.getJobConfigById).toHaveBeenCalledWith(jobId);
    });
  });

  describe('updateJobConfig', () => {
    it('should update a job config', async () => {
      const jobId = '1';
      const jobConfigDto: JobConfigDto = { sourcePathId: '76a4sd76as5d768as' } as JobConfigDto;
      const updatedJob = { id: jobId, ...jobConfigDto };

      mockJobConfigService.updateJobConfig.mockResolvedValue(updatedJob);

      const result = await controller.updateJobConfig(jobId, jobConfigDto);
      expect(result).toEqual(updatedJob);
      expect(mockJobConfigService.updateJobConfig).toHaveBeenCalledWith(jobId, jobConfigDto);
    });
  });

  describe('deleteJobConfig', () => {
    it('should delete a job config', async () => {
      const jobId = '1';
      const message = { message: 'Job deleted successfully' };

      mockJobConfigService.deleteJobConfig.mockResolvedValue(message);

      const result = await controller.deleteJobConfig(jobId);
      expect(result).toEqual(message);
      expect(mockJobConfigService.deleteJobConfig).toHaveBeenCalledWith(jobId);
    });
  });
});
