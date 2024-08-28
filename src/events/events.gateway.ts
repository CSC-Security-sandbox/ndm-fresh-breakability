import { ConnectedSocket, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from 'src/auth/ws-jwt/ws-jwt.guard';
import { SockateAuthMiddleware } from 'src/auth/ws-jwt.middleware';

@WebSocketGateway({ namespace: 'event' })
@UseGuards(WsJwtGuard)
export class EventsGateway implements OnGatewayInit{
  @WebSocketServer()
  private server: Server;

  async afterInit(@ConnectedSocket() client: Socket) {
    Logger.log('WebSocket server initialized'); 
    client.use(SockateAuthMiddleware() as any);
  }

  @SubscribeMessage('trigger')
  handleMessage(client: Socket, payload: any) {
    Logger.log('Handling trigger event'); 
    this.sendMessage('output', 'got it');
  }

  sendMessage(eventName: string, payload: any) {
    Logger.log(`Sending message: ${eventName} with payload: ${JSON.stringify(payload)}`);
    this.server.emit(eventName, payload);
  }
}
