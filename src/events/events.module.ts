import { Module } from '@nestjs/common';
import { EventsGateway } from './getway/events.gateway';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from 'src/entities/project.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { RabbitMqService } from './service/rabbitmq.service';
import { EventsController } from './controller/events.controller';
import { EventsService } from './service/events.service';
import { FileConfigService } from './service/config.service';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { RabbiMqController } from './controller/rabbimq.controller';
import { RequestTrackService } from './service/requesttrack.service';
import { TaskService } from 'src/tasks/tasks.service';
import { TaskEntity } from 'src/entities/task.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerEntity, RequestTrackEntity, ProjectEntity, FileServerEntity, VolumeEntity, ConfigEntity, TaskEntity]),],
  exports: [EventsGateway],
  providers: [EventsGateway, RabbitMqService, EventsService,FileConfigService, RequestTrackService, TaskService],
  controllers: [EventsController, RabbiMqController]
})
export class EventsModule {}
