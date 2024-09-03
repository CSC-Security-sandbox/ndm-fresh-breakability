import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbtMqService } from './rabbitmq.service';
import { EventsController } from './events.controller';
import {  AgentStatus, AgentStatusSchema } from 'src/schemas/Agent.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{
        name: AgentStatus.name,
        schema: AgentStatusSchema
    }])
],
  exports: [EventsGateway, MongooseModule],
  providers: [EventsGateway, RabbtMqService],
  controllers: [EventsController]
})
export class EventsModule {}
