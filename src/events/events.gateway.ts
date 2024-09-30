import { Logger, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConnectedSocket, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SockateAuthMiddleware } from 'src/auth/ws-jwt.middleware';
import { WsJwtGuard } from 'src/auth/ws-jwt/ws-jwt.guard';
import { WorkerStatus } from 'src/constants/enums';
import { ResponseStatus, SocketEvents } from 'src/constants/status';
import { WorkerEntity } from 'src/entities/worker.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { Repository } from 'typeorm';
import { WorkerAckResponse } from './events.type';
import { v4 as uuidv4 } from 'uuid';

@WebSocketGateway({namespace: 'event'})
@UseGuards(WsJwtGuard)
export class EventsGateway implements OnGatewayInit{
  @WebSocketServer()
  private server: Server;
  private clients: Map<string, string> = new Map(); 
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    @InjectRepository(WorkerEntity) 
    private readonly WorkerEntity: Repository<WorkerEntity>,
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
    const workerId : string = client.handshake.query.agentId as string
    const workerName : string = client.handshake.query.agentName as string
    const projectId : string = client.handshake.query.projectId as string
    const ipAddress: string = client.handshake.address as string
    
    this.logger.log(`Client IP Address: ${ipAddress}`)
    if(!workerId || !workerName || !projectId ) {
      this.logger.error("Invalid Details",workerId)
      return;
    }
   
    this.logger.log(`Client connected: ${workerId}`);
    this.clients.set(workerId, client.id);

    const worker = await this.WorkerEntity.findOne({where: {workerId: workerId}})
    if(worker) {
      this.logger.log(`Record Found for Worker: ${workerId} Project: ${projectId}`)
      await this.WorkerEntity.update({workerId: workerId}, {workerName: workerName, clientId: client.id, status: WorkerStatus.Online})
      this.logger.log(`Record Updated for Worker: ${workerId} Project: ${projectId}`)
      return
    }
    
    const project = await this.projectEntity.findOneBy({id: projectId})
    if(!project) {
      this.logger.error(`Record Not Found for Project: ${projectId} Unabel to register worker`)
      client.emit(SocketEvents.Error, {error:`Record Not Found for Project: ${projectId} Unabel to register worker`})
      client.disconnect()
      return
    }
    const registerWorker =  this.WorkerEntity.create({workerId, projectId, workerName, ipAddress, status: WorkerStatus.Online, clientId: client.id, createdBy:  uuidv4()})
    await this.WorkerEntity.save(registerWorker)
  }

  async handleDisconnect(client: Socket) {
    const workerId : string = client.handshake.query.agentId as string
    const projectId : string = client.handshake.query.projectId as string
    if(workerId) {
      this.logger.log(`Client disconnected: ${workerId}`);
      this.clients.delete(workerId);
      await this.WorkerEntity.update({projectId, workerId}, {status: WorkerStatus.Offline})
    }
  }

  @SubscribeMessage('acknowledgement')
  async handleMessage(client: Socket, message: WorkerAckResponse) {
    const workerAckResponse:WorkerAckResponse = message
    if(workerAckResponse.error) 
      await this.requestTrackEntity.update({id:workerAckResponse.requestId}, {status: ResponseStatus.Error, response: JSON.stringify(workerAckResponse.error)})
    else
      await this.requestTrackEntity.update({id:workerAckResponse.requestId}, {status: ResponseStatus.Completed, response: JSON.stringify(workerAckResponse.result)})
    this.logger.log(`Recived Ack for ${workerAckResponse.requestId} from ${client.handshake.query?.workerId}`)
  }

  sendMessage(eventName: string, payload: any) {
    this.logger.log(`Sending message: ${eventName} with payload: ${JSON.stringify(payload)}`);
    this.server.emit(eventName, payload);
  }

  sendToClient(workerId: string, eventType: string, message: any,) {
    this.logger.log('workerId', workerId)
    this.logger.log('workerId', this.clients.get(workerId))
    const clientId = this.clients.get(workerId);
    if (clientId) {
      this.logger.log('sendToClient',{workerId, eventType, message})
      this.server.to(clientId).emit(eventType, message);
    }
  }
  
}