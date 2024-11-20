import { Operations, ResponseStatus, SocketEvents, TaskType } from "src/constants/status";

export interface QueueEvent{
    workerId: string;
    action: {
        eventType: SocketEvents,
        message: any
    }
}


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
