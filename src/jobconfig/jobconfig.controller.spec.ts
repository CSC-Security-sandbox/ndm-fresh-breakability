import { Test, TestingModule } from '@nestjs/testing';
import { JobConfigController } from './jobconfig.controller';
import { JobConfigService } from './jobconfig.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobListingDTO } from './dto/joblisting.dto';
import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { BulkMigrateJobConfig } from './dto/bulkMigrateJob.dto';
import { JobConfigDiscoverBulk, JobConfigPrecheck } from './dto/jobdicoverybulk.dto';
import { JobConfigBulkMigrateRes, JobConfigPrecheckRes } from './jobconfig.types';
import { Response } from 'express';
import { JobConfigBulkMigrateResStatus, JobType } from 'src/constants/enums';

describe('JobConfigController', () => {
  let controller: JobConfigController;
  let service: JobConfigService;

  const mockJobConfigService = {
    createBulkDiscovery: jest.fn(),
    createBulkMigrate: jest.fn(),
    createBulkCutover: jest.fn(),
    precheck: jest.fn(),
    getAllJobConfig: jest.fn(),
    getJobConfigById: jest.fn(),
    getConfigsByProjectId: jest.fn(),
    updateJobConfig: jest.fn(),
    deleteJobConfig: jest.fn(),
    getTemplateFilename: jest.fn(),
    sendCsvFile: jest.fn(),
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
    it('should throw BadRequestException if payload is invalid', async () => {
      const payload = new JobConfigDiscoverBulk();
      payload.sourcePathIds = [];

      await expect(controller.createBulkDiscovery(payload)).rejects.toThrow(BadRequestException);
    });

  describe('createBulkMigrate', () => {
    it('should create a new migrate job', async () => {
      const bulkMigrate: BulkMigrateJobConfig = {
        firstRunAt: new Date(),
        futureRunSchedule: '2023-12-31T12:00:00Z',
        migrateConfigs: [
          {
            sourcePathId: '550e8400-e29b-41d4-a716-446655440000',
            destinationPathId: ['550e8400-e29b-41d4-a716-446655440001'],
          },
        ],
        options: {
          excludeOlderThan: new Date('2023-01-01'),
          excludeFilePatterns: '.*.tmp',
          preserveAccessTime: true,
        },
        sidMapping: undefined,
        gidMapping: undefined
      };

      const result: JobConfigBulkMigrateRes[] = [
        {
          id: '1',
          jobType: JobType.MIGRATE,
          status: JobConfigBulkMigrateResStatus.CREATED,
          sourcePathId: bulkMigrate.migrateConfigs[0].sourcePathId,
          targetPathId: bulkMigrate.migrateConfigs[0].destinationPathId[0],
        },
      ];

      jest.spyOn(service, 'createBulkMigrate').mockResolvedValue(result);

      const response = await controller.createBulkMigrate(bulkMigrate);
      expect(response).toEqual(result);
      expect(service.createBulkMigrate).toHaveBeenCalledWith(bulkMigrate);
    });

    it('should throw BadRequestException if validation fails', async () => {
      const bulkMigrate: BulkMigrateJobConfig = {
        firstRunAt: new Date(),
        futureRunSchedule: '2023-12-31T12:00:00Z',
        migrateConfigs: [
          {
            sourcePathId: '550e8400-e29b-41d4-a716-446655440000',
            destinationPathId: ['550e8400-e29b-41d4-a716-446655440000'], // Invalid case for testing
          },
        ],
        options: {
          excludeOlderThan: new Date('2023-01-01'),
          excludeFilePatterns: '.*.tmp',
          preserveAccessTime: true,
        },
        sidMapping: undefined,
        gidMapping: undefined
      };

      jest.spyOn(service, 'createBulkMigrate').mockImplementation(() => {
        throw new BadRequestException('Invalid migration configuration');
      });

      await expect(controller.createBulkMigrate(bulkMigrate)).rejects.toThrow(BadRequestException);
      await expect(controller.createBulkMigrate(bulkMigrate)).rejects.toThrow('Invalid migration configuration');
    });
  });

  describe('precheck', () => {
    it('should return precheck result', async () => {
      const precheckDto: JobConfigPrecheck = { migrateConfigs: [{ sourcePathId: '', destinationPathId: [''] }], preserveAccessTime: true }
      const response: JobConfigPrecheckRes = { status: 'success' };
      mockJobConfigService.precheck.mockResolvedValue(response);
      const res = await controller.precheck(precheckDto);
      expect(res).toEqual(response);
      expect(service.precheck).toHaveBeenCalledWith(precheckDto);
    });
  });

  describe('getAllJobConfig', () => {
    it('should return job listings', async () => {
      const mockJobs = [{ jobConfigId: '1', configName: 'Test', jobType: 'DISCOVER', jobStatus: 'ACTIVE' }];
      mockJobConfigService.getAllJobConfig.mockResolvedValue(mockJobs);

      expect(await controller.getAllJobConfig('123')).toEqual(mockJobs);
    });

    it('should throw BadRequestException if projectId is missing', async () => {
      await expect(controller.getAllJobConfig(null)).rejects.toThrow(BadRequestException);
    });
  });

  describe('downloadTemplate', () => {
    it('should throw BadRequestException if multiple query params are provided', async () => {
      const res = {} as Response;
      await expect(controller.downloadTemplate(res, 'sid1', 'gid1')).rejects.toThrow(BadRequestException);
    });

    it('should call sendCsvFile with correct filename', async () => {
      const res = { send: jest.fn() } as unknown as Response;
      mockJobConfigService.getTemplateFilename.mockReturnValue('template.csv');
      mockJobConfigService.sendCsvFile.mockReturnValue(null);

      await controller.downloadTemplate(res, 'sid1', undefined, undefined);
      expect(service.getTemplateFilename).toHaveBeenCalledWith({ sid: 'sid1', gid: undefined, uid: undefined });
      expect(service.sendCsvFile).toHaveBeenCalledWith('template.csv', res);
    });
  });

  describe('updateJobConfig', () => {
    it('should update a job', async () => {
      const jobConfig = { jobConfigId: '1', status: 'ACTIVE' } as any;
      mockJobConfigService.updateJobConfig.mockResolvedValue(jobConfig);

      expect(await controller.updateJobConfig('1', jobConfig)).toEqual(jobConfig);
      expect(service.updateJobConfig).toHaveBeenCalledWith('1', jobConfig);
    });
  });

  describe('deleteJobConfig', () => {
    it('should delete a job and return a success message', async () => {
      mockJobConfigService.deleteJobConfig.mockResolvedValue({ message: 'Deleted' });

      expect(await controller.deleteJobConfig('1')).toEqual({ message: 'Deleted' });
      expect(service.deleteJobConfig).toHaveBeenCalledWith('1');
    });
  });
});
});

