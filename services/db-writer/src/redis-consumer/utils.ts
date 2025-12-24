
import { RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib/dist/redis/redis-utils';
import { WorkFlows } from '../enum/redis-consumer.enum';

export const getWorkflowId = (jobRunId: string, jobType: string) => {
    if (jobType === 'CUT_OVER') return `${WorkFlows.CUT_OVER}-${jobRunId}`;
    if (jobType === 'MIGRATE') return `${WorkFlows.MIGRATE}-${jobRunId}`;
    if (jobType === 'PRECHECK') return `${WorkFlows.PRECHECK}-${jobRunId}`;
    if (jobType === 'RETRY') return `${WorkFlows.RETRY}-${jobRunId}`;
    return `${WorkFlows.DISCOVERY}-${jobRunId}`;
}

export type ReaderStatus = 'active' | 'inactive';


export interface FileConsumerContext {
    jobRunId: string;
    pathId: string;
    records: any[];
    flushTimer: NodeJS.Timeout | null;
    errorRecoveryTimers?: Set<NodeJS.Timeout>; // Track error recovery timers
}