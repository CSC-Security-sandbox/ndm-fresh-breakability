import { RedisClientType } from "redis";
import { JobConfig } from "../job-config";

import { JobManagerContext } from "./job-manager-context";
import { RedisJobManagerContext } from "./job-manager-redis";


export interface JobManagerProvider {
    buildContext(
        jobRunId: string,
        jobConfig: JobConfig,
        jobStatus: string,
    ) : Promise<JobManagerContext>

    getContext(jobRunId: string): Promise<JobManagerContext | null>;
}


export class RedisJobManagerProvider {

    constructor(private readonly redisClient: RedisClientType) {}

    async buildContext(
        jobRunId: string,
        jobConfig: JobConfig,
        jobStatus: string
    ): Promise<JobManagerContext> {
        const jobManager = new RedisJobManagerContext(this.redisClient, jobRunId, jobConfig, jobStatus);
        await jobManager.init()
        return jobManager;
    }

    async getContext(jobRunId: string): Promise<JobManagerContext> {
        const jobManager = new RedisJobManagerContext(this.redisClient, jobRunId);
        jobManager.initializeInstance()
        return jobManager
    }
}