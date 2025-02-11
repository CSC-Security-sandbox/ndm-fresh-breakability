import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunService } from './jobrun.service';
import { JobRunController } from './jobrun.controller';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigService } from 'src/jobconfig/jobconfig.service';
import { ScheduleModule } from '@nestjs/schedule';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { JobOptionsEntity } from 'src/entities/joboptions.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { WorkflowService } from 'src/workflow/workflow.service';
import { WorkManager } from 'src/events/workmanager/workmanager.service';
import { TaskEntity } from 'src/entities/task.entity';
import { OperationsEntity } from 'src/entities/operation.entity';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerModule } from 'src/workers/workers.module';


@Module({
    imports: [
        LoggerModule.forRoot(),
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([JobConfigEntity, JobRunEntity, WorkerJobRunMap, JobOptionsEntity, InventoryEntity, ProjectEntity,TaskEntity,OperationsEntity, VolumeEntity]),
        WorkerModule
    ],
    providers: [JobRunService, JobConfigService,WorkflowService,WorkManager,WorkflowService],
    controllers: [JobRunController]
})
export class JobRunModule {}
