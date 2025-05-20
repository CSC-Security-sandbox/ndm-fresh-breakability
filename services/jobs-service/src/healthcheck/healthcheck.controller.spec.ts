import { Test, TestingModule } from "@nestjs/testing";
import { HealthcheckController } from "./healthcheck.controller";
import { HealthcheckService } from "./healthcheck.service";
import { LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { getRepositoryToken } from "@nestjs/typeorm";
import { WorkerStatsEntity } from "src/entities/worker-stats.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { Repository } from "typeorm";
import { cpuUsage } from "process";
import { HealthcheckStats } from "./dto/healthcheck.dto";
import { HealthCheckResponse } from "./dto/healthcheck-response.dto";
import { HttpStatus, InternalServerErrorException } from "@nestjs/common";
import { JwtService } from "@netapp-cloud-datamigrate/auth-lib";

describe("HealthcheckController", () => {
  let controller: HealthcheckController;
  let service: HealthcheckService;

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: [],
            projects: [],
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
      controllers: [HealthcheckController],
      providers: [
        {
          provide: HealthcheckService,
          useValue: {
            createOrUpdateHealthCheckStats: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: LoggerService,
          useValue: {
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthcheckController>(HealthcheckController);
    service = module.get<HealthcheckService>(HealthcheckService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("should return success response when service executes successfully", async () => {
    // Arrange
    const healthStats: HealthcheckStats = {
      workerId: "worker-123",
      healthStatus: "healthy",
      systemStats: {
        cpuUsage: "50",
        memoryUsage: "70",
        memoryLimit: "m-limit",
        diskLimit: "d-limit",
        diskUsage: "d-usage",
      },
    };
    jest
      .spyOn(service, "createOrUpdateHealthCheckStats")
      .mockResolvedValueOnce();

    // Act
    const response: HealthCheckResponse =
      await controller.healthCheck(healthStats);

    // Assert
    expect(service.createOrUpdateHealthCheckStats).toHaveBeenCalledWith(
      healthStats,
    );
    expect(response).toEqual({
      statusCode: HttpStatus.OK,
    });
  });

  it("should return failure response and log error when service throws an error", async () => {
    // Arrange
    const healthStats: HealthcheckStats = {
      workerId: "worker-123",
      healthStatus: "healthy",
      systemStats: {
        cpuUsage: "50",
        memoryUsage: "70",
        memoryLimit: "m-limit",
        diskLimit: "d-limit",
        diskUsage: "d-usage",
      },
    };
    const error = new Error("Worker not found");
    jest
      .spyOn(service, "createOrUpdateHealthCheckStats")
      .mockRejectedValueOnce(error);

    // Act
    await expect(controller.healthCheck(healthStats)).rejects.toThrow(
      InternalServerErrorException,
    );
    // Assert
    expect(service.createOrUpdateHealthCheckStats).toHaveBeenCalledWith(
      healthStats,
    );
  });
});
