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
    username: string,
    path:string,
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
    preserveAccessTime: boolean
    workers: string[],
    skipFile?: string,
}


export interface UnMountNotificationPayload{
    jobRunId: string
    sPathId: string,
    tPathId?: string | undefined
}