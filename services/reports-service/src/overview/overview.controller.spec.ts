import { Test, TestingModule } from '@nestjs/testing';
import { OverviewController } from './overview.controller';
import { BadRequestException } from '@nestjs/common';
import { OverviewService } from './overview.service';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';

describe("OverviewController", () => {
  let controller: OverviewController;
  let service: OverviewService;

  const mockOverviewService = {
    getStorageAndJobsOverview: jest.fn(),
  };

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
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OverviewController],
      providers: [
        {
          provide: OverviewService,
          useValue: mockOverviewService,
        },
      ],
    }).compile();

    controller = module.get<OverviewController>(OverviewController);
    service = module.get<OverviewService>(OverviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getStorageAndJobsOverview", () => {
    it("should return overview data when projectId is provided", async () => {
      const mockResult = { status: "ok" };
      mockOverviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockResult
      );

      const result = await controller.getStorageAndJobsOverview(
        "proj123",
        null,
        null
      );

      expect(result).toBe(mockResult);
      expect(service.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "proj123",
        null,
        null
      );
    });

    it("should return overview data when fileServerId is provided", async () => {
      const mockResult = { status: "ok" };
      mockOverviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockResult
      );

      const result = await controller.getStorageAndJobsOverview(
        null,
        "fs123",
        null
      );

      expect(result).toBe(mockResult);
      expect(service.getStorageAndJobsOverview).toHaveBeenCalledWith(
        null,
        "fs123",
        null
      );
    });

    it("should return overview data when jobConfigId is provided", async () => {
      const mockResult = { status: "ok" };
      mockOverviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockResult
      );

      const result = await controller.getStorageAndJobsOverview(
        null,
        null,
        "job123"
      );

      expect(result).toBe(mockResult);
      expect(service.getStorageAndJobsOverview).toHaveBeenCalledWith(
        null,
        null,
        "job123"
      );
    });

    it("should throw BadRequestException when no params are provided", async () => {
      await expect(
        controller.getStorageAndJobsOverview(null, null, null)
      ).rejects.toThrow(BadRequestException);
    });

    it("should propagate service errors", async () => {
      mockOverviewService.getStorageAndJobsOverview.mockRejectedValue(
        new Error("Service Error")
      );

      await expect(
        controller.getStorageAndJobsOverview("proj123", null, null)
      ).rejects.toThrow("Service Error");
    });
  });
});
