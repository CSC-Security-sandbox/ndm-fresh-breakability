import { Test, TestingModule } from "@nestjs/testing";
import { OverviewController } from "./overview.controller";
import { OverviewService } from "./overview.service";
import { BadRequestException } from "@nestjs/common";

describe("OverviewController", () => {
  let controller: OverviewController;
  let overviewService: OverviewService;

  const mockOverviewService = {
    getStorageAndJobsOverview: jest.fn(),
  };

  beforeEach(async () => {
    const mockOverviewService = {
      getStorageAndJobsOverview: jest.fn(),
    };

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
    overviewService = module.get<OverviewService>(OverviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getStorageAndJobsOverview", () => {
    it("should throw BadRequestException when no params are provided", async () => {
      await expect(
        controller.getStorageAndJobsOverview(null, null, null)
      ).rejects.toThrow(BadRequestException);
    });
  });
});
