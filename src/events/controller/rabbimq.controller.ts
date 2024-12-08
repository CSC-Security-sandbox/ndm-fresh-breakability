import { Controller, Logger } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { RabbitMq } from 'src/constants/enums';
import { ListPathsMsg, TaskMessage } from './rabbitmq.types';
import { EventsService } from '../service/events/events.service';

@Controller()
export class RabbiMqController {
    
    constructor(private eventsService: EventsService){}

    // fetch mount event
    @MessagePattern(RabbitMq.ListPaths)
    public async handleMessage(@Payload() data: ListPathsMsg, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        console.error(data)
        await this.eventsService.fetchPathsByCred(data)
        channel.ack(originalMsg);
    }

    @MessagePattern(RabbitMq.CreateTaskList)
    public async handleTasksMessage(@Payload() data: TaskMessage, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        // await this.eventsService.createTasks(data);
        channel.ack(originalMsg);
    }

}
