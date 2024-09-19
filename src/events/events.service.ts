import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Protocol } from 'src/constants/enums';
import { RequestType, ResponseStatus, SocketEvents } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { FindManyOptions, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { NFSConnectionDetails, SMBConnectionDetails, TestConnectionsDTO } from './dto/agentconnection.dto';
import { MountConnectionsDTO } from './dto/agentmounts.dto';
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

    async testAgentConnetions(testConnectionsDTO: TestConnectionsDTO){
        const requestId = uuidv4(); 
        testConnectionsDTO.agents.forEach(async agent => {
            if(testConnectionsDTO.nfsConnectionDetails) 
                await this.makeTestConnectionnRequest(requestId, agent.agentId, testConnectionsDTO.nfsConnectionDetails, Protocol.NFS, testConnectionsDTO.configId)
            if(testConnectionsDTO.sbmConnectionDetails) 
                await this.makeTestConnectionnRequest(requestId, agent.agentId, testConnectionsDTO.sbmConnectionDetails, Protocol.SMB, testConnectionsDTO.configId)
        })
        return {requestId}
    }

    async  makeTestConnectionnRequest(requestId: string, agentId:string, connection: SMBConnectionDetails | NFSConnectionDetails, protocol: Protocol, configId?: string | undefined) {
        const requestTrack = this.requestTrackEntity.create({
            requestType: RequestType.TestConnection,
            status: ResponseStatus.Pending,
            requestId: requestId,
            agentId: agentId,
            protocol: protocol,
            createdBy: uuidv4()
        })
        const requestTrackSave = await this.requestTrackEntity.save(requestTrack)
        const payload = {requestId: requestTrackSave.id?.toString(), connectionDetails: connection, configId: configId }
        this.notifyEventToAgent(agentId, SocketEvents.TestConnection, payload)
    }

    async mountAgentConnetions(mountConnectionsDTO: MountConnectionsDTO){
        const requestId = uuidv4(); 
        mountConnectionsDTO.agents.forEach(async agent => {
            mountConnectionsDTO.protocol.forEach(protocol => {
                this.makeAgentMountConnectionRequest(requestId, agent.agentId, protocol, mountConnectionsDTO.configId)
            });
        })
        return {requestId}
    }

    async makeAgentMountConnectionRequest(requestId: string, agentId:string,  protocol: Protocol, configId?: string | undefined) {
        const requestTrack = this.requestTrackEntity.create({
            requestType: RequestType.Volumes,
            status: ResponseStatus.Pending,
            requestId: requestId,
            agentId: agentId,
            protocol: protocol,
            createdBy: uuidv4()
        })
        const requestTrackSave = await this.requestTrackEntity.save(requestTrack)
        const payload = {requestId: requestTrackSave.id?.toString(), configId: configId }
        this.notifyEventToAgent(agentId, SocketEvents.Volumes, payload)
    }

    async notifyEventToAgent(agentId:string, socketEvents: SocketEvents, payload: any) {
        const queuEvent:QueueEvent = {
            agentId: agentId,
            action: {
                eventType: socketEvents,
                message: payload
            }
        }
        this.rabbtMqService.publishToExchange(queuEvent)
        this.logger.log(`${socketEvents} is published for ${agentId}`)
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
