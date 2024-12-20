import { Test, TestingModule } from '@nestjs/testing';
import { OverviewController } from './overview.controller';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OverviewService } from './overview.service';

describe('OverviewController', () => {
  let controller: OverviewController;
  let service: OverviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OverviewController],
      providers: [
        {
          provide: OverviewService,
          useValue: {
            getStorageAndJobsOverview: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<OverviewController>(OverviewController);
    service = module.get<OverviewService>(OverviewService);
  });
  describe('getStorageAndJobsOverview', () => {
    it('should throw NotFoundException if no query params are provided', async () => {
      await expect(
        controller.getStorageAndJobsOverview(undefined, undefined, undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('should call the service and return the correct response', async () => {
    const mockResponse = {
      storageDetails: {
        totalDiscoveredSize: "2.93 KB",
        totalMigratedSize: "0 B",
        totalFileServers: 1,
        totalPendingSize: "2.93 KB",
      },
      jobDetails: {
        totalDiscoverJobs: 1,
        totalMigrateJobs: {
          baseLineJob: 0,
          incrementalJob: 0,
        },
        totalCutoverJobs: 0,
      },
    };

    jest
      .spyOn(service, 'getStorageAndJobsOverview')
      .mockResolvedValue(mockResponse);

    const result = await controller.getStorageAndJobsOverview(
      'project1',
      'server1',
      'job1',
    );

    expect(service.getStorageAndJobsOverview).toHaveBeenCalledWith(
      'project1',
      'server1',
      'job1',
    );
    expect(result).toEqual(mockResponse);
  });
});
