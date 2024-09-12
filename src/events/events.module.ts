import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsController } from './events.controller';
import { EventsGateway } from './events.gateway';
import { RabbtMqService } from './rabbitmq.service';

import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { Project, ProjectSchema } from 'src/schemas/Project.schema';
import { EventsService } from './events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentEntity, RequestTrackEntity]),
    MongooseModule.forFeature([
    {
      name: Project.name,
      schema: ProjectSchema
  }])
],
  exports: [EventsGateway, MongooseModule],
  providers: [EventsGateway, RabbtMqService, EventsService],
  controllers: [EventsController]
})
export class EventsModule {}
