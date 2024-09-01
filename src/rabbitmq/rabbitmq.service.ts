import { Injectable, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RabbitMQService implements OnModuleInit {
  private connection: amqp.Connection;
  private channel: amqp.Channel;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {

    this.connection = await amqp.connect(this.configService.get<string>('RABBITMQ_URL'));
    this.channel = await this.connection.createChannel();


    const exchange = 'netapp';
    await this.channel.assertExchange(exchange, 'fanout', { durable: true });


    const queue = `consumer_queue_${process.env.REPLICA_INDEX || 'default'}`;

    await this.channel.assertQueue(queue, { durable: true });
    await this.channel.bindQueue(queue, exchange, '');

    console.log(`Queue ${queue} created and bound to exchange ${exchange}`);
  }

  getChannel() {
    return this.channel;
  }
}
