import { Module } from '@nestjs/common';
import { RedisConsumerService } from './redis-consumer.service';
import { RedisConsumerController } from './redis-consumer.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { InventoryService } from 'src/inventory/inventory.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { OperationsEntity } from 'src/entities/operation.entity';

@Module({
  imports: [ScheduleModule.forRoot(),  
    TypeOrmModule.forFeature([InventoryEntity,TaskEntity,OperationsEntity]),],
  controllers: [RedisConsumerController],
  providers: [RedisConsumerService,InventoryService],
})
export class RedisConsumerModule {}
