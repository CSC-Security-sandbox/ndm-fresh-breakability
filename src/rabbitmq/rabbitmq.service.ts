import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    @Inject(ConfigService)
    private readonly config: ConfigService,
  ) {
    const rmqOptions: RmqOptions = {
      transport: Transport.RMQ,
      options: {
        urls: this.config.get('app.rabbitmq.urls'),
        queue: this.config.get('app.rabbitmq.queue'),
        queueOptions: {
          durable: this.config.get('app.rabbitmq.durable'),
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
