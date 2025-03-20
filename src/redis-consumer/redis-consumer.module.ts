import { Module } from '@nestjs/common';
import { RedisConsumerController } from './redis-consumer.controller';
import { RedisConsumerService } from './redis-consumer.service';
import { InventoryModule } from 'src/inventory/inventory.module';
import { WorkflowModule } from 'src/workflow/workflow.module';

@Module({
  imports: [InventoryModule,WorkflowModule],
  controllers: [RedisConsumerController],
  providers: [RedisConsumerService],
  exports: [RedisConsumerService],
})
export class RedisConsumerModule {}
