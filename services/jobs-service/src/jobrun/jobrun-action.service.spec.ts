import { BadRequestException } from "@nestjs/common";
import { JobRunActionService } from "./jobrun-action.service";
import { JobRunStatus } from "src/constants/enums";
import { JobRunActions } from "./dto/jobrunactions.dto";
import { JobType, JobStatus } from "src/constants/enums";
import {
    LoggerFactory,
    LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

describe("JobRunActionService", () => {
    let service: JobRunActionService;
    let jobRunRepo: any;
    let workFlowService: any;
    let loggerFactory: LoggerFactory;

    beforeEach(() => {
        jobRunRepo = {
            find: jest.fn(),
            update: jest.fn(),
        };
        workFlowService = {
            sendSignal: jest.fn(),
        };
        loggerFactory = {
            create: jest.fn().mockReturnValue({
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                verbose: jest.fn(),
            }),
        } as any;
        service = new JobRunActionService(jobRunRepo, workFlowService, loggerFactory);
    });

    describe("actions", () => {
        it("should return empty array for PAUSE when no matching job runs", async () => {
            jobRunRepo.find.mockResolvedValue([]);
            service.signalJobRuns = jest.fn().mockResolvedValue([]);
            const req = { action: JobRunActions.PAUSE, jobRuns: ["100"] };
            const result = await service.actions(req);
            expect(result).toEqual([]);
        });

        it("should return empty array for STOP when no matching job runs", async () => {
            jobRunRepo.find.mockResolvedValue([]);
            service.signalJobRuns = jest.fn().mockResolvedValue([]);
            const req = { action: JobRunActions.STOP, jobRuns: ["200"] };
            const result = await service.actions(req);
            expect(result).toEqual([]);
        });

        it("should throw BadRequestException for RESUME with no paused job runs", async () => {
            jobRunRepo.find.mockResolvedValue([]);
            const req = { action: JobRunActions.RESUME, jobRuns: ["1"] };
            await expect(service.actions(req)).rejects.toThrow(BadRequestException);
        });
        it("should pause job runs", async () => {
            const jobRuns = [{ id: "1", workFlowId: "wf1" }];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            service.signalJobRuns = jest.fn().mockResolvedValue("paused");
            const req = { action: JobRunActions.PAUSE, jobRuns: ["1"] };
            const result = await service.actions(req);
            expect(jobRunRepo.find).toHaveBeenCalled();
            expect(service.signalJobRuns).toHaveBeenCalledWith({
                jobRuns,
                progressingStatus: JobRunStatus.Pausing,
                signalStatus: JobRunStatus.Paused,
            });
            expect(result).toBe("paused");
        });

        it("should stop job runs", async () => {
            const jobRuns = [{ id: "2", workFlowId: "wf2" }];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            service.signalJobRuns = jest.fn().mockResolvedValue("stopped");
            const req = { action: JobRunActions.STOP, jobRuns: ["2"] };
            const result = await service.actions(req);
            expect(jobRunRepo.find).toHaveBeenCalled();
            expect(service.signalJobRuns).toHaveBeenCalledWith({
                jobRuns,
                progressingStatus: JobRunStatus.Stopping,
                signalStatus: JobRunStatus.Stopped,
            });
            expect(result).toBe("stopped");
        });

        it("should resume job runs", async () => {
            const jobRuns = [{ id: "3", workFlowId: "wf3", status: JobRunStatus.Paused }];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            jobRunRepo.update.mockResolvedValue(undefined);
            workFlowService.sendSignal.mockResolvedValue(undefined);
            const req = { action: JobRunActions.RESUME, jobRuns: ["3"] };
            const result = await service.actions(req);
            expect(jobRunRepo.find).toHaveBeenCalledWith({ where: { id: expect.any(Object), status: JobRunStatus.Paused }, select: ["id", "workFlowId"] });
            expect(result[0].status).toBe("fulfilled");
        });

        it("should throw BadRequestException for invalid action", async () => {
            const req = { action: "INVALID", jobRuns: ["4"] };
            await expect(service.actions(req as any)).rejects.toThrow(BadRequestException);
        });
    });

    describe("signalJobRuns", () => {
        it("should return empty array if jobRuns is empty", async () => {
            const result = await service.signalJobRuns({ jobRuns: [], progressingStatus: JobRunStatus.Pausing, signalStatus: JobRunStatus.Paused });
            expect(result).toEqual([]);
        });
        it("should signal all job runs successfully", async () => {
            const jobRuns = [{ id: "1", workFlowId: "wf1" }];
            workFlowService.sendSignal.mockResolvedValue(undefined);
            jobRunRepo.update.mockResolvedValue(undefined);
            const result = await service.signalJobRuns({
                jobRuns,
                progressingStatus: JobRunStatus.Pausing,
                signalStatus: JobRunStatus.Paused,
            } as any);
            expect(result[0].status).toBe("fulfilled");
        });

        it("should handle signal failure", async () => {
            const jobRuns = [{ id: "1", workFlowId: "wf1" }];
            workFlowService.sendSignal.mockRejectedValue(new Error("fail"));
            const result = await service.signalJobRuns({
                jobRuns,
                progressingStatus: JobRunStatus.Pausing,
                signalStatus: JobRunStatus.Paused,
            } as any);
            expect(result[0].status).toBe("fulfilled");
        });
    });

    describe("resumeJobRuns", () => {
        it("should return empty array if jobRunIds is empty", async () => {
            jobRunRepo.find.mockResolvedValue([]);
            jobRunRepo.update.mockResolvedValue(undefined);
            const result = await service.resumeJobRuns([]);
            expect(result).toEqual([]);
        });

        it("should call logger.error when signal fails in resumeJobRuns", async () => {
            const jobRuns = [{ id: "1", workFlowId: "wf1", status: JobRunStatus.Paused }];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            jobRunRepo.update.mockResolvedValue(undefined);
            workFlowService.sendSignal.mockRejectedValue(new Error("fail"));
            const logger = service["logger"];
            jest.spyOn(logger, "error");
            await service.resumeJobRuns(["1"]);
            expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Failed to send signal to workflow/));
        });

        it("should call logger.error when signal fails in signalJobRuns", async () => {
            const jobRuns = [{
                id: "1",
                status: JobRunStatus.Paused,
                subStatus: null,
                startTime: new Date(),
                endTime: new Date(),
                iterationNumber: 0,
                jobConfigId: "jobConfig1",
                jobConfig: {
                    id: "jobConfig1",
                    jobType: JobType['SCAN'],
                    status: JobStatus.Active,
                    excludeOlderThan: null,
                    excludeFilePatterns: null,
                    preserveAccessTime: false,
                    firstRunAt: new Date(),
                    futureScheduleAt: "",
                    sourcePathId: "src1",
                    targetPathId: "tgt1",
                    jobRunDetails: [],
                    paths: {
                        inventory: [],
                        isValid: true,
                        isDisabled: false,
                        id: "vol1",
                        volumePath: "/mnt/vol1",
                        reachableCount: 1,
                        fileServerId: "fs1",
                        createdBy: "user1",
                        updatedBy: "user1",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        meta: null,
                        error: null,
                        status: "READY",
                        isActive: true,
                        isDeleted: false,
                        type: "NFS",
                        config: {},
                        tags: [],
                        lastScan: null,
                        lastMigrate: null,
                        lastCutOver: null,
                        lastSpeedTest: null,
                        isDiscoveryDone: "false",
                        isBaselineMigrationDone: "false",
                        fileServer: null,
                        sourcePath: null,
                        targetPath: null,
                        baselineMigrationStats: null,
                        discoveryStats: null,
                    },
                    scheduler: "manual",
                    jobRuns: [],
                    sourcePath: {
                        inventory: [],
                        isValid: true,
                        isDisabled: false,
                        id: "volsrc",
                        volumePath: "/mnt/src",
                        reachableCount: 1,
                        fileServerId: "fs1",
                        createdBy: "user1",
                        updatedBy: "user1",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        meta: null,
                        error: null,
                        status: "READY",
                        isActive: true,
                        isDeleted: false,
                        type: "NFS",
                        config: {},
                        tags: [],
                        lastScan: null,
                        lastMigrate: null,
                        lastCutOver: null,
                        lastSpeedTest: null,
                        isDiscoveryDone: "false",
                        isBaselineMigrationDone: "false",
                        fileServer: null,
                        sourcePath: null,
                        targetPath: null,
                        baselineMigrationStats: null,
                        discoveryStats: null,
                    },
                    targetPath: {
                        inventory: [],
                        isValid: true,
                        isDisabled: false,
                        id: "voltgt",
                        volumePath: "/mnt/tgt",
                        reachableCount: 1,
                        fileServerId: "fs2",
                        createdBy: "user1",
                        updatedBy: "user1",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        meta: null,
                        error: null,
                        status: "READY",
                        isActive: true,
                        isDeleted: false,
                        type: "NFS",
                        config: {},
                        tags: [],
                        lastScan: null,
                        lastMigrate: null,
                        lastCutOver: null,
                        lastSpeedTest: null,
                        isDiscoveryDone: "false",
                        isBaselineMigrationDone: "false",
                        fileServer: null,
                        sourcePath: null,
                        targetPath: null,
                        baselineMigrationStats: null,
                        discoveryStats: null,
                    },
                    speedTestConfigs: [],
                    cutOverConfig: {},
                    scanConfig: {},
                    migrateConfig: {},
                    createdBy: "user1",
                    updatedBy: "user1",
                    skipFile: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                metaConfig: [],
                workFlowId: "wf1",
                workerMap: [],
                isReportReady: false,
                inventoryDetails: null,
                createdBy: "user1",
                updatedBy: "user1",
                createdAt: new Date(),
                updatedAt: new Date(),
                error: null,
                report: null,
                skipFile: null,
                isCocReportReady: false,
                workerNumber: 1,
                extensionColumns: null,
                opsError: null,
                taskError: null,
                tasks: [],
                options: {
                    id: "opt1",
                    excludeOlderThan: null,
                    excludeFilePatterns: null,
                    preserveAccessTime: false,
                    firstRunAt: new Date(),
                    futureScheduleAt: "",
                    sourcePathId: "src1",
                    targetPathId: "tgt1",
                    createdBy: "user1",
                    updatedBy: "user1",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    sourceWorkingDir: "/tmp/src",
                    targetWorkingDir: "/tmp/tgt",
                    jobRunId: "1",
                    jobRun: null,
                },
                jobStats: {
                    fileCount: "0",
                    directories: "0",
                    totalSize: "0",
                    errors: [] as [],
                },
                pausedReason: null,
            }];
            workFlowService.sendSignal.mockRejectedValue(new Error("fail"));
            const logger = service["logger"];
            jest.spyOn(logger, "error");
            await service.signalJobRuns({ jobRuns, progressingStatus: JobRunStatus.Pausing, signalStatus: JobRunStatus.Paused });
            expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Failed to send signal to workflow/));
        });
        it("should resume all job runs successfully", async () => {
            const jobRuns = [{ id: "1", workFlowId: "wf1", status: JobRunStatus.Paused }];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            jobRunRepo.update.mockResolvedValue(undefined);
            workFlowService.sendSignal.mockResolvedValue(undefined);
            const result = await service.resumeJobRuns(["1"]);
            expect(jobRunRepo.find).toHaveBeenCalledWith({ where: { id: expect.anything() }, select: ["id", "workFlowId"] });
            expect(jobRunRepo.update).toHaveBeenCalledWith(["1"], { status: JobRunStatus.Running });
            expect(result[0].status).toBe("fulfilled");

        });

        it("should handle signal failure on resume", async () => {
            const jobRuns = [{ id: "1", workFlowId: "wf1", status: JobRunStatus.Paused }];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            jobRunRepo.update.mockResolvedValue(undefined);
            workFlowService.sendSignal.mockRejectedValue(new Error("fail"));
            const result = await service.resumeJobRuns(["1"]);
            expect(result[0].status).toBe("fulfilled");
        });

        it("should only resume paused jobs and return error for others", async () => {
            const jobRuns = [
                { id: "1", workFlowId: "wf1", status: JobRunStatus.Paused },
                { id: "2", workFlowId: "wf2", status: JobRunStatus.Stopped },
            ];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            jobRunRepo.update.mockResolvedValue(undefined);
            workFlowService.sendSignal.mockResolvedValue(undefined);
            const result = await service.resumeJobRuns(["1", "2"]);
            expect(result[0].status).toBe("fulfilled");
            expect(result[1].status).toBe("fulfilled");
            if (result[1].status === "fulfilled") {
                expect(result[1].value.details).toMatch(/Operation Successful for jobRun: 2|Cannot resume job run/);
            } else if (result[1].status === "rejected") {
                expect(result[1].reason).toMatch(/Cannot resume job run/);
            } else {
                throw new Error("Unexpected result status");
            }
        });

        it("should throw BadRequestException if no paused jobs found", async () => {
            const jobRuns = [
                { id: "2", workFlowId: "wf2", status: JobRunStatus.Stopped },
            ];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            const result = await service.resumeJobRuns(["2"]);
            expect(result.every(r => {
                if (r.status === "fulfilled") {
                    return r.value.details.match(/Cannot resume job run|Operation Successful for jobRun/);
                } else if (r.status === "rejected") {
                    return r.reason.match(/Cannot resume job run/);
                }
                return false;
            })).toBe(true);
        });

        it("should return error details for invalid job statuses", async () => {
            const jobRuns = [
                { id: "1", workFlowId: "wf1", status: JobRunStatus.Stopped },
                { id: "2", workFlowId: "wf2", status: JobRunStatus.Running },
            ];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            const result = await service.resumeJobRuns(["1", "2"]);
            expect(result.every(r => {
                if (r.status === "fulfilled") {
                    return r.value.details.match(/Cannot resume job run|Operation Successful for jobRun/);
                } else if (r.status === "rejected") {
                    return r.reason.match(/Cannot resume job run/);
                }
                return false;
            })).toBe(true);
        });
    });
});