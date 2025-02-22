import { Injectable } from "@nestjs/common";
import { WorkFlowOptions } from "./worker-options.factory";
import { WorkerConfiguration } from "../work-manager.types";
import { ListPathActivity } from "src/activities/list-path/list-path.service";
import { WorkFlowType } from "./worker-options.types";
import { NativeConnection } from "@temporalio/worker";
import { ValidateConnectionActivity } from "src/activities/validate-connection/validate-connection.service";
import { DiscoveryActivity } from "src/activities/discovery/discovery.activities";
import { DiscoveryScanActivity } from "src/activities/discovery/discovery-scan-activities";
import { SetupActivityService } from "src/activities/setup-worker/setup.activity.service";
import { MigrationScanService } from "src/activities/migrate/migrate.scan.service";
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanager.service";
import { MigrationSyncService } from "src/activities/migrate/migrate.sync.service";

@Injectable()
export class WorkerOptionsService {
  constructor(
    private readonly listPathActivityService: ListPathActivity,
    private readonly validateConnectionService: ValidateConnectionActivity,
    private readonly discoveryActivities: DiscoveryActivity,
    private readonly discoveryScanActivity: DiscoveryScanActivity,
    private readonly setupActivityService: SetupActivityService,
    private readonly migrationScanService: MigrationScanService,
    private readonly migrationTaskService: MigrationTaskService,
    private readonly migrationSyncService:MigrationSyncService
  ) {}

  createWorkerOptions(id: string, config: WorkerConfiguration, workerId: string, connection: NativeConnection) {
    switch (config.configName) {
      case WorkFlowType.PARENT_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'ParentWorkflow-TaskQueue', config);
      case WorkFlowType.WORKER_SPECIFIC_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'TaskQueue', config, {
            listPath: this.listPathActivityService.listPath.bind(this.listPathActivityService),
            validate: this.validateConnectionService.validate.bind(this.validateConnectionService),
            fetchTasks: this.discoveryActivities.fetchTasks.bind(this.discoveryActivities),
            publishTask: this.discoveryActivities.publishTask.bind(this.discoveryActivities),
            discoveryStatusUpdate: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
            discoveryProcess: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
            scanActivity: this.discoveryScanActivity.scanActivity.bind(this.discoveryScanActivity),
            publishLastEntry: this.discoveryActivities.publishLastEntry.bind(this.discoveryActivities),
            setup: this.setupActivityService.setup.bind(this.setupActivityService),
            cleanup: this.setupActivityService.cleanup.bind(this.setupActivityService),
            scanPath: this.migrationScanService.scanPath.bind(this.migrationScanService),
            publishScanTask: this.migrationTaskService.publishScanTask.bind(this.migrationTaskService),
            fetchScanTask: this.migrationTaskService.fetchScanTask.bind(this.migrationTaskService),
            fetchMigrationTask: this.migrationTaskService.fetchMigrationTask.bind(this.migrationTaskService),
            updateStatus: this.migrationTaskService.updateStatus.bind(this.migrationTaskService),
            updateLastEntry: this.migrationTaskService.updateLastEntry.bind(this.migrationTaskService),
            syncTask: this.migrationSyncService.syncTask.bind(this.migrationSyncService)
        });
      case WorkFlowType.JOB_SPECIFIC_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'TaskQueue', config, {
          fetchTasks: this.discoveryActivities.fetchTasks.bind(this.discoveryActivities),
          publishTask: this.discoveryActivities.publishTask.bind(this.discoveryActivities),
          discoveryStatusUpdate: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
          discoveryProcess: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
          scanActivity: this.discoveryScanActivity.scanActivity.bind(this.discoveryScanActivity),
          publishLastEntry: this.discoveryActivities.publishLastEntry.bind(this.discoveryActivities),
          setup: this.setupActivityService.setup.bind(this.setupActivityService),
          cleanup: this.setupActivityService.cleanup.bind(this.setupActivityService),
          scanPath: this.migrationScanService.scanPath.bind(this.migrationScanService),
          publishScanTask: this.migrationTaskService.publishScanTask.bind(this.migrationTaskService),
          fetchScanTask: this.migrationTaskService.fetchScanTask.bind(this.migrationTaskService),
          fetchMigrationTask: this.migrationTaskService.fetchMigrationTask.bind(this.migrationTaskService),
          updateStatus: this.migrationTaskService.updateStatus.bind(this.migrationTaskService),
          updateLastEntry: this.migrationTaskService.updateLastEntry.bind(this.migrationTaskService),
          syncTask: this.migrationSyncService.syncTask.bind(this.migrationSyncService)
        });
      default:
        return undefined;
    }
  }
}