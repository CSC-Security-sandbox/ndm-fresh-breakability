import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Protocol } from 'src/constants/enums';
import { WorkerCommand, ResponseStatus, SocketEvents } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { FindManyOptions, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMqService } from './rabbitmq.service';
import { NFSConnectionDetails, SMBConnectionDetails, TestConnectionsDTO } from '../dto/workerconnection.dto';
import { QueueEvent } from '../events.type';
import { WorkerRequestDTO } from '../dto/responsefilter.dto';
import { MountConnectionsDTO } from '../dto/workermounts.dto';
import { FileConfigService } from './config.service';


@Injectable()
export class EventsService {
    private logger : Logger = new Logger(EventsService.name);
    constructor(
        @InjectRepository(RequestTrackEntity)
        private readonly requestTrackEntity: Repository<RequestTrackEntity>,
        private rabbitMqService: RabbitMqService,
        private readonly fileConfigService: FileConfigService

    ) {}

    async testWorkerConnections(testConnectionsDTO: TestConnectionsDTO){
        const requestId = uuidv4(); 
        testConnectionsDTO.workers.forEach(async worker => {
            if(testConnectionsDTO.nfsConnectionDetails) 
                await this.verifyWorkerConnection(requestId, worker.workerId, testConnectionsDTO.nfsConnectionDetails, Protocol.NFS, testConnectionsDTO.configId)
            if(testConnectionsDTO.sbmConnectionDetails) 
                await this.verifyWorkerConnection(requestId, worker.workerId, testConnectionsDTO.sbmConnectionDetails, Protocol.SMB, testConnectionsDTO.configId)
        })
        return {requestId}
    }

    async  verifyWorkerConnection(requestId: string, workerId:string, connection: SMBConnectionDetails | NFSConnectionDetails, protocol: Protocol, configId?: string | undefined) {
        const requestTrack = this.requestTrackEntity.create({
            requestType: WorkerCommand.TestConnection,
            status: ResponseStatus.Pending,
            requestId: requestId,
            workerId: workerId,
            protocol: protocol,
            createdBy: uuidv4()
        })
        const requestTrackSave = await this.requestTrackEntity.save(requestTrack)
        const payload = {requestId: requestTrackSave.id?.toString(), connectionDetails: connection, configId: configId }
        this.notifyEventToWorker(workerId, SocketEvents.TestConnection, payload)
    }

    async mountWorkerConnections(mountConnectionsDTO: MountConnectionsDTO){
        const requestId = uuidv4(); 
        mountConnectionsDTO.workers.forEach(async worker => {
            mountConnectionsDTO.protocol.forEach(protocol => {
                this.fetchExportPath(requestId, worker.workerId, protocol, mountConnectionsDTO.configId)
            });
        })
        return {requestId}
    }

    async fetchExportPath(requestId: string, workerId:string,  protocol: Protocol, configId?: string | undefined) {
        const requestTrack = this.requestTrackEntity.create({
            requestType: WorkerCommand.Volumes,
            status: ResponseStatus.Pending,
            requestId: requestId,
            workerId: workerId,
            protocol: protocol,
            createdBy: uuidv4()
        })
        const requestTrackSave = await this.requestTrackEntity.save(requestTrack)
        const payload = {requestId: requestTrackSave.id?.toString(), configId: configId, protocol}
        this.notifyEventToWorker(workerId, SocketEvents.Volumes, payload)
    }

    async notifyEventToWorker(workerId:string, socketEvents: SocketEvents, payload: any) {
        const queueEvent:QueueEvent = {
            workerId: workerId,
            action: {
                eventType: socketEvents,
                message: payload
            }
        }
        this.rabbitMqService.publishToExchange(queueEvent)
        this.logger.log(`${socketEvents} is published for ${workerId}`)
    }

    async processWorkerResponses(workerRequestDTO: WorkerRequestDTO) {
        const { page, limit, sort = 'createdAt', order = 'ASC', deserialize , ...filter } = workerRequestDTO;
        
        const findOptions: FindManyOptions<RequestTrackEntity> = {
          where: filter, order: { [sort]: order }, 
        };
        let data = [], total = 0;
        if (page && limit) {
          findOptions.skip = (parseInt(page) - 1) * parseInt(limit); 
          findOptions.take = parseInt(limit); 
          data = await this.requestTrackEntity.find(findOptions);
          total = await this.requestTrackEntity.count({ where: filter });
        } else {
          data = await this.requestTrackEntity.find(findOptions);
          total = await this.requestTrackEntity.count();
        }
        if(deserialize) 
            data = data.map((it:RequestTrackEntity) => ({...it, response: it?.response ? JSON.parse(it?.response ?? "") : ""}))
        return { data, total };
      }

      // Send fetch path event to worker
      async fetchPaths(configId: string) {
        const config =  await this.fileConfigService.getPathConfig(configId)
        if(!config) 
            throw new NotFoundException(`Config with ${configId} configId does not exists.`)
        config.fileServers.forEach(async server=> {
            const payload = {configId: config.id, protocol: server.protocol}
            server.workers.forEach(async worker=> {
                await this.notifyEventToWorker(worker.workerId, SocketEvents.Volumes, payload)
            })
        })
        return await this.fileConfigService.updateRefetchingConfig(config)
      }
}
