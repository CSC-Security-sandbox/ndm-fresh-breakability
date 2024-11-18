export enum ResponseStatus {
    Pending = 'Pending',
    Completed = 'Completed',
    Error = 'Error'
}

export enum WorkerCommand {
    TestConnection = 'TestConnection',
    Volumes = 'Volumes'
}

export enum SocketEvents{
    TestConnection = 'test-connection',
    Volumes = 'volumes',
    Error = 'error',
    Acknowledgement = 'acknowledgement',
    VolumesAck = 'volumes-ack'
}
