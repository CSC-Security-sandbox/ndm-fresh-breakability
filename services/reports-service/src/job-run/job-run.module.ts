import { Logger } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JobRunController } from "./job-run.controller";
import { JobRunService } from "./job-run.service";
import { InventoryEntity } from "src/entities/inventory.entity";
import { ReportsEntity } from "src/entities/reports.entity";
import { CsvService } from "src/csv/csv_export.service";
import { ErrorLogService } from "src/csv/error_log_csv.service";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { TaskEntity } from "src/entities/task.entity";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { AuthKeycloakModule } from "@netapp-cloud-datamigrate/auth-lib";
import { JobStatsSummaryMvEntity } from "src/entities/job-stats-summary-mv.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JobRunEntity,
      InventoryEntity,
      TaskEntity,
      ReportsEntity,
      OperationErrorEntity,
      WorkerJobRunMap,
      JobStatsSummaryMvEntity
    ]),
    AuthKeycloakModule,
  ],
  controllers: [JobRunController],
  providers: [JobRunService, CsvService, Logger, ErrorLogService],
})
export class JobRunModule {}
