import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JobConfigEntity } from "src/entities/jobconfig.entity";
import {
  SpeedTestConfigEntity,
  SpeedTestConfigWorkerEntity,
} from "src/entities/speed-test-job-config.entity";

import {
  SpeedLogEntity,
  NetworkPerformanceResultEntity,
  SpeedTestResultEntity,
  SpeedLogEntryEntity,
} from "../entities/speed-test-result.entity";

import { JobConfigController } from "./jobconfig.controller";
import { JobConfigService } from "./jobconfig.service";

import { InventoryEntity } from "src/entities/inventory.entity";
import { JobIdMappingEntity } from "../entities/jobmapping.entity";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { WorkflowService } from "src/workflow/workflow.service";
import { LoggerModule } from "@netapp-cloud-datamigrate/logger-lib";
import { FileServerWorkingDirectoryMappingEntity } from "src/entities/fileserver_workingdirectory_mapping.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { IdentityConfigCrossMappingEntity } from "src/entities/indentity-mapping-cross.entity";
import { RedisModule } from "src/redis/redis.module";
import { JobRunService } from "src/jobrun/jobrun.service";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { SendMailService } from "src/utils/send-email";
import { MigrationConflictModule } from "../migration-conflict/migration-conflict.module";
import { SyncEmailEntity } from "src/entities/sync-email.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { PreCheckService } from "./precheck.service";
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';


@Module({
  imports: [
    LoggerModule.forRoot(),
    TypeOrmModule.forFeature([
      JobConfigEntity,
      SpeedTestConfigEntity,
      SpeedTestConfigWorkerEntity,
      JobIdMappingEntity,
      InventoryEntity,
      ProjectEntity,
      VolumeEntity,
      FileServerEntity,
      FileServerWorkingDirectoryMappingEntity,
      JobRunEntity,
      SpeedLogEntity,
      NetworkPerformanceResultEntity,
      SpeedTestResultEntity,
      SpeedLogEntryEntity,
      WorkerEntity,
      IdentityMappingEntity,
      IdentityConfigCrossMappingEntity,
      OperationErrorEntity,
      SyncEmailEntity,
      WorkerJobRunMap
    ]),
    RedisModule,
    AuthKeycloakModule,
    MigrationConflictModule,
  ],
  providers: [JobConfigService, WorkflowService, SendMailService, PreCheckService],
  controllers: [JobConfigController],
})
export class JobConfigModule {}
