import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentStatus } from 'src/schemas/Agent.schema';
import { RequestTrack } from 'src/schemas/RequestTrack.schema';
import { RabbtMqService } from './rabbitmq.service';
import { RequestType, ResponseStatus, SocketEvents } from 'src/constants/status';
import { v4 as uuidv4 } from 'uuid';
import { NFSConnectionDetails, SMBConnectionDetails, TestConnectionsDTO } from './dto/agentconnection.dto';
import { QueueEvent } from './events.type';
import { ResponsePageFilterDto } from './dto/responcefilter.dto';
import { MountConnectionsDTO } from './dto/agentmounts.dto';
import {  Protocol } from 'constants/enums';


@Injectable()
export class EventsService {
    private logger : Logger = new Logger(AgentStatus.name);
    constructor(
        @InjectModel(RequestTrack.name)
        private readonly model: Model<RequestTrack>,
        private rabbtMqService: RabbtMqService,

    ) {}

    async testAgentConnetions(testConnectionsDTO: TestConnectionsDTO){
        const requestId = uuidv4(); 
        testConnectionsDTO.agents.forEach(async agent => {
            if(testConnectionsDTO.nfsConnectionDetails) 
                await this.makeTestConnectionnRequest(requestId, agent.agentId, testConnectionsDTO.nfsConnectionDetails, Protocol.NFS, testConnectionsDTO.configId)
            if(testConnectionsDTO.sbmConnectionDetails) 
                await this.makeTestConnectionnRequest(requestId, agent.agentId, testConnectionsDTO.nfsConnectionDetails, Protocol.SMB, testConnectionsDTO.configId)
        })
        return {requestId}
    }

    async  makeTestConnectionnRequest(requestId: string, agentId:string, connection: SMBConnectionDetails | NFSConnectionDetails, protocol: Protocol, configId?: string | undefined) {
        const requestTrack = new this.model({
            requestType: RequestType.TestConnection,
            status: ResponseStatus.Pending,
            requestId: requestId,
            agentId: agentId,
            protocol: protocol
           
        })
        const requestTrackSave = await requestTrack.save()
        const payload = {requestId: requestTrackSave._id?.toString(), connectionDetails: connection, configId: configId }
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
        const requestTrack = new this.model({
            requestType: RequestType.Volumes,
            status: ResponseStatus.Pending,
            requestId: requestId,
            agentId: agentId,
            protocol: protocol
        })
        const requestTrackSave = await requestTrack.save()
        const payload = {requestId: requestTrackSave._id?.toString(), configId: configId }
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

    async findAllRespose(responsePageFilterDto: ResponsePageFilterDto) {
        const { page, limit, sort = 'created_at', order = 'asc', deserialize = false, ...filter} = responsePageFilterDto;
        let data = [], total = 0
        if(page && limit && sort && order) {
            const skip = (parseInt(page) - 1) * parseInt(limit);
            data = await this.model.find(filter).sort({[sort]: order}).skip(skip).limit(parseInt(limit)).exec();  

            if(deserialize) 
                data = data.map((it:RequestTrack) => ({...it.toObject(), response: it?.response ? JSON.parse(it?.response ?? "") : ""}))
            total = await this.model.find(filter).countDocuments(filter)
            return { data, total}
        }
        data = await this.model.find(filter).exec();
        total = await this.model.find(filter).countDocuments();
        if(deserialize) 
        data = data.map((it:RequestTrack) => ({...it.toObject(), response: it?.response ? JSON.parse(it?.response ?? "") : ""}))
        return { data, total}
    }

}
