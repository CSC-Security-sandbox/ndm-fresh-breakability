import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsGateway } from './events.gateway';
import { RabbtMqService } from './rabbitmq.service';

import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { EventsService } from './events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentEntity, RequestTrackEntity, ProjectEntity]),],
  exports: [EventsGateway],
  providers: [EventsGateway, RabbtMqService, EventsService],
  controllers: [EventsController]
})
export class EventsModule {}
