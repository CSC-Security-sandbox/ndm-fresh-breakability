import { ConnectedSocket, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from 'src/auth/ws-jwt/ws-jwt.guard';
import { SockateAuthMiddleware } from 'src/auth/ws-jwt.middleware';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session } from 'src/schemas/Session.schema';

// @Injectable()
@WebSocketGateway()
// @UseGuards(WsJwtGuard)
export class EventsGateway implements OnGatewayInit{
  private clients: Set<Socket> = new Set();

  constructor(
    @InjectModel(Session.name)
   private sessionModel: Model<Session>
   ) {}

  @WebSocketServer()
  private server: Server;

  async afterInit(@ConnectedSocket() client: Socket) {
    Logger.log('WebSocket server initialized'); 
    // client.use(SockateAuthMiddleware() as any);
  }

  async handleConnection(client: Socket) {
    //const session = new this.sessionModel({ userId: client.handshake.query.userId, socketId: client.id });
    //Logger.log({ userId: client.handshake.query.userId, socketId: client.id })
    //await session.save();
    console.log('Client connected: ' + client.id);
    this.clients.add(client);
  }

  async handleDisconnect(client: Socket) {
    console.log('Client disconnected: ' + client.id);
    this.clients.delete(client);
    //await this.sessionModel.deleteOne({ socketId: client.id });
  }

  @SubscribeMessage('message')
  async handleMessage1(client: Socket, payload: string): Promise<void> {
    Logger.log('message')
    this.server.emit('messageAck', payload);
    const sessions = await this.sessionModel.find().exec();
    sessions.forEach(session => {
      this.server.to(session.socketId).emit('message', payload);
    });
  }


  sendMessage(eventName: string, payload: any) {
    Logger.log(`Sending message: ${eventName} with payload: ${JSON.stringify(payload)}`);
    this.server.emit(eventName, payload);
  }

  async sendToClient(clientId) {
    this.clients.forEach(client => { console.log(client.id) });
    const client = Array.from(this.clients).find(client => client.id === clientId);
    if (client) {
      client.emit('message', 'Hello from server');
    }
  }
}
