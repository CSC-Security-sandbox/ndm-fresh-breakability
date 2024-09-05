import { SocketEvents } from "src/constants/status";

export interface ClientToServerEvent{
    messageAck: (payload: MessageAck) => void
}

export class MessageAck{
    id: string;
    author: string;
    conversationId: string;
    createdAt: string;
    updatedAt: string;
}


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
