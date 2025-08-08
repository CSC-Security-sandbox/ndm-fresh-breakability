import { Module } from '@nestjs/common';
import { RedisConsumerController } from './redis-consumer.controller';
import { RedisConsumerService } from './redis-consumer.service';
import { InventoryModule } from '../inventory/inventory.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';
import {
  LoggerModule
} from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [LoggerModule.forRoot(), InventoryModule,WorkflowModule],
  controllers: [RedisConsumerController],
  providers: [RedisConsumerService, SpeedLogEntity, SpeedLogEntryEntity],
  exports: [RedisConsumerService],
})
export class RedisConsumerModule {}
