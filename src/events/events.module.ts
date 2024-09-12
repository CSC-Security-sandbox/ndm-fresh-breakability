import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbtMqService } from './rabbitmq.service';
import { EventsController } from './events.controller';

import { EventsService } from './events.service';
import { RequestTrack, RequestTrackSchema } from 'src/schemas/RequestTrack.schema';
import { Project, ProjectSchema } from 'src/schemas/Project.schema';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentEntity, RequestTrackEntity]),
    MongooseModule.forFeature([
    {
      name: Project.name,
      schema: ProjectSchema
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
