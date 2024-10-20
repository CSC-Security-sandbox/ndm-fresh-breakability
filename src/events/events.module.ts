import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsGateway } from './events.gateway';
import { RabbitMqService } from './rabbitmq.service';

import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerEntity } from 'src/entities/worker.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { EventsService } from './events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerEntity, RequestTrackEntity, ProjectEntity]),],
  exports: [EventsGateway],
  providers: [EventsGateway, RabbitMqService, EventsService],
  controllers: [EventsController]
})
export class EventsModule {}
