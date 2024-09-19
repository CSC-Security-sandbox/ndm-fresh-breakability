import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import amqp, { ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';
import { EventsGateway } from "./events.gateway";

@Injectable()
export class RabbtMqService implements OnModuleInit, OnModuleDestroy {
  private channelWrapper: ChannelWrapper;
  private readonly logger = new Logger(RabbtMqService.name);
  private exchange = 'testasd';
  private routingKey =  'socketConnetion'

  constructor(private readonly eventsGateway: EventsGateway) {
    const connection = amqp.connect(['amqps://frbrucjq:UDm9yWoZ4kig37NzOQM_HxU8xuXmMdWD@lionfish.rmq.cloudamqp.com/frbrucjq']);
    // const connection = amqp.connect([`amqp://${process.env.RABBITMQ_USER}:${process.env.RABBITMQ_PASSWORD}@${process.env.RABBITMQ_HOST}:${process.env.RABBITMQ_PORT}`]);
    this.channelWrapper = connection.createChannel();
  }

  async onModuleInit() {
    const queue = `consumer_queue_156_K_${process.env.REPLICA_INDEX || 'default'}`;
    try {
      await this.channelWrapper.addSetup(async (channel: ConfirmChannel) => {
        await channel.assertExchange(this.exchange, 'fanout', { durable: true });
        await channel.assertQueue(queue, { durable: true });
        await channel.bindQueue(queue, this.exchange, this.routingKey);
        await channel.consume(queue, async (message) => {
          if (message) {
            const content = JSON.parse(message.content.toString());
            this.logger.log('Received message:', content);
            this.eventsGateway.sendToClient(content?.agentId, content?.action?.eventType, content?.action?.message)
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
    const queue = `consumer_queue_${process.env.REPLICA_INDEX || 'default'}`;
    const exchange = 'test';

    try {
      await this.channelWrapper.addSetup(async (channel: ConfirmChannel) => {
        await channel.unbindQueue(queue, exchange, 'your-routing-key');
        await channel.deleteQueue(queue);
      });

      this.logger.log('Queue successfully unbound from the exchange and deleted.');
    } catch (err) {
      this.logger.error('Error unbinding or deleting queue:', err);
    }
  }
}
