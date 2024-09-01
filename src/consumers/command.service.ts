import { Injectable, OnModuleInit } from "@nestjs/common";
import { Ctx, MessagePattern, Payload, RmqContext } from "@nestjs/microservices";
import { RabbitMQService } from "src/rabbitmq/rabbitmq.service";

@Injectable()
export class CommandService implements OnModuleInit {
    constructor(private rabbitMQService: RabbitMQService) {}
  
    async onModuleInit() {
      const channel = this.rabbitMQService.getChannel();
      const queue = `consumer_queue_${process.env.REPLICA_INDEX || 'default'}`;
  
      // Setup the consumer
      await channel.consume(queue, (msg) => {
        if (msg) {
          console.log(`Received message from ${queue}: ${msg.content.toString()}`);
          channel.ack(msg);
        }
      });
    }

}