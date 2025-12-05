
import { JobType, WorkFlows } from "src/constants/enums";

const jobTypeWorkflowMap = {
    [JobType.MIGRATE]: WorkFlows.MIGRATE,
    [JobType.CUT_OVER]: WorkFlows.CUT_OVER,
    [JobType.SPEED_TEST]: WorkFlows.SPEED_TEST,
    [JobType.DISCOVER]: WorkFlows.DISCOVERY,
};

export const getWorkflowId = (jobRunId: string, JobRunType: JobType): string => 
    jobTypeWorkflowMap[JobRunType] + '-' + jobRunId;

const GENERAL_ERROR_CODES = new Set([
    'OP_GENERAL_FAILURE',
    'TASK_GENERAL_FAILURE', 
    'OP_UNKNOWN_ERROR',
    'TASK_UNKNOWN_ERROR'
]);

export const getErrorDisplayMessage = (
    errorCode: string,
    errorSystemMessage: string,
    errorDescription?: string
): string => {
    const isGeneralError = GENERAL_ERROR_CODES.has(errorCode);
    if (errorDescription && isGeneralError && !errorSystemMessage){
        return errorDescription;
    }
    return errorSystemMessage;
};
