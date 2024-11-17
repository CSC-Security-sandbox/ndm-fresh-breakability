import { Controller, Logger } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { Rabbitmq } from 'src/constants/enums';
import { EventsService } from 'src/events/service/events.service';

@Controller()
export class RabbimqController {
    
    constructor(private eventsService: EventsService){}

    @MessagePattern(Rabbitmq.FetchMount)
    public async handleMessage(@Payload() data: any, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();

        console.log(data)
        await this.eventsService.fetchPaths(data.configId)
        channel.ack(originalMsg);
    }
}
