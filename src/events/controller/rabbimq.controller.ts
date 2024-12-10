import { Controller, Logger } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { RabbitMq } from 'src/constants/enums';
import { EventsService } from '../service/events/events.service';
import { WorkManager } from '../workmanager/workmanager.service';
import { RMQTask } from '../workmanager/workmanager.types';
import { ListPathsMsg } from './rabbitmq.types';

@Controller()
export class RabbiMqController {
    
    private readonly logger: Logger = new Logger(RabbiMqController.name)
    constructor(
        private eventsService: EventsService,
        private workManager: WorkManager
    ){}

    // fetch mount event
    @MessagePattern(RabbitMq.ListPaths)
    public async handleMessage(@Payload() data: ListPathsMsg, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        await this.eventsService.fetchPathsByCred(data)
        channel.ack(originalMsg);
    }

    @MessagePattern(RabbitMq.CreateTaskList)
    public async handleTasksMessage(@Payload() data: RMQTask, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        await this.workManager.rmqTask(data)
        channel.ack(originalMsg);
    }

}
