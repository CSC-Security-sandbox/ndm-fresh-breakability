import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import amqp, { ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';
import { EventsGateway } from "./events.gateway";

@Injectable()
export class RabbtMqService implements OnModuleInit, OnModuleDestroy {
  private channelWrapper: ChannelWrapper;
  private readonly logger = new Logger(RabbtMqService.name);
  private exchange = process.env.RABBITMQ_URL_EXCHANGE || 'defaultEX';
  private routingKey =  process.env.RABBITMQ_URL_ROUTING_KEY || 'socketConnetion'
  private queue = `consumer_queue_156_K_${process.env.REPLICA_INDEX || 'default'}`;

  constructor(private readonly eventsGateway: EventsGateway) {
    const connection = amqp.connect([process.env.RABBITMQ_URL]);
    // const connection = amqp.connect([`amqp://${process.env.RABBITMQ_USER}:${process.env.RABBITMQ_PASSWORD}@${process.env.RABBITMQ_HOST}:${process.env.RABBITMQ_PORT}`]);
    this.channelWrapper = connection.createChannel();
  }

  async onModuleInit() {
    try {
      await this.channelWrapper.addSetup(async (channel: ConfirmChannel) => {
        await channel.assertExchange(this.exchange, 'fanout', { durable: true });
        await channel.assertQueue(this.queue, { durable: true });
        await channel.bindQueue(this.queue, this.exchange, this.routingKey);
        await channel.consume(this.queue, async (message) => {
          if (message) {
            const content = JSON.parse(message.content.toString());
            this.logger.log('Received message:', content);
            this.eventsGateway.sendToClient(content?.workerId, content?.action?.eventType, content?.action?.message)
            channel.ack(message);
          }
        });
      });
      this.logger.log('Consumer service started and listening for messages.');
    } catch (err) {
      this.logger.error('Error starting the consumer:', err);
    }
  }

  async publishToExchange(message: any): Promise<void> {
    try {
      await this.channelWrapper.publish(this.exchange, this.routingKey, Buffer.from(JSON.stringify(message)), { persistent: true } as any);
      this.logger.log(`Message published to exchange "${this.exchange}" with routing key "${this.routingKey}": ${JSON.stringify(message)}`);
    } catch (err) {
      this.logger.error('Error publishing message:', err);
    }
  }

  async onModuleDestroy() {
    Logger.debug('Module destroyed called!');
    try {
      await this.channelWrapper.addSetup(async (channel: ConfirmChannel) => {
        await channel.unbindQueue(this.queue, this.exchange, 'your-routing-key');
        await channel.deleteQueue(this.queue);
      });

      this.logger.log('Queue successfully unbound from the exchange and deleted.');
    } catch (err) {
      this.logger.error('Error unbinding or deleting queue:', err);
    }
  }
}
