
import { JobType, WorkFlows } from "src/constants/enums";

const jobTypeWorkflowMap = {
    [JobType.MIGRATE]: WorkFlows.MIGRATE,
    [JobType.CUT_OVER]: WorkFlows.CUT_OVER,
    [JobType.SPEED_TEST]: WorkFlows.SPEED_TEST,
    [JobType.DISCOVER]: WorkFlows.DISCOVERY,
};

export const getWorkflowId = (jobRunId: string, JobRunType: JobType): string => 
    jobTypeWorkflowMap[JobRunType] + '-' + jobRunId;