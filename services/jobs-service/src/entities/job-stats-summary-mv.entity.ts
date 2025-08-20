import { ApiProperty } from "@nestjs/swagger";
import { ViewEntity, ViewColumn } from "typeorm";

@ViewEntity({
  name: "job_stats_summary_mv",
  schema: "datamigrator",
  materialized: true,
})
export class JobStatsSummaryMvEntity {
  @ApiProperty({ description: "UUID of the job run" })
  @ViewColumn({ name: "job_run_id" })
  jobRunId: string;

  @ApiProperty({ description: "Number of files in the inventory" })
  @ViewColumn({ name: "file_count" })
  fileCount: string;

  @ApiProperty({ description: "Number of directories in the inventory" })
  @ViewColumn({ name: "directory_count" })
  directoryCount: string;

  @ApiProperty({ description: "Total size of all files in bytes" })
  @ViewColumn({ name: "total_size" })
  totalSize: string;

  @ApiProperty({ description: "Total number of items (files + directories)" })
  @ViewColumn({ name: "total_items" })
  totalItems: number;

  @ApiProperty({ description: "Last time inventory was updated" })
  @ViewColumn({ name: "last_inventory_update" })
  lastInventoryUpdate: Date;

  @ApiProperty({ description: "Number of completed tasks" })
  @ViewColumn({ name: "task_completed" })
  completed: number;

  @ApiProperty({ description: "Number of pending tasks" })
  @ViewColumn({ name: "task_pending" })
  pending: number;

  @ApiProperty({ description: "Number of errored tasks" })
  @ViewColumn({ name: "task_errored" })
  errored: number;

  @ApiProperty({ description: "Number of running tasks" })
  @ViewColumn({ name: "task_running" })
  running: number;

  @ApiProperty({ description: "Number of completed with error tasks" })
  @ViewColumn({ name: "completed_with_error" })
  completedWithError: number;

  @ApiProperty({ description: "Total number of tasks" })
  @ViewColumn({ name: "total_tasks" })
  totalTasks: number;

  @ApiProperty({ description: "Last time tasks were updated" })
  @ViewColumn({ name: "last_task_update" })
  lastTaskUpdate: Date;

  @ApiProperty({ description: "Last time any data was updated" })
  @ViewColumn({ name: "last_data_update" })
  lastDataUpdate: Date;

  @ApiProperty({ description: "Last time the materialized view was refreshed" })
  @ViewColumn({ name: "last_refreshed" })
  lastRefreshed: Date;

  @ApiProperty({ description: "Job run status" })
  @ViewColumn({ name: "job_run_status" })
  jobRunStatus: string;
}
