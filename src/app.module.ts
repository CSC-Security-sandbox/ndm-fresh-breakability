import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
// import rabbitmqConfig from './config/rabbitmq.config';
import { InventoryController } from './controllers/inventory.controller';
import { InventoryService } from './services/inventory.service';
import databaseConfig from './config/database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from './entities/inventory.entity';
import { TaskEntity } from './entities/task.entity';
import { RabbitMQConfigService } from './config/rabbitmq.config';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';
import { RabbitmqController } from './rabbitmq/rabbitmq.controller';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { AppConfigModule } from './config/config.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      load: [databaseConfig],
      isGlobal: true
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([InventoryEntity, TaskEntity]),
    AppConfigModule,
    RabbitmqModule,
  ],
  controllers: [AppController, InventoryController, RabbitmqController],
  providers: [AppService, InventoryService, RabbitMQConfigService, RabbitmqService],
})
export class AppModule { }


