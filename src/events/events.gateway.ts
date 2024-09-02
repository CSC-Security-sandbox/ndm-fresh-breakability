import { ConnectedSocket, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from 'src/auth/ws-jwt/ws-jwt.guard';
import { SockateAuthMiddleware } from 'src/auth/ws-jwt.middleware';


@WebSocketGateway({namespace: 'event'})
// @UseGuards(WsJwtGuard)
export class EventsGateway implements OnGatewayInit{
  @WebSocketServer()
  private server: Server;
  private clients: Map<string, Socket> = new Map(); 
  private readonly logger = new Logger(EventsGateway.name);
  
  async afterInit(@ConnectedSocket() client: Socket) {
    Logger.log('WebSocket server initialized'); 
    // client.use(SockateAuthMiddleware() as any);
  }

  async handleConnection(client: Socket) {
    const conn:string = client.handshake.query.userId as string
    this.logger.log(`Connecting ... ${conn}`)
    if(conn) {
      this.logger.log(`Client connected: ${conn}`);
      this.clients.set(conn, client);
    }
    
  }

  handleDisconnect(client: Socket) {
    const conn:string = client.handshake.query.userId as string
    if(conn) {
      this.logger.log(`Client disconnected: ${conn}`);
      this.clients.delete(conn);
    }
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

  sendToClient(clientId: string, eventType: string, message: any,) {
    this.logger.log('sendToClient')
    this.logger.log(clientId, eventType, message)
    const client = this.clients.get(clientId);
    if (client) {
      this.logger.log("Sendig Message to Client")
      this.server.to(client.id).emit(eventType, message);
    }
  }

}