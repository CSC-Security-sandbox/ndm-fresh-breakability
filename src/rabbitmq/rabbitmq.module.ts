import { Module } from '@nestjs/common';
import { RabbitmqService } from './rabbitmq.service';
import { RabbitmqController } from './rabbitmq.controller';

@Module({
  imports: [],
  controllers: [RabbitmqController],
  providers: [RabbitmqService],
})
export class RabbitmqModule {}
