import { Logger, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConnectedSocket, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SockateAuthMiddleware } from 'src/auth/ws-jwt.middleware';
import { WsJwtGuard } from 'src/auth/ws-jwt/ws-jwt.guard';
import { AgentStatus } from 'src/constants/enums';
import { ResponseStatus, SocketEvents } from 'src/constants/status';
import { AgentEntity } from 'src/entities/agent.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { Repository } from 'typeorm';
import { AgentAckResponse } from './events.type';
import { v4 as uuidv4 } from 'uuid';

@WebSocketGateway({namespace: 'event'})
@UseGuards(WsJwtGuard)
export class EventsGateway implements OnGatewayInit{
  @WebSocketServer()
  private server: Server;
  private clients: Map<string, string> = new Map(); 
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    @InjectRepository(AgentEntity) 
    private readonly agentEntity: Repository<AgentEntity>,
    @InjectRepository(RequestTrackEntity) 
    private readonly requestTrackEntity: Repository<RequestTrackEntity>,
    @InjectRepository(ProjectEntity) 
    private readonly projectEntity: Repository<ProjectEntity>,
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
    
    this.logger.log(`Client IP Address: ${ipAddress}`)
    if(!agentId || !agentName || !projectId ) {
      this.logger.error("Invalid Details")
      return;
    }
   
    this.logger.log(`Client connected: ${agentId}`);
    this.clients.set(agentId, client.id);

    const agent = await this.agentEntity.findOne({where: {agentId: agentId}})
    if(agent) {
      this.logger.log(`Record Found for Agent: ${agentId} Project: ${projectId}`)
      await this.agentEntity.update({agentId: agentId}, {agentName: agentName, clientId: client.id, status: AgentStatus.Online})
      this.logger.log(`Record Updated for Agent: ${agentId} Project: ${projectId}`)
      return
    }
    
    const project = await this.projectEntity.findOneBy({id: projectId})
    if(!project) {
      this.logger.error(`Record Not Found for Project: ${projectId} Unabel to register agent`)
      client.emit(SocketEvents.Error, {error:`Record Not Found for Project: ${projectId} Unabel to register agent`})
      client.disconnect()
      return
    }
    const registerAgent =  this.agentEntity.create({agentId, projectId, agentName, ipAddress, status: AgentStatus.Online, clientId: client.id, createdBy:  uuidv4()})
    await this.agentEntity.save(registerAgent)
  }

  async handleDisconnect(client: Socket) {
    const agentId : string = client.handshake.query.agentId as string
    const projectId : string = client.handshake.query.projectId as string
    if(agentId) {
      this.logger.log(`Client disconnected: ${agentId}`);
      this.clients.delete(agentId);
      await this.agentEntity.update({projectId, agentId}, {status: AgentStatus.Offline})
    }
  }

  @SubscribeMessage('acknowledgement')
  async handleMessage(client: Socket, message: AgentAckResponse) {
    const agentAckResponse:AgentAckResponse = message
    if(agentAckResponse.error) 
      await this.requestTrackEntity.update({id:agentAckResponse.requestId}, {status: ResponseStatus.Error, response: JSON.stringify(agentAckResponse.error)})
    else
      await this.requestTrackEntity.update({id:agentAckResponse.requestId}, {status: ResponseStatus.Completed, response: JSON.stringify(agentAckResponse.result)})
    this.logger.log(`Recived Ack for ${agentAckResponse.requestId} from ${client.handshake.query?.agentId}`)
  }

  sendMessage(eventName: string, payload: any) {
    this.logger.log(`Sending message: ${eventName} with payload: ${JSON.stringify(payload)}`);
    this.server.emit(eventName, payload);
  }

  sendToClient(agentId: string, eventType: string, message: any,) {
    this.logger.log('agentId', agentId)
    this.logger.log('agentId', this.clients.get(agentId))
    const clientId = this.clients.get(agentId);
    if (clientId) {
      this.logger.log('sendToClient',{agentId, eventType, message})
      this.server.to(clientId).emit(eventType, message);
    }
  }
  
}