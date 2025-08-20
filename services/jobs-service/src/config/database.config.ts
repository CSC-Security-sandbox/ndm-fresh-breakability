import { registerAs } from "@nestjs/config";
import { WorkerEntity } from "src/entities/worker.entity";
import { ConfigEntity } from "src/entities/config.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { InventoryEntity } from "src/entities/inventory.entity";
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
import { ProjectEntity } from "src/entities/project.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { DataSourceOptions } from "typeorm";
import { JobIdMappingEntity } from "../entities/jobmapping.entity";
import { JobRunEntity } from "../entities/jobrun.entity";
import { TaskEntity } from "../entities/task.entity";
import { OperationsEntity } from "src/entities/operation.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { JobOptionsEntity } from "src/entities/joboptions.entity";
import { FileServerWorkingDirectoryMappingEntity } from "src/entities/fileserver_workingdirectory_mapping.entity";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { TaskErrorEntity } from "src/entities/task-error.entity";
import { IdentityConfigCrossMappingEntity } from "src/entities/indentity-mapping-cross.entity";
import { IdentityMappingEntity } from "src/entities/indentity-mapping.entity";
import { ErrorRemedyEntity } from "src/entities/error-remedies.entity";
import { WorkerStatsEntity } from "src/entities/worker-stats.entity";
import { SyncEmailEntity } from "src/entities/sync-email.entity";
import { JobStatsSummaryMvEntity } from "src/entities/job-stats-summary-mv.entity";

export default registerAs(
  "typeorm",
  (): DataSourceOptions => ({
    type: "postgres",
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    schema: process.env.SCHEMA,
    synchronize: false,
    dropSchema: false,
    logging: false,
    entities: [
      WorkerEntity,
      ConfigEntity,
      InventoryEntity,
      FileServerEntity,
      VolumeEntity,
      ProjectEntity,
      JobConfigEntity,
      JobIdMappingEntity,
      JobRunEntity,
      TaskEntity,
      OperationsEntity,
      WorkerJobRunMap,
      JobOptionsEntity,
      FileServerWorkingDirectoryMappingEntity,
      SpeedTestConfigEntity,
      SpeedTestConfigWorkerEntity,
      SpeedLogEntity,
      NetworkPerformanceResultEntity,
      SpeedTestResultEntity,
      SpeedLogEntryEntity,
      OperationErrorEntity,
      TaskErrorEntity,
      IdentityConfigCrossMappingEntity,
      IdentityMappingEntity, ErrorRemedyEntity,
      WorkerStatsEntity,
      SyncEmailEntity,
      JobStatsSummaryMvEntity
    ],
    migrations: [],
  }),
);
