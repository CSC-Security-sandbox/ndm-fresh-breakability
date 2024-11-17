import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  RmqOptions,
  Transport,
} from '@nestjs/microservices';

@Injectable()
export class RabbitMQService {
  private readonly client: ClientProxy;

  constructor(
  ) {
    const rmqOptions: RmqOptions = {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL],
        queue: 'datamigrate-queue',
        queueOptions: {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum', 
          },
        },
      },
    };
    this.client = ClientProxyFactory.create(rmqOptions);
  }

  async sendMessage(event: string, message: any, ) {
    try {
      await this.client.connect();
      Logger.log(message)
      const result = this.client.send(event, message);
      result
        .forEach((res) => {
          Logger.log('Result : ', res);
        })
        .catch((error) => {
          Logger.error(`Send error: ${error}`);
        });
    } catch (error) {
      Logger.error(`Error while sending message : ${error}`);
    }
  }
}
