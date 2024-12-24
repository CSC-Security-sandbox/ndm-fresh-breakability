import { Operations, ResponseStatus, SocketEvents, TaskType } from "src/constants/status";

export interface QueueEvent{
    workerId: string;
    action: {
        eventType: SocketEvents,
        message: any
    }
}


//------------------- validate Connection ----------------- //
export interface ValidateConnectionOptionReq{
    operation: Operations;
    request:  {
        hostname: string
        username: string;
        password?: string
    }
    status: ResponseStatus
}
export interface ValidateConnectionReq{
    id: string
    taskType: TaskType;
    status: ResponseStatus
    workerId: string;
    transactionId: string
    operations: ValidateConnectionOptionReq[]
}


export interface ValidateConnectionRes{
    id: string
    taskType: TaskType;
    status: ResponseStatus
    workerId: string;
    transactionId: string
    operations: [{
        operation: Operations;
        response: {
            errors?: [{
                errorCode: string,
                errorMessage: string
            }]
        }
        status: ResponseStatus
    }]
}
//------------------- validate Connection ----------------- //


//------------------- listPath Payloads ----------------- //
export interface ListPathOptionReq{
    operation: Operations;
    request:  {
        hostname: string
        username: string;
        password?: string
    }
    status: ResponseStatus
}
export interface ListPathReq{
    id: string
    taskType: TaskType;
    status: ResponseStatus
    workerId: string;
    transactionId: string
    operations: ListPathOptionReq[]
}


export interface ListPathRes{
    id: string
    taskType: TaskType;
    status: ResponseStatus
    workerId: string;
    transactionId: string
    operations: [{
        operation: Operations;
        response: {
            paths?: string[]
            errors?: [{
                errorCode: string,
                errorMessage: string
            }]
        }
        status: ResponseStatus
    }]
}

export interface UnScannedRes {
    jobRunId: string,
    workerId: string,
    transactionId: string,
    paths: string[]
}



export interface MountedStatus{
    jobRunId: string,
    status: boolean
}