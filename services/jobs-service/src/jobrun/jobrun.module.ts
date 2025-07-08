import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpeedTestConfigEntity, SpeedTestConfigWorkerEntity } from "src/entities/speed-test-job-config.entity";
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunController } from './jobrun.controller';
import { JobRunService } from './jobrun.service';

import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { JobOptionsEntity } from 'src/entities/joboptions.entity';
import { OperationsEntity } from 'src/entities/operation.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { JobConfigService } from 'src/jobconfig/jobconfig.service';
import { WorkerModule } from 'src/workers/workers.module';
import { WorkflowService } from 'src/workflow/workflow.service';
import { NetworkPerformanceResultEntity, SpeedLogEntity, SpeedLogEntryEntity, SpeedTestResultEntity } from '../entities/speed-test-result.entity';
import { JobRunInitService } from './jobrun.init.service';

import { JobManagerModule, RedisModule } from '@local/job-lib';
import { ErrorRemedyEntity } from 'src/entities/error-remedies.entity';
import { IdentityConfigCrossMappingEntity } from 'src/entities/indentity-mapping-cross.entity';
import { IdentityMappingEntity } from 'src/entities/indentity-mapping.entity';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';
import { SyncEmailEntity } from 'src/entities/sync-email.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { ErrorRemedyService } from 'src/errorremedies/errorremedies.service';
import { SendMailService } from 'src/utils/send-email';
import { WorkersService } from 'src/workers/workers.service';
import { JobRunActionService } from './jobrun-action.service';


@Module({
    imports: [
        LoggerModule.forRoot(),
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([JobConfigEntity, SpeedTestConfigEntity, SpeedTestConfigWorkerEntity,JobRunEntity, WorkerJobRunMap, JobOptionsEntity, InventoryEntity, ProjectEntity,TaskEntity,OperationsEntity, VolumeEntity, FileServerEntity, SpeedLogEntity, NetworkPerformanceResultEntity, SpeedTestResultEntity, SpeedLogEntryEntity, OperationErrorEntity, WorkerEntity,IdentityConfigCrossMappingEntity,IdentityMappingEntity, ErrorRemedyEntity, SyncEmailEntity]),
        WorkerModule,
        RedisModule,
        JobManagerModule
    ],
    providers: [JobRunService, JobConfigService,WorkflowService,WorkflowService, JobRunInitService, WorkerEntity,SendMailService, ErrorRemedyService,WorkersService, JobRunActionService],
    controllers: [JobRunController]
})
export class JobRunModule {}
