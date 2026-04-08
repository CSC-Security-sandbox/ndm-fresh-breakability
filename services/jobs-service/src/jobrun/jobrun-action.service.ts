import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { JobRunStatus } from "src/constants/enums";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { WorkflowService } from "src/workflow/workflow.service";
import { SignalWorkFlowPayload } from "src/workflow/workflow.types";
import { In, Repository } from "typeorm";
import { JobRunActions, JobRunActionsReq } from "./dto/jobrunactions.dto";
import { SignalJobRunsInput } from "./jobrun-action.type";
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class JobRunActionService {
    // Helper for RESUME: filter paused job runs and collect invalid IDs
    private async getPausedJobRuns(jobRunIds: string[]): Promise<{ paused: JobRunEntity[], invalid: string[] }> {
        const jobRuns = await this.jobRunRepo.find({ where: {
            id: In(jobRunIds),
            status: JobRunStatus.Paused
        }, select: ["id", "workFlowId"] });
        const pausedIds = jobRuns.map(jr => jr.id);
        const invalidIds = jobRunIds.filter(id => !pausedIds.includes(id));
        return { paused: jobRuns, invalid: invalidIds };
    }
    private readonly logger: LoggerService;

    constructor(
        @InjectRepository(JobRunEntity)
        private jobRunRepo: Repository<JobRunEntity>,
        private workFlowService: WorkflowService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ){
        this.logger = loggerFactory.create(JobRunActionService.name);
    }

    //  ------------------- JobRun actions ------------------ //
    async actions(jobRunActions: JobRunActionsReq) {
        switch (jobRunActions.action) {
            case JobRunActions.PAUSE: {
                const jobRuns = await this.jobRunRepo.find({ where: {
                    id: In(jobRunActions.jobRuns), 
                    status: In([JobRunStatus.Running, JobRunStatus.Ready])
                }, select: ["id", "workFlowId"]});
                return await this.signalJobRuns({
                    jobRuns,
                    progressingStatus: JobRunStatus.Pausing,
                    signalStatus: JobRunStatus.Paused
                 });
                }
            case JobRunActions.STOP: {
                 const jobRuns = await this.jobRunRepo.find({ where: {
                    id: In(jobRunActions.jobRuns), 
                    status: In([JobRunStatus.Paused, JobRunStatus.Running, JobRunStatus.Ready, JobRunStatus.Pausing, JobRunStatus.Pending, JobRunStatus.Stopping])
                }, select: ["id", "workFlowId"]});
                return await this.signalJobRuns({
                    jobRuns,
                    progressingStatus: JobRunStatus.Stopping,
                    signalStatus: JobRunStatus.Stopped
                 });
                }
            case JobRunActions.RESUME: {
                // filter paused job runs and handle errors
                const { paused, invalid } = await this.getPausedJobRuns(jobRunActions.jobRuns);
                if (paused.length === 0) {
                    throw new BadRequestException("No paused job runs found to resume.");
                }
                const resumeResults = await this.resumeJobRuns(paused.map(jr => jr.id));
                if (invalid.length > 0) {
                    return {
                        items: resumeResults,
                        errors: invalid.map(id => ({
                            jobRunId: id,
                            error: "Cannot resume job run unless status is Paused."
                        }))
                    };
                }
                return resumeResults;
            }
            default:
                throw new BadRequestException("Invalid Action Type");
        }    
    }

    async signalJobRuns({jobRuns, progressingStatus, signalStatus}: SignalJobRunsInput) {
        return await Promise.allSettled(
            jobRuns.map(async (jobRun) => {
                const signal: SignalWorkFlowPayload = {
                    payload: signalStatus,
                    signalName: "action",
                    workflowId: jobRun.workFlowId
                };
                 try{
                    await this.workFlowService.sendSignal(signal);
                    await this.jobRunRepo.update(jobRun.id, {
                        status: progressingStatus,
                    });
                    return {details: "Operation Successful for jobRun: " + jobRun.id, status: "fulfilled"};
                }catch (error) {
                    this.logger.error(`Failed to send signal to workflow ${jobRun.workFlowId}: ${error.message}`); 
                    return {details: "Operation Failed for jobRun: " + jobRun.id, status: "rejected"};
                }  
            })
        );
    }

    async resumeJobRuns(jobRunIds: string[]) {
        const jobRuns = await this.jobRunRepo.find({ where: { id: In(jobRunIds) }, select: ["id", "workFlowId"]});
        await this.jobRunRepo.update(jobRunIds, {
            status: JobRunStatus.Running,
        });
        return await Promise.allSettled(
            jobRuns.map(async (jobRun) => {
                const signal: SignalWorkFlowPayload = {
                    payload: JobRunStatus.Running,
                    signalName: "action",
                    workflowId: jobRun.workFlowId
                };
                try{
                    await this.workFlowService.sendSignal(signal);
                    return {details: "Operation Successful for jobRun: " + jobRun.id, status: "fulfilled"};
                }catch (error) {
                    this.logger.error(`Failed to send signal to workflow ${jobRun.workFlowId}: ${error.message}`); 
                    return {details: "Operation Failed for jobRun: " + jobRun.id, status: "rejected"};
                }  
            })
        );
    }

}