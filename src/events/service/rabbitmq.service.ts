import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import amqp, { ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';
import { EventsGateway } from "../getway/events.gateway";


@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private channelWrapper: ChannelWrapper;
  private readonly logger = new Logger(RabbitMqService.name);
  private exchange = process.env.RABBITMQ_URL_EXCHANGE || 'defaultEX';
  private routingKey =  process.env.RABBITMQ_URL_ROUTING_KEY || 'socketConnetion'
  private queueWorkerNotify = `worker_notification_queue_${process.env.REPLICA_INDEX || 'default'}`;

  constructor(private readonly eventsGateway: EventsGateway) {
    const connection = amqp.connect([process.env.RABBITMQ_URL]);
    this.channelWrapper = connection.createChannel();
  }

  // Create and Attach Queue to exchange
  async onModuleInit() {
    try {
      await this.channelWrapper.addSetup(async (channel: ConfirmChannel) => {
        await channel.assertExchange(this.exchange, 'fanout', { durable: true });
        await channel.assertQueue(this.queueWorkerNotify, { durable: true });
        await channel.bindQueue(this.queueWorkerNotify, this.exchange, this.routingKey);
        await channel.consume(this.queueWorkerNotify, async (message) => {
          this.logger.error(message)
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

  // Send Message to exchange
  async publishToExchange(message: any): Promise<void> {
    try {
      this.logger.log(`Message published to exchange `)
      await this.channelWrapper.publish(this.exchange, this.routingKey, Buffer.from(JSON.stringify(message)), { persistent: true } as any);
      this.logger.log(`Message published to exchange "${this.exchange}" with routing key "${this.routingKey}": ${JSON.stringify(message)}`);
    } catch (err) {
      this.logger.error('Error publishing message:', err);
    }
  }

  // Unbind and delete Queue
  async onModuleDestroy() {
    Logger.debug('Module destroyed called!');
    try {
      await this.channelWrapper.addSetup(async (channel: ConfirmChannel) => {
        await channel.unbindQueue(this.queueWorkerNotify, this.exchange, this.routingKey);
        await channel.deleteQueue(this.queueWorkerNotify);
      });

      this.logger.log('Queue successfully unbound from the exchange and deleted.');
    } catch (err) {
      this.logger.error('Error unbinding or deleting queue:', err);
    }
  }
}
