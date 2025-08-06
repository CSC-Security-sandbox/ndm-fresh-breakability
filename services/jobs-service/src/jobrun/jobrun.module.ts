import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunService } from './jobrun.service';
import { JobRunController } from './jobrun.controller';
import { JobConfigEntity} from '../entities/jobconfig.entity';
import {SpeedTestConfigEntity, SpeedTestConfigWorkerEntity } from "src/entities/speed-test-job-config.entity"

import {SpeedLogEntity, NetworkPerformanceResultEntity, SpeedTestResultEntity, SpeedLogEntryEntity} from '../entities/speed-test-result.entity'
import { JobConfigService } from 'src/jobconfig/jobconfig.service';
import { ScheduleModule } from '@nestjs/schedule';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { JobOptionsEntity } from 'src/entities/joboptions.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { WorkflowService } from 'src/workflow/workflow.service';
import { TaskEntity } from 'src/entities/task.entity';
import { OperationsEntity } from 'src/entities/operation.entity';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerModule } from 'src/workers/workers.module';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { JobRunInitService } from './jobrun.init.service';
import { RedisModule } from 'src/redis/redis.module';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { IdentityConfigCrossMappingEntity } from 'src/entities/indentity-mapping-cross.entity';
import { IdentityMappingEntity } from 'src/entities/indentity-mapping.entity';
import { SendMailService } from 'src/utils/send-email';
import { ErrorRemedyService } from 'src/errorremedies/errorremedies.service';
import { ErrorRemedyEntity } from 'src/entities/error-remedies.entity';
import { WorkersService } from 'src/workers/workers.service';
import { SyncEmailEntity } from 'src/entities/sync-email.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';import { JobRunActionService } from './jobrun-action.service';
import { MigrationConflictModule } from 'src/migration-conflict/migration-conflict.module';


@Module({
    imports: [
        LoggerModule.forRoot(),
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([JobConfigEntity, SpeedTestConfigEntity, SpeedTestConfigWorkerEntity,JobRunEntity, WorkerJobRunMap, JobOptionsEntity, InventoryEntity, ProjectEntity,TaskEntity,OperationsEntity, VolumeEntity, FileServerEntity, SpeedLogEntity, NetworkPerformanceResultEntity, SpeedTestResultEntity, SpeedLogEntryEntity, OperationErrorEntity, WorkerEntity,IdentityConfigCrossMappingEntity,IdentityMappingEntity, ErrorRemedyEntity, SyncEmailEntity]),
        WorkerModule,
        RedisModule,
        AuthKeycloakModule,
        MigrationConflictModule
    ],
    providers: [JobRunService, JobConfigService,WorkflowService,WorkflowService, JobRunInitService, WorkerEntity,SendMailService, ErrorRemedyService,WorkersService, JobRunActionService],
    controllers: [JobRunController]
})
export class JobRunModule {}
