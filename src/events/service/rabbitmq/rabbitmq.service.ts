import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import { ClientProxy, ClientProxyFactory, Transport } from "@nestjs/microservices";
import amqp, { ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';
import { EmitterEvents, InventoryPayloadType, InventoryQueueEvents } from "src/constants/events";
import { EventsGateway } from "src/events/getway/events.gateway";
import { DiscoveryCompletePayload } from "./rabbitmq.service.types";



@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private channelWrapper: ChannelWrapper;
  private readonly logger = new Logger(RabbitMqService.name);
  private exchange = process.env.RABBITMQ_URL_EXCHANGE || 'defaultEX';
  private routingKey =  process.env.RABBITMQ_URL_ROUTING_KEY || 'socketConnetion'
  private queueWorkerNotify = `worker_notification_queue_${process.env.REPLICA_INDEX || 'default'}`;
  private inventoryClient: ClientProxy;

  constructor(
    private readonly eventsGateway: EventsGateway,
    private readonly configService: ConfigService
    ) {
      const urls: any = this.configService.get<string[]>('app.rabbitmq.urls') || '';
      const connection = amqp.connect(urls);
      this.channelWrapper = connection.createChannel();
      this.inventoryClient = ClientProxyFactory.create({
        transport: Transport.RMQ,
        options: {
          urls: urls,
          queue: this.configService.get<string>('app.rabbitmq.inventoryQueue') || '',
          queueOptions: {
            durable: true,
            arguments: {
              'x-queue-type': 'quorum',
          },
        },
        },
      });
  }

  // Create and Attach Queue to exchange
  async onModuleInit() {
    try {
      await this.channelWrapper.addSetup(async (channel: ConfirmChannel) => {
        await channel.assertExchange(this.exchange, 'fanout', { durable: true });
        await channel.assertQueue(this.queueWorkerNotify, { durable: true });
        await channel.bindQueue(this.queueWorkerNotify, this.exchange, this.routingKey);
        await channel.consume(this.queueWorkerNotify, async (message) => {
          if (message) {
            const content = JSON.parse(message.content.toString());
            this.logger.log('Received message:', content);
            await this.eventsGateway.sendToClient(content?.workerId, content?.action?.eventType, content?.action?.message)
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
      // this.logger.debug(`Message published to exchange `)
      await this.channelWrapper.publish(this.exchange, this.routingKey, Buffer.from(JSON.stringify(message)), { persistent: true } as any);
      // this.logger.debug(`Message published to exchange "${this.exchange}" with routing key "${this.routingKey}": ${JSON.stringify(message)}`);
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

  @OnEvent(EmitterEvents.DiscoveryComplete, { async: true })
  async generateDiscoveryReport(data: DiscoveryCompletePayload) {
    this.logger.debug('SENDING COMPLETE REPORT')
    const response = await this.inventoryClient.emit(InventoryQueueEvents.INVENTORY, 
      {
        type: InventoryPayloadType.DISCOVERY_COMPLETED ,data
      }).toPromise()
    this.logger.debug(`------------- DiscoveryComplete  -----------------`)
    this.logger.debug(`${JSON.stringify(response)}`)
  }

}
