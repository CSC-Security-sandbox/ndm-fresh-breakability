import { ConnectedSocket, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from 'src/auth/ws-jwt/ws-jwt.guard';
import { SockateAuthMiddleware } from 'src/auth/ws-jwt.middleware';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentStatus } from 'src/schemas/Agent.schema';
import { AgentStatusStates } from 'constants/enums';
import { AgentAckResponse } from './events.type';
import { RequestTrack } from 'src/schemas/RequestTrack.schema';
import { ResponseStatus } from 'src/constants/status';


@WebSocketGateway({namespace: 'event'})
@UseGuards(WsJwtGuard)
export class EventsGateway implements OnGatewayInit{
  @WebSocketServer()
  private server: Server;
  // private clients: Map<string, Socket> = new Map(); 
  private clients: Map<string, string> = new Map(); 

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    @InjectModel(AgentStatus.name)
    private readonly agentModel: Model<AgentStatus>,
    @InjectModel(RequestTrack.name)
    private readonly requestTrack: Model<RequestTrack>
  ){}
  
  async afterInit(@ConnectedSocket() client: Socket) {
    Logger.log('WebSocket server initialized'); 
    client.use(SockateAuthMiddleware() as any);
  }

  async handleConnection(client: Socket) {
    const agentId : string = client.handshake.query.agentId as string
    const agentName : string = client.handshake.query.agentName as string
    const projectId : string = client.handshake.query.projectId as string
    const ipAddress: string = client.handshake.address as string
    if(!agentId || !agentName || !projectId ) {
      this.logger.error("Invalid Details")
      return;
    }
   
    this.logger.log(`Client connected: ${agentId}`);
    this.clients.set(agentId, client.id);

    const found = await this.agentModel.findOne({agentId: agentId, projectId: projectId, ipAddress})
    if(found) {
      this.logger.log(`Record Found for Agent: ${agentId} Project: ${projectId}`)
      await this.agentModel.findByIdAndUpdate(found.id, {agentName: agentName, clientId: client.id, status: AgentStatusStates.Active})
      this.logger.log(`Record Updated for Agent: ${agentId} Project: ${projectId}`)
      return
    }
    
    const model  = new this.agentModel({agentId, projectId, agentName, ipAddress, status: AgentStatusStates.Active, clientId: client.id})
    model.save()
   
  }

  async handleDisconnect(client: Socket) {
    const agentId : string = client.handshake.query.agentId as string
    const projectId : string = client.handshake.query.projectId as string
    if(agentId) {
      this.logger.log(`Client disconnected: ${agentId}`);
      this.clients.delete(agentId);
      await this.agentModel.findOneAndUpdate({projectId, agentId}, {status: AgentStatusStates.Inactive})
    }
  }

  @SubscribeMessage('acknowledgement')
  async handleMessage(client: Socket, message: AgentAckResponse) {
    const agentAckResponse:AgentAckResponse = message
    if(agentAckResponse.error) 
      await this.requestTrack.findByIdAndUpdate(agentAckResponse.requestId, {status: ResponseStatus.Error, response: JSON.stringify(agentAckResponse.error)})
    else
      await this.requestTrack.findByIdAndUpdate(agentAckResponse.requestId, {status: ResponseStatus.Completed, response: JSON.stringify(agentAckResponse.result)})
    this.logger.log(`Recived Ack for ${agentAckResponse.requestId} from ${client.handshake.query?.agentId}`)
  }

  sendMessage(eventName: string, payload: any) {
    this.logger.log(`Sending message: ${eventName} with payload: ${JSON.stringify(payload)}`);
    this.server.emit(eventName, payload);
  }

  sendToClient(agentId: string, eventType: string, message: any,) {
    const clientId = this.clients.get(agentId);
    if (clientId) {
      this.logger.log('sendToClient',{agentId, eventType, message})
      this.server.to(clientId).emit(eventType, message);
    }
  }
  
}