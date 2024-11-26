import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { SchedularService } from './schedule.service';
import { JobConfigService } from '../jobconfig/jobconfig.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { SchedularController } from './schedule.controller';
import { JobRunService } from '../jobrun/jobrun.service';
import { RabbitMqService } from '../events/service/rabbitmq.service';
import { JobRunEntity } from '../entities/jobrun.entity';
import { WorkerEntity } from '../entities/worker.entity';
import { EventsModule } from '../events/events.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        EventsModule,
        TypeOrmModule.forFeature([JobConfigEntity, JobRunEntity, WorkerEntity])
    ],
    providers: [SchedularService, JobConfigService, JobRunService, RabbitMqService],
    controllers: [SchedularController],
})
export class SchedularModule {}
