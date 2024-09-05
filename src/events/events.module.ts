import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbtMqService } from './rabbitmq.service';
import { EventsController } from './events.controller';
import {  AgentStatus, AgentStatusSchema } from 'src/schemas/Agent.schema';
import { EventsService } from './events.service';
import { RequestTrack, RequestTrackSchema } from 'src/schemas/RequestTrack.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{
        name: AgentStatus.name,
        schema: AgentStatusSchema
    },
    {
      name: RequestTrack.name,
      schema: RequestTrackSchema
  }])
],
  exports: [EventsGateway, MongooseModule],
  providers: [EventsGateway, RabbtMqService, EventsService],
  controllers: [EventsController]
})
export class EventsModule {}
