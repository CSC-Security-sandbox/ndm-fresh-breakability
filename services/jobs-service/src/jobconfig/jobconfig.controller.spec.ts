import { Test, TestingModule } from "@nestjs/testing";
import { JobConfigController } from "./jobconfig.controller";
import { JobConfigService } from "./jobconfig.service";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { BulkMigrateJobConfig, MigrateConfig } from "./dto/bulkMigrateJob.dto";
import {
  JobConfigDiscoverBulk,
  JobConfigPrecheck,
} from "./dto/jobdicoverybulk.dto";
import { JobConfigBulkMigrateFinalResponse } from "./jobconfig.types";
import { Response } from "express";
import {
  JobConfigBulkMigrateResStatus,
  JobType,
  TemplateType,
} from "src/constants/enums";
import { JobConfigSpeedTest } from "./dto/jobspeedTest.dto";
import { SpeedTestConfigEntity } from "src/entities/speed-test-job-config.entity";
import { PreCheckService } from "./precheck.service";
import { JwtAuthGuard, JwtService } from '@netapp-cloud-datamigrate/auth-lib';

describe("JobConfigController", () => {
  let controller: JobConfigController;
  let service: JobConfigService;
  let preCheckService:PreCheckService

  const mockPreCheckService = {
    initiatePreCheck: jest.fn(),
    precheckValidation: jest.fn(),
  };
  const mockJobConfigService = {
    createBulkDiscovery: jest.fn(),
    createBulkMigrate: jest.fn(),
    createBulkCutover: jest.fn(),
    precheck: jest.fn(),
    getAllJobConfig: jest.fn(),
    getJobConfigById: jest.fn(),
    initiatePreCheck: jest.fn(),
    getConfigsByProjectId: jest.fn(),
    updateJobConfig: jest.fn(),
    deleteJobConfig: jest.fn(),
    getTemplateFilename: jest.fn(),
    sendCsvFile: jest.fn(),
    getNoticeBoardDetailsByProjectId: jest.fn(),
    precheckValidation: jest.fn(),
    createSpeedTest: jest.fn(),
  };

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ['permission1', 'permission2'],
            projects: ['project1'],
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
      controllers: [JobConfigController],
      providers: [
        {
          provide: JobConfigService,
          useValue: mockJobConfigService,
        },
        {
        provide: PreCheckService,
        useValue: mockPreCheckService,
      },
       
        {
          provide: "JobConfigRepository",
          useValue: {},
        },
        {
          provide: "JobRunRepository",
          useValue: {},
        },
        {
          provide: "InventoryRepository",
          useValue: {},
        },
        {
          provide: "VolumeRepository",
          useValue: {},
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        JwtAuthGuard,
      ],
    }).compile();

    controller = module.get<JobConfigController>(JobConfigController);
    service = module.get<JobConfigService>(JobConfigService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("createBulkDiscovery", () => {
    it("should throw BadRequestException if payload is invalid", async () => {
      const payload = new JobConfigDiscoverBulk();
      payload.sourcePathIds = [];
      await expect(controller.createBulkDiscovery(payload)).rejects.toThrow(
        BadRequestException
      );
    });

    describe("createBulkMigrate", () => {
      it("should create a new migrate job", async () => {
        const bulkMigrate: BulkMigrateJobConfig = {
          firstRunAt: new Date(),
          futureRunSchedule: "2023-12-31T12:00:00Z",
          migrateConfigs: [
            {
              sourcePathId: "550e8400-e29b-41d4-a716-446655440000",
              destinationPathId: ["550e8400-e29b-41d4-a716-446655440001"],
            },
          ],
          options: {
            excludeOlderThan: new Date("2023-01-01"),
            excludeFilePatterns: ".*.tmp",
            preserveAccessTime: true,
            skipFile: "",
          },
          sidMapping: undefined,
          gidMapping: undefined,
        };
      
        const result: JobConfigBulkMigrateFinalResponse = {
          jobs: [
            {
              id: "1",
              jobType: JobType.MIGRATE,
              status: JobConfigBulkMigrateResStatus.CREATED,
              sourcePathId: bulkMigrate.migrateConfigs[0].sourcePathId,
              targetPathId: bulkMigrate.migrateConfigs[0].destinationPathId[0],
            },
          ],
        };
      
        jest.spyOn(service, "createBulkMigrate").mockResolvedValue(result);
      
        const response = await controller.createBulkMigrate(bulkMigrate);
      
        expect(response).toEqual(result);
        expect(service.createBulkMigrate).toHaveBeenCalledWith(bulkMigrate);
      });
      

      it("should throw BadRequestException if validation fails", async () => {
        const bulkMigrate: BulkMigrateJobConfig = {
          firstRunAt: new Date(),
          futureRunSchedule: "2023-12-31T12:00:00Z",
          migrateConfigs: [
            {
              sourcePathId: "550e8400-e29b-41d4-a716-446655440000",
              destinationPathId: ["550e8400-e29b-41d4-a716-446655440000"], // Invalid case for testing
            },
          ],
          options: {
            excludeOlderThan: new Date("2023-01-01"),
            excludeFilePatterns: ".*.tmp",
            preserveAccessTime: true,
            skipFile: "",
          },
          sidMapping: undefined,
          gidMapping: undefined,
        };

        jest.spyOn(service, "createBulkMigrate").mockImplementation(() => {
          throw new BadRequestException("Invalid migration configuration");
        });

        await expect(controller.createBulkMigrate(bulkMigrate)).rejects.toThrow(
          BadRequestException
        );
        await expect(controller.createBulkMigrate(bulkMigrate)).rejects.toThrow(
          "Invalid migration configuration"
        );
      });

      // describe('precheck', () => {
      //   it('should return precheck result', async () => {
      //     const precheckDto: JobConfigPrecheck = { migrateConfigs: [{ sourcePathId: '', destinationPathId: [''] }], preserveAccessTime: true, trackId:"1111-2222-3333-4444" };
      //     const response: JobConfigPrecheckRes = { status: 'success' };
      //     mockJobConfigService.precheck.mockResolvedValue(response);
      //     const res = await controller.precheck(precheckDto);
      //     expect(res).toEqual(response);
      //     expect(service.precheck).toHaveBeenCalledWith(precheckDto);
      //   });
      // });

      describe("getAllJobConfig", () => {
        it("should return job listings", async () => {
          const mockJobs = [
            {
              jobConfigId: "1",
              configName: "Test",
              jobType: "DISCOVER",
              jobStatus: "ACTIVE",
            },
          ];
          mockJobConfigService.getAllJobConfig.mockResolvedValue(mockJobs);

          expect(await controller.getAllJobConfig("123")).toEqual(mockJobs);
        });

        it("should throw BadRequestException if projectId is missing", async () => {
          await expect(controller.getAllJobConfig(null)).rejects.toThrow(
            BadRequestException
          );
        });
      });

      describe("downloadTemplate", () => {
        it("should download template successfully", async () => {
          const res = {} as Response; // Mocking the Response object
          const type: TemplateType = TemplateType.SID; // Assuming sid is a valid TemplateType

          jest
            .spyOn(service, "getTemplateFilename")
            .mockReturnValue("template.csv");
          jest.spyOn(service, "sendCsvFile").mockImplementation(() => {});

          await controller.downloadTemplate(res, type);

          expect(service.getTemplateFilename).toHaveBeenCalledWith(type);
          expect(service.sendCsvFile).toHaveBeenCalledWith("template.csv", res);
        });

        it("should throw BadRequestException if type is not provided", async () => {
          const res = {} as Response;

          await expect(
            controller.downloadTemplate(res, undefined)
          ).rejects.toThrow(BadRequestException);
          await expect(
            controller.downloadTemplate(res, undefined)
          ).rejects.toThrow("Either sid, gid, or uid type is required");
        });

        it("should throw BadRequestException if type is invalid", async () => {
          const res = {} as Response;
          const invalidType = "invalid-type" as TemplateType; // Simulating an invalid type

          await expect(
            controller.downloadTemplate(res, invalidType)
          ).rejects.toThrow(BadRequestException);
          await expect(
            controller.downloadTemplate(res, invalidType)
          ).rejects.toThrow("Invalid type");
        });
      });

      describe("updateJobConfig", () => {
        it("should update a job", async () => {
          const jobConfig = { jobConfigId: "1", status: "ACTIVE" } as any;
          mockJobConfigService.updateJobConfig.mockResolvedValue(jobConfig);

          expect(await controller.updateJobConfig("1", jobConfig)).toEqual(
            jobConfig
          );
          expect(service.updateJobConfig).toHaveBeenCalledWith("1", jobConfig);
        });
      });

      describe("deleteJobConfig", () => {
        it("should delete a job and return a success message", async () => {
          mockJobConfigService.deleteJobConfig.mockResolvedValue({
            message: "Deleted",
          });

          expect(await controller.deleteJobConfig("1")).toEqual({
            message: "Deleted",
          });
          expect(service.deleteJobConfig).toHaveBeenCalledWith("1");
        });
      });
    });
    // it("should return the result of precheck validation", async () => {
    //   const precheckData: JobConfigPrecheck = {
    //     migrateConfigs: [{ sourcePathId: "123", destinationPathId: ["456"] }],
    //     preserveAccessTime: true,
    //     options: {
    //       workflowExecutionTimeout: "300",
    //       workflowTaskTimeout: "60",
    //       workflowRunTimeout: "600",
    //       startDelay: "10",
    //     }, // Add appropriate options here based on the JobConfigPrecheck definition
    //   };
    //   const expectedResult: any = { workflowId: "133" };

    //   mockJobConfigService.initiatePreCheck.mockResolvedValue(expectedResult);

    //   const result = await controller.precheck(precheckData);
    //    console.log("result", result);
    //   expect(result).toEqual(expectedResult);
    //   expect(preCheckService.initiatePreCheck).toHaveBeenCalledWith(precheckData);
    // });
    it("should return the result of precheck validation", async () => {
    const precheckData: JobConfigPrecheck = {
      migrateConfigs: [{ sourcePathId: "123", destinationPathId: ["456"] }],
      preserveAccessTime: true,
      options: {
        workflowExecutionTimeout: "300",
        workflowTaskTimeout: "60",
        workflowRunTimeout: "600",
        startDelay: "10",
      },
    };

    const expectedResult = { workflowId: "133" };

    mockPreCheckService.initiatePreCheck.mockResolvedValue(expectedResult);

    const result = await controller.precheck(precheckData);

    expect(result).toEqual(expectedResult);
    expect(mockPreCheckService.initiatePreCheck).toHaveBeenCalledWith(precheckData);
});

    describe("checkCommonWorkersAndValidatePaths", () => {
      it("should return the result of precheck validation", async () => {
        const precheckData: MigrateConfig[] = [
          { sourcePathId: "123", destinationPathId: ["456"] },
          { sourcePathId: "789", destinationPathId: ["012"] },
        ];
        const expectedResult: any[] = [{ success: true }];

        mockJobConfigService.precheckValidation.mockResolvedValue(
          expectedResult
        );
        const result =
          await controller.checkCommonWorkersAndValidatePaths(precheckData);

        expect(result).toEqual(expectedResult);
        expect(service.precheckValidation).toHaveBeenCalledWith(precheckData);
      });
    });
    describe("createSpeedTest with bad data", () => {
      it("should throw BadRequestException if speedTests is empty", async () => {
        const speedTest: JobConfigSpeedTest = {
          speedTests: [],
          firstRunAt: new Date(),
        };
        await expect(controller.createSpeedTest(speedTest)).rejects.toThrow(
          BadRequestException
        );
        await expect(controller.createSpeedTest(speedTest)).rejects.toThrow(
          "Source path IDs cannot be empty."
        );
      });

      it("should call service.createSpeedTest and return the result", async () => {
        const speedTest = { speedTests: [{ id: 1 }] };
        const mockResult = [new SpeedTestConfigEntity()];
        jest.spyOn(service, "createSpeedTest").mockResolvedValue(mockResult);

        const result = await controller.createSpeedTest(speedTest as any);

        expect(service.createSpeedTest).toHaveBeenCalledWith(speedTest);
        expect(result).toEqual(mockResult);
      });
    });
  });

  it("should throw a BadRequestException for an invalid project ID", async () => {
    const invalidProjectId = "";

    jest
      .spyOn(service, "getNoticeBoardDetailsByProjectId")
      .mockImplementation(() => {
        throw new BadRequestException("Invalid project ID");
      });

    await expect(
      controller.getNoticeBoardDetailsByProjectId(invalidProjectId)
    ).rejects.toThrow(BadRequestException);

    expect(service.getNoticeBoardDetailsByProjectId).toHaveBeenCalledWith(
      invalidProjectId
    );
  });

  it("should throw a NotFoundException if notice board details are not found", async () => {
    const mockProjectId = "nonExistentProjectId";

    jest
      .spyOn(service, "getNoticeBoardDetailsByProjectId")
      .mockImplementation(() => {
        throw new NotFoundException("Notice board not found");
      });

    await expect(
      controller.getNoticeBoardDetailsByProjectId(mockProjectId)
    ).rejects.toThrow(NotFoundException);

    expect(service.getNoticeBoardDetailsByProjectId).toHaveBeenCalledWith(
      mockProjectId
    );
  });

  it("should handle internal server errors", async () => {
    const mockProjectId = "projectId123";

    jest
      .spyOn(service, "getNoticeBoardDetailsByProjectId")
      .mockImplementation(() => {
        throw new Error("Internal server error");
      });

    await expect(
      controller.getNoticeBoardDetailsByProjectId(mockProjectId)
    ).rejects.toThrow(Error);

    expect(service.getNoticeBoardDetailsByProjectId).toHaveBeenCalledWith(
      mockProjectId
    );
  });
});
