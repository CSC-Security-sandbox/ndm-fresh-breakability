import { Controller, Logger } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { RabbitMq } from 'src/constants/enums';
import { EventsService } from 'src/events/service/events.service';

@Controller()
export class RabbiMqController {
    
    constructor(private eventsService: EventsService){}

    // fetch mount event
    @MessagePattern(RabbitMq.FetchMount)
    public async handleMessage(@Payload() data: any, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        await this.eventsService.fetchPaths(data.configId)
        channel.ack(originalMsg);
    }
}
