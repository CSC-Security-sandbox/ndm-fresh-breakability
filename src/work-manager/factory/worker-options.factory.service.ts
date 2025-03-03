import { Injectable } from "@nestjs/common";
import { NativeConnection } from "@temporalio/worker";
import { DiscoveryScanActivity } from "src/activities/discovery/discovery-scan-activities";
import { DiscoveryActivity } from "src/activities/discovery/discovery.activities";
import { ListPathActivity } from "src/activities/list-path/list-path.service";
import { MigrationScanService } from "src/activities/migrate/migrate.scan.service";
import { MigrationSyncService } from "src/activities/migrate/migrate.sync.service";
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanager.service";
import { SetupActivityService } from "src/activities/setup-worker/setup.activity.service";
import { ValidateConnectionActivity } from "src/activities/validate-connection/validate-connection.service";
import { WorkerConfiguration } from "../work-manager.types";
import { WorkFlowOptions } from "./worker-options.factory";
import { WorkFlowType } from "./worker-options.types";
import { ValidateWorkingDirectoryActivity } from "src/activities/working-directory/working-directory.service";
import { PrecheckActivity } from "src/activities/precheck/precheck-activity";

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
    private readonly migrationSyncService:MigrationSyncService,
    private readonly validateWorkingDirectoryActivity: ValidateWorkingDirectoryActivity,
    private readonly precheckActivity:PrecheckActivity
  ) {}

  createWorkerOptions(id: string, config: WorkerConfiguration, workerId: string, connection: NativeConnection) {
    switch (config.configName) {
      case WorkFlowType.PARENT_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'ParentWorkflow-TaskQueue', config, {
          getWorkerId: this.discoveryActivities.getWorkerId.bind(this.discoveryActivities),
          getJobState: this.discoveryActivities.getJobState.bind(this.discoveryActivities),
          setJobState: this.discoveryActivities.setJobState.bind(this.discoveryActivities),
          checkForCommonWorkersAndExportPath: this.precheckActivity.checkForCommonWorkersAndExportPath.bind(this.precheckActivity),
          generateDiscoveryReport: this.discoveryActivities.generateDiscoveryReport.bind(this.discoveryActivities),
          updateStatus: this.migrationTaskService.updateStatus.bind(this.migrationTaskService),
          updateCutOverStatus: this.migrationTaskService.updateCutOverStatus.bind(this.migrationTaskService),
          generateCOCReport: this.migrationTaskService.generateCOCReport.bind(this.migrationTaskService),
        });
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
            mountAndCheckWritePermission: this.setupActivityService.mountAndCheckWritePermission.bind(this.setupActivityService),
            getJobState: this.discoveryActivities.getJobState.bind(this.discoveryActivities),
            setJobState: this.discoveryActivities.setJobState.bind(this.discoveryActivities),
            scanPath: this.migrationScanService.scanPath.bind(this.migrationScanService),
            publishScanTask: this.migrationTaskService.publishScanTask.bind(this.migrationTaskService),
            fetchScanTask: this.migrationTaskService.fetchScanTask.bind(this.migrationTaskService),
            fetchMigrationTask: this.migrationTaskService.fetchMigrationTask.bind(this.migrationTaskService),
            updateStatus: this.migrationTaskService.updateStatus.bind(this.migrationTaskService),
            updateCutOverStatus: this.migrationTaskService.updateCutOverStatus.bind(this.migrationTaskService),
            updateLastEntry: this.migrationTaskService.updateLastEntry.bind(this.migrationTaskService),
            syncTask: this.migrationSyncService.syncTask.bind(this.migrationSyncService),
            checkForCommonWorkersAndExportPath: this.precheckActivity.checkForCommonWorkersAndExportPath.bind(this.precheckActivity),
            validateWorkingDirectory: this.validateWorkingDirectoryActivity.validateWorkingDirectory.bind(this.validateWorkingDirectoryActivity),
            isValidDirectory: this.validateWorkingDirectoryActivity.isValidDirectory.bind(this.validateWorkingDirectoryActivity),
            updateConfigStatus: this.validateWorkingDirectoryActivity.updateConfigStatus.bind(this.validateWorkingDirectoryActivity)
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
          mountAndCheckWritePermission: this.setupActivityService.mountAndCheckWritePermission.bind(this.setupActivityService),
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