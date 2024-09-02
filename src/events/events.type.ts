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

