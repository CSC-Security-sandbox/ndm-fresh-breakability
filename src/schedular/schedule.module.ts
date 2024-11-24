import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { SchedularService } from './schedule.service';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { SchedularController } from './schedule.controller';
import { JobRunService } from '../jobrun/jobrun.service';
import { RabbitMqService } from '../events/rabbitmq.service';
import { JobRunEntity } from '../entities/jobrun.entity';
import { EventsGateway } from '../events/events.gateway';
import { WorkerEntity } from '../entities/worker.entity';
import { RequestTrackEntity } from '../entities/requesttrack.entity';
import { ProjectEntity } from '../entities/project.entity';
import { TaskEntity } from '../entities/task.entity';
import { TaskService } from './../tasks/tasks.service';
import { WorkersService } from '../workers/workers.service';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([JobConfigEntity, JobRunEntity, WorkerEntity, RequestTrackEntity, ProjectEntity, TaskEntity])
    ],
    providers: [SchedularService, JobConfigService, JobRunService, RabbitMqService, EventsGateway, TaskService, WorkersService],
    controllers: [SchedularController],
})
export class SchedularModule {}
