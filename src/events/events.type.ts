import { SocketEvents } from "src/constants/status";

export interface QueueEvent{
    workerId: string;
    action: {
        eventType: SocketEvents,
        message: any
    }
}

export interface WorkerAckResponse{
    requestId?: string;
    result?: any;
    error?: any
}
