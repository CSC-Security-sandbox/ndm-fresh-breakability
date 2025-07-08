import { Module } from '@nestjs/common';
import { RedisConsumerController } from './redis-consumer.controller';
import { RedisConsumerService } from './redis-consumer.service';
import { InventoryModule } from '../inventory/inventory.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';
import { JobManagerModule, RedisModule } from '@local/job-lib';

@Module({
  imports: [InventoryModule,WorkflowModule, JobManagerModule, RedisModule],
  controllers: [RedisConsumerController],
  providers: [RedisConsumerService, SpeedLogEntity, SpeedLogEntryEntity],
  exports: [RedisConsumerService],
})
export class RedisConsumerModule {}
