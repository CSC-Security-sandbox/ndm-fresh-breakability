import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { RabbitMQConfigService } from '../config/rabbitmq.config';
import { RabbitmqService } from './rabbitmq.service';
import { RabbitmqController } from './rabbitmq.controller';
import { AppConfigModule } from 'src/config/config.module';

@Module({
  imports: [
    AppConfigModule,
    ClientsModule.registerAsync([
      {
        name: 'TASK_LIST_QUEUE',
        imports: [AppConfigModule],
        useFactory: (configService: RabbitMQConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: configService.uris,
            queue: configService.taskQueueName,
            queueOptions: {
              durable: true,
            },
          },
        }),
        inject: [RabbitMQConfigService],
      },
    ]),
  ],
  providers: [RabbitmqService, RabbitMQConfigService],
  controllers: [RabbitmqController],
  exports: [RabbitmqService, RabbitMQConfigService]
})
export class RabbitmqModule {}
