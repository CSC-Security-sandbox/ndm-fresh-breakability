import { JobManagerContext, Task, TaskInfo, TaskStatus } from "@netapp-cloud-datamigrate/jobs-lib";


export interface SyncTaskInput {
    jobRunId: string,
    taskId: string;
}


export interface SyncTaskOutput {
    errors: {
        source: string[]
        target: string[]
    };
    status: TaskStatus;
    error: number,
}


export interface handleSyncTaskUpdateInput {
    taskHashId: string;
    jobContext: JobManagerContext;
    errors: {
        source: string[];
        target: string[];
    }
    task: TaskInfo,
}




export interface InitTaskInput {
    task: TaskInfo;
    jobContext: JobManagerContext;
}
