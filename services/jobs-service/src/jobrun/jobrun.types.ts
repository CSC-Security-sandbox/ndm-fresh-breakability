import { JobType, Protocol } from "src/constants/enums"

export interface UpdateJobRunMappingPayload {
    jobRunId: string,
    isActive?: boolean,
    isMounted?: true,
}


interface Credential {
    protocol: Protocol,
    password?: string,
    pathId: string,
    directoryPath?: string,
    username: string,
    path:string,
    isValidPath: boolean,
    isDisabled: boolean,
    host: string,
    workingDirectory:string,
    protocolVersion: string
}

export interface JobRunConfig{
    connection: {
        sourceCredential:Credential,
        targetCredential?: Credential
    }
    jobType: JobType,
    excludeFilePatterns?: string,
    excludeOlderThan?: Date,
    preserveAccessTime: boolean,
    shouldScanADS?: boolean,
    workers: string[],
    skipFile?: string,
    skipDelete?: boolean,
    id: string,
    jobRunId?: string,  // If set, this is a retry run - skip scan and use failed items from this job run
}


export interface UnMountNotificationPayload{
    jobRunId: string
    sPathId: string,
    tPathId?: string | undefined
}

export enum WorkFlowFailureReason {
    SETUP_WORKER_FAILURE = "SETUP_WORKER_FAILURE",
    WORKER_FAILURE = "WORKER_FAILURE",
    TASK_FETCH_FAILURE = "TASK_FETCH_FAILURE",
    SCAN_ACTIVITY_FAILURE = "SCAN_ACTIVITY_FAILURE",
}