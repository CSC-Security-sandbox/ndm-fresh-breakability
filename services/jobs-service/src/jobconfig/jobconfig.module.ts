import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JobConfigEntity } from "src/entities/jobconfig.entity";
import {
  SpeedTestConfigEntity,
  SpeedTestConfigWorkerEntity,
} from "src/entities/speed-test-job-config.entity";

import {
  NetworkPerformanceResultEntity,
  SpeedLogEntity,
  SpeedLogEntryEntity,
  SpeedTestResultEntity,
} from "../entities/speed-test-result.entity";

import { JobConfigController } from "./jobconfig.controller";
import { JobConfigService } from "./jobconfig.service";

import { LoggerModule } from "@netapp-cloud-datamigrate/logger-lib";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { FileServerWorkingDirectoryMappingEntity } from "src/entities/fileserver_workingdirectory_mapping.entity";
import { IdentityConfigCrossMappingEntity } from "src/entities/indentity-mapping-cross.entity";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { WorkflowService } from "src/workflow/workflow.service";
import { JobIdMappingEntity } from "../entities/jobmapping.entity";

import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { SyncEmailEntity } from "src/entities/sync-email.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { SendMailService } from "src/utils/send-email";
import { PreCheckService } from "./precheck.service";
import { RedisModule } from "@local/job-lib";


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
  ],
  providers: [JobConfigService, WorkflowService, SendMailService, PreCheckService],
  controllers: [JobConfigController],
})
export class JobConfigModule {}
