import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { AppConfigModule } from 'src/config/config.module';
import { RabbitMQConfigService } from 'src/config/rabbitmq.config';
import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
    imports: [
        AppConfigModule,
        TypeOrmModule.forFeature([InventoryEntity]),
        ClientsModule.registerAsync([
            {
                name: 'INVENTORY_QUEUE',
                imports: [AppConfigModule],
                useFactory: (configService: RabbitMQConfigService) => ({
                    transport: Transport.RMQ,
                    options: {
                        urls: configService.uris,
                        queue: configService.inventoryQueueName,
                        queueOptions: {
                            durable: true,
                        },
                    },
                }),
                inject: [RabbitMQConfigService],
            },
        ]),
    ],
    providers: [InventoryService],
    controllers: [InventoryController],
    exports: [InventoryService]
})
export class InventoryModule { }
