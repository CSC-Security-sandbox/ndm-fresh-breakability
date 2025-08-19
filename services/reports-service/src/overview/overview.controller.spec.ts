import { Test, TestingModule } from "@nestjs/testing";
import { OverviewController } from "./overview.controller";
import { OverviewService } from "./overview.service";
import { BadRequestException } from "@nestjs/common";
import { OverviewDTO } from "./overview.dto";
import {
  JwtAuthGuard,
  JwtService,
  JwtWorkerAuthGuard,
} from "@netapp-cloud-datamigrate/auth-lib";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";

describe("OverviewController", () => {
  let controller: OverviewController;
  let overviewService: jest.Mocked<OverviewService>;

  const mockOverviewData: OverviewDTO = {
    storageDetails: {
      totalDiscoveredSize: "1.2 GiB",
      totalMigratedSize: "800 MiB",
      totalPendingSize: "400 MiB",
      totalFileServers: 5,
    },
    jobDetails: {
      totalDiscoverJobs: 10,
      totalMigrateJobs: 8,
      totalCutoverJobs: 2,
    },
    lastRefreshed: new Date(),
  };

  const mockOverviewService = {
    getStorageAndJobsOverview: jest.fn(),
  };

  const mockJwtService = {
    verifyToken: jest.fn(),
    decode: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue({
      keycloakBaseUrl: "http://localhost:8080",
      realm: "test",
    }),
  };

  const mockJwtAuthGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  const mockJwtWorkerAuthGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OverviewController],
      providers: [
        {
          provide: OverviewService,
          useValue: mockOverviewService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: Reflector,
          useValue: {},
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .overrideGuard(JwtWorkerAuthGuard)
      .useValue(mockJwtWorkerAuthGuard)
      .compile();

    controller = module.get<OverviewController>(OverviewController);
    overviewService = module.get(OverviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getStorageAndJobsOverview", () => {
    describe("Valid parameter combinations", () => {
      it("should return overview data when projectId is provided", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "project-123",
          undefined,
          undefined,
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "project-123",
          undefined,
          undefined,
        );
      });

      it("should return overview data when configId is provided", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          undefined,
          "config-456",
          undefined,
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          undefined,
          "config-456",
          undefined,
        );
      });

      it("should return overview data when jobConfigId is provided", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          undefined,
          undefined,
          "job-config-789",
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          undefined,
          undefined,
          "job-config-789",
        );
      });

      it("should return overview data when multiple parameters are provided", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "project-123",
          "config-456",
          "job-config-789",
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "project-123",
          "config-456",
          "job-config-789",
        );
      });

      it("should return overview data when projectId and configId are provided", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "project-123",
          "config-456",
          undefined,
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "project-123",
          "config-456",
          undefined,
        );
      });

      it("should return overview data when projectId and jobConfigId are provided", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "project-123",
          undefined,
          "job-config-789",
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "project-123",
          undefined,
          "job-config-789",
        );
      });

      it("should return overview data when configId and jobConfigId are provided", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          undefined,
          "config-456",
          "job-config-789",
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          undefined,
          "config-456",
          "job-config-789",
        );
      });
    });

    describe("Invalid parameter combinations", () => {
      it("should throw BadRequestException when no parameters are provided", async () => {
        await expect(
          controller.getStorageAndJobsOverview(undefined, undefined, undefined),
        ).rejects.toThrow(
          new BadRequestException(
            `Required parameters['ProjectId or configId or JobConfig Id ' are missing in the request`,
          ),
        );

        expect(
          overviewService.getStorageAndJobsOverview,
        ).not.toHaveBeenCalled();
      });

      it("should throw BadRequestException when all parameters are null", async () => {
        await expect(
          controller.getStorageAndJobsOverview(null, null, null),
        ).rejects.toThrow(
          new BadRequestException(
            `Required parameters['ProjectId or configId or JobConfig Id ' are missing in the request`,
          ),
        );

        expect(
          overviewService.getStorageAndJobsOverview,
        ).not.toHaveBeenCalled();
      });

      it("should throw BadRequestException when all parameters are empty strings", async () => {
        await expect(
          controller.getStorageAndJobsOverview("", "", ""),
        ).rejects.toThrow(
          new BadRequestException(
            `Required parameters['ProjectId or configId or JobConfig Id ' are missing in the request`,
          ),
        );

        expect(
          overviewService.getStorageAndJobsOverview,
        ).not.toHaveBeenCalled();
      });

      it("should NOT throw BadRequestException when parameters are whitespace only (they are truthy)", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "   ",
          "   ",
          "   ",
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "   ",
          "   ",
          "   ",
        );
      });
    });

    describe("Parameter validation edge cases", () => {
      it("should handle projectId with special characters", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "project-123@#$%",
          undefined,
          undefined,
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "project-123@#$%",
          undefined,
          undefined,
        );
      });

      it("should handle configId with special characters", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          undefined,
          "config-456!@#",
          undefined,
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          undefined,
          "config-456!@#",
          undefined,
        );
      });

      it("should handle jobConfigId with special characters", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          undefined,
          undefined,
          "job-config-789$%^",
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          undefined,
          undefined,
          "job-config-789$%^",
        );
      });

      it("should handle very long parameter values", async () => {
        const longId = "a".repeat(1000);
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          longId,
          undefined,
          undefined,
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          longId,
          undefined,
          undefined,
        );
      });

      it("should handle numeric string parameters", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "123456",
          "789012",
          "345678",
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "123456",
          "789012",
          "345678",
        );
      });

      it("should handle UUID format parameters", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "550e8400-e29b-41d4-a716-446655440000",
          "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
          "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "550e8400-e29b-41d4-a716-446655440000",
          "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
          "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
        );
      });
    });

    describe("Service error handling", () => {
      it("should propagate service errors", async () => {
        const serviceError = new Error("Service error");
        overviewService.getStorageAndJobsOverview.mockRejectedValue(
          serviceError,
        );

        await expect(
          controller.getStorageAndJobsOverview(
            "project-123",
            undefined,
            undefined,
          ),
        ).rejects.toThrow(serviceError);

        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "project-123",
          undefined,
          undefined,
        );
      });

      it("should handle service returning null", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(null);

        const result = await controller.getStorageAndJobsOverview(
          "project-123",
          undefined,
          undefined,
        );

        expect(result).toBeNull();
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "project-123",
          undefined,
          undefined,
        );
      });

      it("should handle service returning undefined", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(undefined);

        const result = await controller.getStorageAndJobsOverview(
          "project-123",
          undefined,
          undefined,
        );

        expect(result).toBeUndefined();
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "project-123",
          undefined,
          undefined,
        );
      });

      it("should handle service throwing BadRequestException", async () => {
        const badRequestError = new BadRequestException("Invalid input");
        overviewService.getStorageAndJobsOverview.mockRejectedValue(
          badRequestError,
        );

        await expect(
          controller.getStorageAndJobsOverview(
            "project-123",
            undefined,
            undefined,
          ),
        ).rejects.toThrow(badRequestError);

        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "project-123",
          undefined,
          undefined,
        );
      });
    });

    describe("Response data validation", () => {
      it("should handle empty storage details", async () => {
        const emptyStorageData: OverviewDTO = {
          storageDetails: {
            totalDiscoveredSize: "0 B",
            totalMigratedSize: "0 B",
            totalPendingSize: "0 B",
            totalFileServers: 0,
          },
          jobDetails: {
            totalDiscoverJobs: 0,
            totalMigrateJobs: 0,
            totalCutoverJobs: 0,
          },
          lastRefreshed: new Date(),
        };

        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          emptyStorageData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "project-123",
          undefined,
          undefined,
        );

        expect(result).toEqual(emptyStorageData);
      });

      it("should handle large storage values", async () => {
        const largeStorageData: OverviewDTO = {
          storageDetails: {
            totalDiscoveredSize: "1.5 TiB",
            totalMigratedSize: "1.2 TiB",
            totalPendingSize: "300 GiB",
            totalFileServers: 100,
          },
          jobDetails: {
            totalDiscoverJobs: 1000,
            totalMigrateJobs: 800,
            totalCutoverJobs: 200,
          },
          lastRefreshed: new Date(),
        };

        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          largeStorageData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "project-123",
          undefined,
          undefined,
        );

        expect(result).toEqual(largeStorageData);
      });

      it("should handle partial data in response", async () => {
        const partialData: OverviewDTO = {
          storageDetails: {
            totalDiscoveredSize: "1.2 GiB",
            totalMigratedSize: "0 B",
            totalPendingSize: "1.2 GiB",
            totalFileServers: 1,
          },
          jobDetails: {
            totalDiscoverJobs: 5,
            totalMigrateJobs: 0,
            totalCutoverJobs: 0,
          },
          lastRefreshed: new Date(),
        };

        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          partialData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "project-123",
          undefined,
          undefined,
        );

        expect(result).toEqual(partialData);
      });
    });

    describe("Conditional logic coverage", () => {
      it("should handle falsy projectId but truthy configId", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "", // falsy projectId
          "config-456", // truthy configId
          undefined,
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "",
          "config-456",
          undefined,
        );
      });

      it("should handle falsy projectId and configId but truthy jobConfigId", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          "", // falsy projectId
          "", // falsy configId
          "job-config-789", // truthy jobConfigId
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          "",
          "",
          "job-config-789",
        );
      });

      it("should handle null projectId but truthy configId", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          null, // null projectId
          "config-456", // truthy configId
          undefined,
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          null,
          "config-456",
          undefined,
        );
      });

      it("should handle undefined projectId and configId but truthy jobConfigId", async () => {
        overviewService.getStorageAndJobsOverview.mockResolvedValue(
          mockOverviewData,
        );

        const result = await controller.getStorageAndJobsOverview(
          undefined, // undefined projectId
          undefined, // undefined configId
          "job-config-789", // truthy jobConfigId
        );

        expect(result).toEqual(mockOverviewData);
        expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
          undefined,
          undefined,
          "job-config-789",
        );
      });

      it("should handle the exact condition !projectId && !configId && !jobConfigId", async () => {
        // Test only combinations that should trigger the error (truly falsy values)
        const falsyValues = [undefined, null, ""];

        for (const projectId of falsyValues) {
          for (const configId of falsyValues) {
            for (const jobConfigId of falsyValues) {
              await expect(
                controller.getStorageAndJobsOverview(
                  projectId,
                  configId,
                  jobConfigId,
                ),
              ).rejects.toThrow(
                new BadRequestException(
                  `Required parameters['ProjectId or configId or JobConfig Id ' are missing in the request`,
                ),
              );
            }
          }
        }
      });
    });
  });

  describe("Controller initialization", () => {
    it("should be defined", () => {
      expect(controller).toBeDefined();
    });

    it("should have overviewService injected", () => {
      expect(overviewService).toBeDefined();
    });

    it("should have correct method signatures", () => {
      expect(typeof controller.getStorageAndJobsOverview).toBe("function");
      expect(typeof controller.downloadReports).toBe("function");
    });
  });

  describe("downloadReports method", () => {
    it("should throw error when called (not implemented)", () => {
      expect(() => controller.downloadReports([], "test")).toThrow(
        new Error("Method not implemented."),
      );
    });

    it("should handle different parameter types", () => {
      expect(() => controller.downloadReports(undefined, "test")).toThrow(
        new Error("Method not implemented."),
      );
      expect(() => controller.downloadReports(null, "test")).toThrow(
        new Error("Method not implemented."),
      );
      expect(() => controller.downloadReports([], "")).toThrow(
        new Error("Method not implemented."),
      );
    });
  });

  describe("Branch coverage for validation logic", () => {
    it("should cover !projectId branch when projectId is falsy", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      // Test where !projectId is true but !configId is false
      const result = await controller.getStorageAndJobsOverview(
        "", // falsy projectId (!projectId = true)
        "config-456", // truthy configId (!configId = false)
        undefined, // falsy jobConfigId (!jobConfigId = true)
      );

      expect(result).toEqual(mockOverviewData);
      // The condition !projectId && !configId && !jobConfigId should be false
      // because !configId is false, so the BadRequestException should not be thrown
    });

    it("should cover !configId branch when configId is falsy", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      // Test where !projectId is false but !configId is true
      const result = await controller.getStorageAndJobsOverview(
        "project-123", // truthy projectId (!projectId = false)
        "", // falsy configId (!configId = true)
        undefined, // falsy jobConfigId (!jobConfigId = true)
      );

      expect(result).toEqual(mockOverviewData);
      // The condition !projectId && !configId && !jobConfigId should be false
      // because !projectId is false, so the BadRequestException should not be thrown
    });

    it("should cover !jobConfigId branch when jobConfigId is falsy", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      // Test where !projectId and !configId are false but !jobConfigId is true
      const result = await controller.getStorageAndJobsOverview(
        "project-123", // truthy projectId (!projectId = false)
        "config-456", // truthy configId (!configId = false)
        "", // falsy jobConfigId (!jobConfigId = true)
      );

      expect(result).toEqual(mockOverviewData);
      // The condition !projectId && !configId && !jobConfigId should be false
      // because !projectId and !configId are false, so the BadRequestException should not be thrown
    });

    it("should cover all branches true: !projectId && !configId && !jobConfigId", async () => {
      // Test where all three conditions are true
      await expect(
        controller.getStorageAndJobsOverview(
          "", // falsy projectId (!projectId = true)
          "", // falsy configId (!configId = true)
          "", // falsy jobConfigId (!jobConfigId = true)
        ),
      ).rejects.toThrow(BadRequestException);
      // The condition !projectId && !configId && !jobConfigId should be true
      // so the BadRequestException should be thrown
    });
  });

  describe("Async behavior and Promise handling", () => {
    it("should handle async service calls properly", async () => {
      const promise = Promise.resolve(mockOverviewData);
      overviewService.getStorageAndJobsOverview.mockReturnValue(promise);

      const result = await controller.getStorageAndJobsOverview(
        "project-123",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "project-123",
        undefined,
        undefined,
      );
    });

    it("should handle rejected promises from service", async () => {
      const error = new Error("Async service error");
      overviewService.getStorageAndJobsOverview.mockRejectedValue(error);

      await expect(
        controller.getStorageAndJobsOverview(
          "project-123",
          undefined,
          undefined,
        ),
      ).rejects.toThrow(error);
    });

    it("should handle slow service responses", async () => {
      const delay = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));
      overviewService.getStorageAndJobsOverview.mockImplementation(async () => {
        await delay(100);
        return mockOverviewData;
      });

      const result = await controller.getStorageAndJobsOverview(
        "project-123",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
    });
  });

  describe("JavaScript falsy/truthy behavior validation", () => {
    it("should handle whitespace-only strings as truthy values", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      // Whitespace-only strings are truthy in JavaScript
      const result = await controller.getStorageAndJobsOverview(
        "   ",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "   ",
        undefined,
        undefined,
      );
    });

    it("should handle tab characters as truthy values", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const result = await controller.getStorageAndJobsOverview(
        "\t\t",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "\t\t",
        undefined,
        undefined,
      );
    });

    it("should handle newline characters as truthy values", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const result = await controller.getStorageAndJobsOverview(
        "\n\n",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "\n\n",
        undefined,
        undefined,
      );
    });

    it("should handle mixed whitespace as truthy values", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const result = await controller.getStorageAndJobsOverview(
        " \t\n ",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        " \t\n ",
        undefined,
        undefined,
      );
    });

    it("should handle single space as truthy value", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const result = await controller.getStorageAndJobsOverview(
        " ",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        " ",
        undefined,
        undefined,
      );
    });

    it("should handle string '0' as truthy value", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const result = await controller.getStorageAndJobsOverview(
        "0",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "0",
        undefined,
        undefined,
      );
    });

    it("should handle string 'false' as truthy value", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const result = await controller.getStorageAndJobsOverview(
        "false",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "false",
        undefined,
        undefined,
      );
    });

    it("should handle string 'null' as truthy value", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const result = await controller.getStorageAndJobsOverview(
        "null",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "null",
        undefined,
        undefined,
      );
    });

    it("should handle string 'undefined' as truthy value", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const result = await controller.getStorageAndJobsOverview(
        "undefined",
        undefined,
        undefined,
      );

      expect(result).toEqual(mockOverviewData);
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "undefined",
        undefined,
        undefined,
      );
    });
  });

  describe("Comprehensive falsy values testing", () => {
    it("should throw BadRequestException for all truly falsy combinations", async () => {
      const falsyValues = [undefined, null, ""];

      // Test all 27 combinations of falsy values
      for (const projectId of falsyValues) {
        for (const configId of falsyValues) {
          for (const jobConfigId of falsyValues) {
            await expect(
              controller.getStorageAndJobsOverview(
                projectId,
                configId,
                jobConfigId,
              ),
            ).rejects.toThrow(BadRequestException);
          }
        }
      }
    });

    it("should NOT throw BadRequestException when at least one parameter is truthy", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const falsyValues = [undefined, null, ""];
      const truthyValues = ["test", "   ", "0", "false"];

      // Test with one truthy value
      for (const truthyValue of truthyValues) {
        for (const falsyValue of falsyValues) {
          // Test truthy projectId
          const result1 = await controller.getStorageAndJobsOverview(
            truthyValue,
            falsyValue,
            falsyValue,
          );
          expect(result1).toEqual(mockOverviewData);

          // Test truthy configId
          const result2 = await controller.getStorageAndJobsOverview(
            falsyValue,
            truthyValue,
            falsyValue,
          );
          expect(result2).toEqual(mockOverviewData);

          // Test truthy jobConfigId
          const result3 = await controller.getStorageAndJobsOverview(
            falsyValue,
            falsyValue,
            truthyValue,
          );
          expect(result3).toEqual(mockOverviewData);
        }
      }
    });
  });

  describe("Complete branch coverage tests", () => {
    it("should test the exact boolean logic of the validation condition", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      // Test (!projectId && !configId && !jobConfigId) === false scenarios

      // Scenario 1: !projectId = false, !configId = true, !jobConfigId = true
      const result1 = await controller.getStorageAndJobsOverview(
        "truthy", // !projectId = false
        "", // !configId = true
        "", // !jobConfigId = true
      );
      expect(result1).toEqual(mockOverviewData);

      // Scenario 2: !projectId = true, !configId = false, !jobConfigId = true
      const result2 = await controller.getStorageAndJobsOverview(
        "", // !projectId = true
        "truthy", // !configId = false
        "", // !jobConfigId = true
      );
      expect(result2).toEqual(mockOverviewData);

      // Scenario 3: !projectId = true, !configId = true, !jobConfigId = false
      const result3 = await controller.getStorageAndJobsOverview(
        "", // !projectId = true
        "", // !configId = true
        "truthy", // !jobConfigId = false
      );
      expect(result3).toEqual(mockOverviewData);

      // Scenario 4: !projectId = false, !configId = false, !jobConfigId = true
      const result4 = await controller.getStorageAndJobsOverview(
        "truthy", // !projectId = false
        "truthy", // !configId = false
        "", // !jobConfigId = true
      );
      expect(result4).toEqual(mockOverviewData);

      // Scenario 5: !projectId = false, !configId = true, !jobConfigId = false
      const result5 = await controller.getStorageAndJobsOverview(
        "truthy", // !projectId = false
        "", // !configId = true
        "truthy", // !jobConfigId = false
      );
      expect(result5).toEqual(mockOverviewData);

      // Scenario 6: !projectId = true, !configId = false, !jobConfigId = false
      const result6 = await controller.getStorageAndJobsOverview(
        "", // !projectId = true
        "truthy", // !configId = false
        "truthy", // !jobConfigId = false
      );
      expect(result6).toEqual(mockOverviewData);

      // Scenario 7: !projectId = false, !configId = false, !jobConfigId = false
      const result7 = await controller.getStorageAndJobsOverview(
        "truthy", // !projectId = false
        "truthy", // !configId = false
        "truthy", // !jobConfigId = false
      );
      expect(result7).toEqual(mockOverviewData);
    });

    it("should test the exact boolean logic that triggers the exception", async () => {
      // Test (!projectId && !configId && !jobConfigId) === true scenario

      // Scenario 8: !projectId = true, !configId = true, !jobConfigId = true
      await expect(
        controller.getStorageAndJobsOverview(
          "", // !projectId = true
          "", // !configId = true
          "", // !jobConfigId = true
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getStorageAndJobsOverview(
          null, // !projectId = true
          null, // !configId = true
          null, // !jobConfigId = true
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getStorageAndJobsOverview(
          undefined, // !projectId = true
          undefined, // !configId = true
          undefined, // !jobConfigId = true
        ),
      ).rejects.toThrow(BadRequestException);

      // Mixed falsy values
      await expect(
        controller.getStorageAndJobsOverview(
          "", // !projectId = true
          null, // !configId = true
          undefined, // !jobConfigId = true
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getStorageAndJobsOverview(
          null, // !projectId = true
          "", // !configId = true
          undefined, // !jobConfigId = true
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getStorageAndJobsOverview(
          undefined, // !projectId = true
          "", // !configId = true
          null, // !jobConfigId = true
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle service method parameters correctly", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      // Test that all parameters are passed correctly to the service
      await controller.getStorageAndJobsOverview(
        "project-123",
        "config-456",
        "job-789",
      );

      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "project-123",
        "config-456",
        "job-789",
      );
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledTimes(
        1,
      );
    });

    it("should handle async/await flow correctly", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      const resultPromise = controller.getStorageAndJobsOverview(
        "project-123",
        undefined,
        undefined,
      );

      // Verify it returns a promise
      expect(resultPromise).toBeInstanceOf(Promise);

      // Verify the resolved value
      const result = await resultPromise;
      expect(result).toEqual(mockOverviewData);
    });

    it("should handle service method return value correctly", async () => {
      const customData = {
        storageDetails: {
          totalDiscoveredSize: "2.4 GiB",
          totalMigratedSize: "1.6 GiB",
          totalPendingSize: "800 MiB",
          totalFileServers: 10,
        },
        jobDetails: {
          totalDiscoverJobs: 20,
          totalMigrateJobs: 16,
          totalCutoverJobs: 4,
        },
        lastRefreshed: new Date(),
      };

      overviewService.getStorageAndJobsOverview.mockResolvedValue(customData);

      const result = await controller.getStorageAndJobsOverview(
        "project-123",
        undefined,
        undefined,
      );

      expect(result).toEqual(customData);
      expect(result).not.toEqual(mockOverviewData);
    });
  });

  describe("Method behavior and execution flow", () => {
    it("should execute validation before service call", async () => {
      // This test ensures that validation happens before the service is called
      const serviceCallOrder: string[] = [];

      overviewService.getStorageAndJobsOverview.mockImplementation(
        async (...args) => {
          serviceCallOrder.push("service-called");
          return mockOverviewData;
        },
      );

      // Valid parameters - should call service
      await controller.getStorageAndJobsOverview(
        "project-123",
        undefined,
        undefined,
      );

      expect(serviceCallOrder).toContain("service-called");
      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalled();

      // Reset for next test
      serviceCallOrder.length = 0;
      jest.clearAllMocks();

      // Invalid parameters - should not call service
      try {
        await controller.getStorageAndJobsOverview(
          undefined,
          undefined,
          undefined,
        );
      } catch (error) {
        // Expected to throw
      }

      expect(serviceCallOrder).not.toContain("service-called");
      expect(overviewService.getStorageAndJobsOverview).not.toHaveBeenCalled();
    });

    it("should await service call properly", async () => {
      let serviceResolved = false;

      overviewService.getStorageAndJobsOverview.mockImplementation(
        async (...args) => {
          return new Promise((resolve) => {
            setTimeout(() => {
              serviceResolved = true;
              resolve(mockOverviewData);
            }, 10);
          });
        },
      );

      const result = await controller.getStorageAndJobsOverview(
        "project-123",
        undefined,
        undefined,
      );

      expect(serviceResolved).toBe(true);
      expect(result).toEqual(mockOverviewData);
    });

    it("should handle service method call with correct parameter order", async () => {
      overviewService.getStorageAndJobsOverview.mockResolvedValue(
        mockOverviewData,
      );

      await controller.getStorageAndJobsOverview(
        "first-param",
        "second-param",
        "third-param",
      );

      expect(overviewService.getStorageAndJobsOverview).toHaveBeenCalledWith(
        "first-param",
        "second-param",
        "third-param",
      );
    });
  });
});
