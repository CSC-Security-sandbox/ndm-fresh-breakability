import { Logger, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConnectedSocket, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SockateAuthMiddleware } from 'src/auth/ws-jwt.middleware';
import { WsJwtGuard } from 'src/auth/ws-jwt/ws-jwt.guard';
import { WorkerStatus } from 'src/constants/enums';
import { SocketEvents } from 'src/constants/status';
import { ProjectEntity } from 'src/entities/project.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ListPathRes, UnScannedRes, ValidateConnectionRes } from '../events.type';
import { WorkManager } from '../workmanager/workmanager.service';
import { RequestTrackService } from '../service/requesttack/requesttrack.service';
import { ScanCompletedPayload } from '../workmanager/workmanager.types';

@WebSocketGateway({namespace: 'event'})
@UseGuards(WsJwtGuard)
export class EventsGateway implements OnGatewayInit{
  @WebSocketServer()
  private server: Server;
  private clients: Map<string, string> = new Map(); 
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    @InjectRepository(WorkerEntity) 
    private readonly workerEntity: Repository<WorkerEntity>,
    @InjectRepository(ProjectEntity) 
    private readonly projectEntity: Repository<ProjectEntity>,
    private readonly requestTrackService: RequestTrackService,
    private readonly workManager: WorkManager
  ){}
  

  // Add Auth Middleware to socket Client
  async afterInit(@ConnectedSocket() client: Socket) {
    Logger.log('WebSocket server initialized'); 
    client.use(SockateAuthMiddleware() as any);
  }

  // worker connected to socket
  async handleConnection(client: Socket) {
    const workerId : string = client.handshake.query.worker as string
    const workerName : string = client.handshake.query.workerName as string
    const projectId : string = client.handshake.query.projectId as string
    const ipAddress: string = client.handshake.address as string
    
    this.logger.log(`Client IP Address: ${ipAddress}`)
    if(!workerId || !workerName || !projectId ) {
      this.logger.error("Invalid Details",workerId)
      client.disconnect()
      return;
    }
   
    this.logger.log(`Client connected: ${workerId} socket Id ${client.id}`);

    const worker = await this.workerEntity.findOne({where: {workerId: workerId}})
    if(worker) {
      try{ // update existing worker
        this.logger.log(`Record Found for Worker: ${workerId} Project: ${projectId}`)
        await this.workerEntity.update({workerId: workerId}, {workerName: workerName, clientId: client.id, status: WorkerStatus.Online})
        this.logger.log(`Record Updated for Worker: ${workerId} Project: ${projectId}`)
        this.clients.set(workerId, client.id);
      }catch(e){
        this.logger.error(`Error occurred during worker details update`, e);
      }
      return
    }
     // validate worker respective to project
    const project = await this.projectEntity.findOneBy({id: projectId})
    if(!project) {
      this.logger.error(`Record Not Found for Project: ${projectId} Unable to register worker`)
      client.emit(SocketEvents.ERROR, {error:`Record Not Found for Project: ${projectId} Unable to register worker`})
      client.disconnect()
      return
    }
    try{ // Add new worker
      const registerWorker =  this.workerEntity.create({workerId, projectId, workerName, ipAddress, status: WorkerStatus.Online, clientId: client.id, createdBy:  uuidv4()})
      await this.workerEntity.save(registerWorker)
      this.clients.set(workerId, client.id);
    }
    catch(e) {
      this.logger.error(`Error occurred during worker registration`, e);
    }
  }

  // worker disconnected
  async handleDisconnect(client: Socket) {
    const workerId : string = client.handshake.query.worker as string
    const projectId : string = client.handshake.query.projectId as string
    if(workerId) {
      this.logger.log(`Client disconnected: ${workerId}`);
      this.clients.delete(workerId);
      await this.workerEntity.update({projectId, workerId}, {status: WorkerStatus.Offline})
    }
  }

  // Send Message to All workers
  sendMessage(eventName: string, payload: any) {
    this.logger.log(`Sending message: ${eventName} with payload: ${JSON.stringify(payload)}`);
    this.server.emit(eventName, payload);
  }

  // Send Message to workers by worker Id
  sendToClient(workerId: string, eventType: string, message: any,) {
    this.logger.log(`Sending Message to worker ${workerId} : ${this.clients.get(workerId)}, ${JSON.stringify(message)}`)
    const clientId = this.clients.get(workerId);
    if (clientId) {
      this.logger.log('sendToClient',{workerId, eventType, message})
      this.server.to(clientId).emit(eventType, message);
    }
  }

  // --------------------- VALIDATE CONNECTION ACK --------------------- //
  @SubscribeMessage(SocketEvents.VALIDATE_CONNECTION_ACK)
  async handleValidateConnectionACk(client: Socket, ack: ValidateConnectionRes) {
    await this.requestTrackService.validateConnectionACk(ack)
  }

  // --------------------- LIST PATH ACK --------------------- //
  @SubscribeMessage(SocketEvents.LIST_PATH_ACK)
  async handleListPathAck(client: Socket, ack: ListPathRes) {
    await this.requestTrackService.listPathAck(ack)
  }

   // --------------------- TASK --------------------- //
   @SubscribeMessage(SocketEvents.TASK)
   async handleTask(client: Socket, ack: any) {
    const task = await this.workManager.assignWork(client.handshake.query.worker as string)
    if(task) {
      this.logger.error(`sending Task jobRun: ${task?.jobRunId} - taskId:  ${task.id}`)
      this.server.to(client.id).emit(SocketEvents.TASK_ACK, task)
    }
    else this.logger.error(`task not found`)
   }

   @SubscribeMessage(SocketEvents.TASK_COMPLETED)
   async taskCompleted(client: Socket, ack: ScanCompletedPayload) {
    await this.workManager.updateTask(ack)
   }

   @SubscribeMessage(SocketEvents.TASK_UN_SCANNED)
   async taskUnScanned(client: Socket, ack: UnScannedRes) {
    await this.workManager.createUnScannedTask(ack)
   }

   
}

