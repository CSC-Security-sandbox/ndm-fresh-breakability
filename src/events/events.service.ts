import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentStatus } from 'src/schemas/Agent.schema';
import { RequestTrack } from 'src/schemas/RequestTrack.schema';
import { RabbtMqService } from './rabbitmq.service';

import { RequestType, ResponseStatus, SocketEvents } from 'src/constants/status';
import { v4 as uuidv4 } from 'uuid';
import { TestConnectionsDTO } from './dto/agentconnection.dto';
import { QueueEvent } from './events.type';
import { ResponsePageFilterDto } from './dto/responcefilter.dto';

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
        testConnectionsDTO.agentIds.forEach(async agentId => {
            const requestTrack = new this.model({
                requestType: RequestType.TestConnection,
                status: ResponseStatus.Pending,
                requestId: requestId,
                agentId: agentId
            })
            const requestTrackSave = await requestTrack.save()
            const payload = {requestId: requestTrackSave._id?.toString()}
            this.notifyEventToAgent(agentId, SocketEvents.TestConnection, payload)
        })
        return requestId
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
        const { page, limit, sort = 'created_at', order = 'asc', ...filter} = responsePageFilterDto;
        let data = [], total = 0
        if(page && limit && sort && order) {
            const skip = (parseInt(page) - 1) * parseInt(limit);
            data = await this.model.find(filter).sort({[sort]: order}).skip(skip).limit(parseInt(limit)).exec();  
            total = await this.model.find(filter).countDocuments(filter)
            return { data, total}
        }
        data = await this.model.find().exec();
        total = await this.model.find().countDocuments();
        return { data, total}
    }

}
