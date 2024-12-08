import { Module } from '@nestjs/common';
import { EventsGateway } from './getway/events.gateway';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from 'src/entities/project.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { EventsController } from './controller/events.controller';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { RabbiMqController } from './controller/rabbimq.controller';
import { TaskService } from 'src/tasks/tasks.service';
import { TaskEntity } from 'src/entities/task.entity';
import { WorkManager } from './workmanager/workmanager.service';
import { OperationsEntity } from 'src/entities/operation.entity';
import { RabbitMqService } from './service/rabbitmq/rabbitmq.service';
import { EventsService } from './service/events/events.service';
import { FileConfigService } from './service/config/config.service';
import { RequestTrackService } from './service/requesttack/requesttrack.service';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerEntity, RequestTrackEntity, ProjectEntity, FileServerEntity, VolumeEntity, ConfigEntity, TaskEntity,OperationsEntity, WorkerJobRunMap]),],
  exports: [EventsGateway],
  providers: [EventsGateway, RabbitMqService, EventsService,FileConfigService, RequestTrackService, TaskService, WorkManager],
  controllers: [EventsController, RabbiMqController]
})
export class EventsModule {}
