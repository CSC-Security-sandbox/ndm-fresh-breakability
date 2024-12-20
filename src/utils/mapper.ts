import { JobType, OperationType, Protocol, TaskType } from "src/constants/enums";
import { Operations } from "src/constants/status";


export const OperationToProtocol = (operation : Operations):Protocol => {
    switch (operation) {
        case Operations.LIST_NFS_PATHS:
        case Operations.VALIDATE_NFS_CONNECTION:
            return Protocol.NFS;
        case Operations.LIST_SMB_PATHS:
        case Operations.VALIDATE_SMB_CONNECTION:
            return Protocol.SMB;
        default:
            throw new Error('Invalid Operation');
    }
}

export const operationsTypeToTaskType = (op: OperationType) => {
    switch(op){
        case OperationType.SCAN:
            return TaskType.Scan
        default:
            throw new Error('Invalid Operation'); 
    }
}

export const jobTypeToOperationType = (type: JobType) => {
    switch(type){
        case JobType.DISCOVER:
            return OperationType.SCAN
        default:
            throw new Error('Invalid Operation'); 
    }
}