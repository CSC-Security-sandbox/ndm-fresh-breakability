import { Controller, Logger } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { RabbitMq } from 'src/constants/enums';
import { EventsService } from 'src/events/service/events.service';
import { FetchMountMsg } from './rabbitmq.types';

@Controller()
export class RabbiMqController {
    
    constructor(private eventsService: EventsService){}

    // fetch mount event
    @MessagePattern(RabbitMq.FetchMount)
    public async handleMessage(@Payload() data: FetchMountMsg, @Ctx() context: RmqContext) {
        console.log(data)
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        await this.eventsService.fetchPathsByCred(data)
        channel.ack(originalMsg);
    }
}
