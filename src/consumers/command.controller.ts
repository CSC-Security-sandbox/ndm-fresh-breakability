import { Controller } from "@nestjs/common";
import { Ctx, MessagePattern, Payload, RmqContext } from "@nestjs/microservices";

@Controller()
export class CommandController {

    constructor() {
        console.log('CommandController created');
    }

    // @MessagePattern('hello')
    // public async handleMessage(@Payload() data: any, @Ctx() context: RmqContext) {
    //   const channel = context.getChannelRef();
    //   const originalMsg = context.getMessage();
    //   console.log('Received message:', data);
    //   // Acknowledge the message
    //   //channel.ack(originalMsg);
    // }
}