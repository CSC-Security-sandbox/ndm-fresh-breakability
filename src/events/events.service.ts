import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Protocol } from 'src/constants/enums';
import { RequestType, ResponseStatus, SocketEvents } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { FindManyOptions, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { NFSConnectionDetails, SMBConnectionDetails, TestConnectionsDTO } from './dto/workerconnection.dto';
import { MountConnectionsDTO } from './dto/workermounts.dto';
import { ResponsePageFilterDto } from './dto/responcefilter.dto';
import { QueueEvent } from './events.type';
import { RabbtMqService } from './rabbitmq.service';


@Injectable()
export class EventsService {
    private logger : Logger = new Logger(EventsService.name);
    constructor(
        @InjectRepository(RequestTrackEntity)
        private readonly requestTrackEntity: Repository<RequestTrackEntity>,
        private rabbtMqService: RabbtMqService,

    ) {}

    async testWorkerConnetions(testConnectionsDTO: TestConnectionsDTO){
        const requestId = uuidv4(); 
        testConnectionsDTO.workers.forEach(async worker => {
            if(testConnectionsDTO.nfsConnectionDetails) 
                await this.makeTestConnectionnRequest(requestId, worker.workerId, testConnectionsDTO.nfsConnectionDetails, Protocol.NFS, testConnectionsDTO.configId)
            if(testConnectionsDTO.sbmConnectionDetails) 
                await this.makeTestConnectionnRequest(requestId, worker.workerId, testConnectionsDTO.sbmConnectionDetails, Protocol.SMB, testConnectionsDTO.configId)
        })
        return {requestId}
    }

    async  makeTestConnectionnRequest(requestId: string, workerId:string, connection: SMBConnectionDetails | NFSConnectionDetails, protocol: Protocol, configId?: string | undefined) {
        const requestTrack = this.requestTrackEntity.create({
            requestType: RequestType.TestConnection,
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

    async mountWorkerConnetions(mountConnectionsDTO: MountConnectionsDTO){
        const requestId = uuidv4(); 
        mountConnectionsDTO.workers.forEach(async worker => {
            mountConnectionsDTO.protocol.forEach(protocol => {
                this.makeWorkerMountConnectionRequest(requestId, worker.workerId, protocol, mountConnectionsDTO.configId)
            });
        })
        return {requestId}
    }

    async makeWorkerMountConnectionRequest(requestId: string, workerId:string,  protocol: Protocol, configId?: string | undefined) {
        const requestTrack = this.requestTrackEntity.create({
            requestType: RequestType.Volumes,
            status: ResponseStatus.Pending,
            requestId: requestId,
            workerId: workerId,
            protocol: protocol,
            createdBy: uuidv4()
        })
        const requestTrackSave = await this.requestTrackEntity.save(requestTrack)
        const payload = {requestId: requestTrackSave.id?.toString(), configId: configId, protocol, }
        this.notifyEventToWorker(workerId, SocketEvents.Volumes, payload)
    }

    async notifyEventToWorker(workerId:string, socketEvents: SocketEvents, payload: any) {
        const queuEvent:QueueEvent = {
            workerId: workerId,
            action: {
                eventType: socketEvents,
                message: payload
            }
        }
        this.rabbtMqService.publishToExchange(queuEvent)
        this.logger.log(`${socketEvents} is published for ${workerId}`)
    }

    async findAllResponse(responsePageFilterDto: ResponsePageFilterDto) {
        const { page, limit, sort = 'createdAt', order = 'ASC', deserialize , ...filter } = responsePageFilterDto;
        
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

}
