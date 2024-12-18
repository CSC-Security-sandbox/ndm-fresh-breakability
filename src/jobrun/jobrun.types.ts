import { Protocol } from "src/constants/enums"

export interface UpdateJobRunMappingPayload {
    jobRunId: string,
    isActive: boolean
}


interface Credential {
    protocol: Protocol,
    password?: string,
    pathId: string,
    username: string,
    path:string,
    host: string,
    workingDirectory:string
}

export interface MountConnection{
    connection: {
        sourceCredential:Credential,
        targetCredential?: Credential
    }
    workers: string[]
}