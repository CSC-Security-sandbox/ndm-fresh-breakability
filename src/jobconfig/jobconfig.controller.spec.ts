import { Test, TestingModule } from '@nestjs/testing';
import { JobConfigController } from './jobconfig.controller';
import { JobConfigService } from './jobconfig.service';
import { BadRequestException } from '@nestjs/common';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigDiscoverBulk, JobConfigPrecheck } from './dto/jobdicoverybulk.dto';
import { JobConfigPrecheckRes } from './jobconfig.types';

describe('JobConfigController', () => {
  let controller: JobConfigController;
  let service: JobConfigService;

  const mockJobConfigService = {
    createJobConfig: jest.fn(),
    createBulkDiscovery: jest.fn(),
    createBulkMigrate: jest.fn(),
    createBulkCutover: jest.fn(),
    precheck: jest.fn(),
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

  describe('createBulkMigrate', () => {
    it('should create bulk migrate jobs', async () => {
      const bulkMigrate: any = { sourcePathIds: ['123'] } as  any ;
      const jobConfigEntities: JobConfigEntity[] = [
        { id: '1', },
        { id: '2', },
      ] as JobConfigEntity[];

      mockJobConfigService.createBulkMigrate.mockResolvedValue(jobConfigEntities);

      const result = await controller.createBulkMigrate(bulkMigrate);
      expect(result).toEqual(jobConfigEntities);
      expect(mockJobConfigService.createBulkDiscovery).toHaveBeenCalledWith(bulkMigrate);
    });
  });

  describe('createBulkCutover', () => {
    it('should create bulk cutover jobs', async () => {
      const bulkCutover: any = { sourcePathIds: ['123'] } as  any ;
      const jobConfigEntities: JobConfigEntity[] = [
        { id: '1', },
        { id: '2', },
      ] as JobConfigEntity[];

      mockJobConfigService.createBulkCutover.mockResolvedValue(jobConfigEntities);

      const result = await controller.createBulkCutover(bulkCutover);
      expect(result).toEqual(jobConfigEntities);
      expect(mockJobConfigService.createBulkDiscovery).toHaveBeenCalledWith(bulkCutover);
    });
  });

  describe('precheck', () => {
    it('should return precheck result', async () => {
      const precheckDto: any = { sourcePathId: '', destinationPathId: [''] , preserveAccessTime: true }
      const response: JobConfigPrecheckRes[] =[
        {
          status: "success",
          workerId: "worker-12345",
          workerName: "worker",
          sourceFileServerConnection: {
            status: "success",
            message: "File server connection established."
          },
          targetFileServerConnection: {
            status: "success",
            message: "File server connection established."
          },
          mountStatus: {
            status: "mounted"
          },
          permissions: {
            source: {
              path: "/mnt/source",
              writeAccess: true,
              message: "Worker has write access to the source path."
            },
            target: {
              path: "/mnt/target",
              writeAccess: true,
              message: "Worker has write access to the target path."
            }
          }
        }
      ];
      mockJobConfigService.precheck.mockResolvedValue(response);
      const res = await controller.precheck(precheckDto);
      expect(res).toEqual(response);
      expect(service.precheck).toHaveBeenCalledWith(precheckDto);
    });
  })

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
      const jobConfigDto = { firstRunAt: '76a4sd76as5d768as' };
      const updatedJob = { id: jobId, ...jobConfigDto };

      mockJobConfigService.updateJobConfig.mockResolvedValue(updatedJob);

      const result = await controller.updateJobConfig(jobId, jobConfigDto as any);
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
