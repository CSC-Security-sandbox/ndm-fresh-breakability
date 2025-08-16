import { BadRequestException } from "@nestjs/common";
import { JobRunActionService } from "./jobrun-action.service";
import { JobRunStatus } from "src/constants/enums";
import { JobRunActions } from "./dto/jobrunactions.dto";
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
            service.resumeJobRuns = jest.fn().mockResolvedValue("resumed");
            const req = { action: JobRunActions.RESUME, jobRuns: ["3"] };
            const result = await service.actions(req);
            expect(service.resumeJobRuns).toHaveBeenCalledWith(["3"]);
            expect(result).toBe("resumed");
        });

        it("should throw BadRequestException for invalid action", async () => {
            const req = { action: "INVALID", jobRuns: ["4"] };
            await expect(service.actions(req as any)).rejects.toThrow(BadRequestException);
        });
    });

    describe("signalJobRuns", () => {
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
            }as any);
            expect(result[0].status).toBe("fulfilled");
        });
    });

    describe("resumeJobRuns", () => {
        it("should resume all job runs successfully", async () => {
            const jobRuns = [{ id: "1", workFlowId: "wf1" }];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            jobRunRepo.update.mockResolvedValue(undefined);
            workFlowService.sendSignal.mockResolvedValue(undefined);
            const result = await service.resumeJobRuns(["1"]);
            expect(jobRunRepo.find).toHaveBeenCalledWith({ where: { id: expect.anything() }, select: ["id", "workFlowId"] });
            expect(jobRunRepo.update).toHaveBeenCalledWith(["1"], { status: JobRunStatus.Running });
            expect(result[0].status).toBe("fulfilled");

        });

        it("should handle signal failure on resume", async () => {
            const jobRuns = [{ id: "1", workFlowId: "wf1" }];
            jobRunRepo.find.mockResolvedValue(jobRuns);
            jobRunRepo.update.mockResolvedValue(undefined);
            workFlowService.sendSignal.mockRejectedValue(new Error("fail"));
            const result = await service.resumeJobRuns(["1"]);
            expect(result[0].status).toBe("fulfilled");
        });
    });
});