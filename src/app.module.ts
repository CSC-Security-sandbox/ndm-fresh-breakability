import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import rabbitmqConfig from './config/rabbitmq.config';
import { InventoryController } from './controllers/inventory.controller';
import { InventoryService } from './services/inventory.service';
import databaseConfig from './config/database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from './entities/inventory.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [databaseConfig, rabbitmqConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([InventoryEntity]),
  ],
  controllers: [AppController, InventoryController],
  providers: [AppService, InventoryService],
})
export class AppModule {}
