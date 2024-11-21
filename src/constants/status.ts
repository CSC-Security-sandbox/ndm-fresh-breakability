export enum ResponseStatus {
    PENDING = 'PENDING',
    COMPLETED = 'COMPLETED',
    ERROR = 'ERROR'
}

export enum SocketEvents{
    VALIDATE_CONNECTION = 'VALIDATE_CONNECTION',
    VALIDATE_CONNECTION_ACK='VALIDATE_CONNECTION_ACK',
    LIST_PATH='LIST_PATH',
    LIST_PATH_ACK='LIST_PATH_ACK',
    Volumes = 'volumes',
    Error = 'error',
    Acknowledgement = 'acknowledgement',
    VolumesAck = 'volumes-ack'
}


export enum TaskType {
    VALIDATE_CONNECTION = 'VALIDATE_CONNECTION',
    LIST_PATHS='LIST_PATHS',
}

export enum Operations {
    VALIDATE_NFS_CONNECTION='VALIDATE_NFS_CONNECTION',
    VALIDATE_SMB_CONNECTION='VALIDATE_SMB_CONNECTION',
    LIST_NFS_PATHS='LIST_NFS_PATHS',
    LIST_SMB_PATHS='LIST_SMB_PATHS'
}