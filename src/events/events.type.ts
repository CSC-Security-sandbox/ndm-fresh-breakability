import { SocketEvents } from "src/constants/status";

export interface QueueEvent{
    agentId: string;
    action: {
        eventType: SocketEvents,
        message: any
    }
}

export interface AgentAckResponse{
    requestId: string;
    result?: any;
    error?: any
}
