import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NativeConnection } from "@temporalio/worker";
import { CommonActivityService } from "src/activities/common/common.service";
import { MigrateSyncService } from "src/activities/core/migrate/migrate-sync.service";
import { ScanService } from "src/activities/core/scan/scan-activity.service";
import { DiscoveryActivity } from "src/activities/discovery/discovery.activities";
import { DiscoveryScanActivity } from "src/activities/discovery/discovery.core.activity";
import { ListPathActivity } from "src/activities/list-path/list-path.service";
import { CommonTaskService } from "src/activities/core/common/common-task.service";
import { MigrationScanService } from "src/activities/migrate/migrate.scan.service";
import { MigrationSyncService } from "src/activities/migrate/migrate.sync.service";
import { MigrationTaskService } from "src/activities/migrate/migrate.taskmanager.service";
import { PrecheckActivity } from "src/activities/precheck/precheck-activity";
import { RedisMemoryCheckActivity } from "src/activities/redis/redis.mem.usage.check.activity";
import { SetupActivityService } from "src/activities/setup-worker/setup.activity.service";
import { SpeedTestActivities } from "src/activities/speed-test/speed-test-activities";
import { ValidateConnectionActivity } from "src/activities/validate-connection/validate-connection.service";
import { ValidateWorkingDirectoryActivity } from "src/activities/working-directory/working-directory.service";
import { WorkerConfiguration } from "../work-manager.types";
import { WorkFlowOptions } from "./worker-options.factory";
import { WorkFlowType } from "./worker-options.types";
import { ValidatePathActivity } from "src/activities/validate-path/validate-path.service";

@Injectable()
export class WorkerOptionsService {
  readonly jobTaskActivityConcurrency : number;
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
    private readonly precheckActivity:PrecheckActivity,
    private readonly commonActivityService:CommonActivityService,
    private readonly speedTestReadActivity: SpeedTestActivities,
    private readonly redismeorycheck: RedisMemoryCheckActivity,
    private readonly migrateSyncService:  MigrateSyncService,
    private readonly commonTaskService: CommonTaskService,
    private readonly scanService: ScanService,
    private readonly validatePathActivity: ValidatePathActivity,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.jobTaskActivityConcurrency = this.configService.get<number>('worker.maxActivityConcurrency') || 1;
    Logger.log(`WorkerOptionsService initialized with jobTaskActivityConcurrency: ${this.jobTaskActivityConcurrency}`, WorkerOptionsService.name);
  }

  createWorkerOptions(id: string, config: WorkerConfiguration, workerId: string, connection: NativeConnection) {
    switch (config.configName) {
      case WorkFlowType.PARENT_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'ParentWorkflow-TaskQueue', config, {
          getWorkerId: this.discoveryActivities.getWorkerId.bind(this.discoveryActivities),
          getJobState: this.commonActivityService.getJobState.bind(this.commonActivityService),
          setJobState: this.commonActivityService.setJobState.bind(this.commonActivityService),
          generateDiscoveryReport: this.discoveryActivities.generateDiscoveryReport.bind(this.discoveryActivities),
          updateStatus: this.commonActivityService.updateStatus.bind(this.commonActivityService),
          updateLastEntry: this.commonActivityService.updateLastEntry.bind(this.commonActivityService),
          updateCutOverStatus: this.migrationTaskService.updateCutOverStatus.bind(this.migrationTaskService),
          generateCOCReport: this.migrationTaskService.generateCOCReport.bind(this.migrationTaskService),
          generateJobsReport: this.commonActivityService.generateJobsReport.bind(this.commonActivityService),
          updateJobErrorStatus: this.commonActivityService.updateJobErrorStatus.bind(this.commonActivityService),
          updateWorkerResponse: this.commonActivityService.updateWorkerResponse.bind(this.commonActivityService),
          checkMemoryUsage : this.redismeorycheck.checkMemoryUsage.bind(this.redismeorycheck),
          cleanupJobContext: this.commonActivityService.cleanupJobContext.bind(this.commonActivityService),
          isWorkflowRunningActivity: this.commonTaskService.isWorkflowRunningActivity.bind(this.commonTaskService),
          postValidationResult: this.validatePathActivity.postValidationResult.bind(this.validatePathActivity),
        });
      case WorkFlowType.WORKER_SPECIFIC_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'TaskQueue', config, {
            listPath: this.listPathActivityService.listPath.bind(this.listPathActivityService),
            validate: this.validateConnectionService.validate.bind(this.validateConnectionService),
            publishTask: this.discoveryActivities.publishTask.bind(this.discoveryActivities),
            discoveryStatusUpdate: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
            discoveryProcess: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
            scanActivity: this.discoveryScanActivity.scanActivity.bind(this.discoveryScanActivity),
            publishLastEntry: this.discoveryActivities.publishLastEntry.bind(this.discoveryActivities),
            setup: this.setupActivityService.setup.bind(this.setupActivityService),
            cleanup: this.setupActivityService.cleanup.bind(this.setupActivityService),
            getJobState: this.commonActivityService.getJobState.bind(this.commonActivityService),
            setJobState: this.commonActivityService.setJobState.bind(this.commonActivityService),
            scanPath: this.migrationScanService.scanPath.bind(this.migrationScanService),
            publishScanTask: this.migrationTaskService.publishScanTask.bind(this.migrationTaskService),
            updateStatus: this.commonActivityService.updateStatus.bind(this.commonActivityService),
            updateCutOverStatus: this.migrationTaskService.updateCutOverStatus.bind(this.migrationTaskService),
            updateLastEntry: this.commonActivityService.updateLastEntry.bind(this.commonActivityService),
            syncTask: this.migrationSyncService.syncTask.bind(this.migrationSyncService),
            preCheckPath: this.precheckActivity.preCheckPath.bind(this.precheckActivity),
            validateWorkingDirectory: this.validateWorkingDirectoryActivity.validateWorkingDirectory.bind(this.validateWorkingDirectoryActivity),
            isValidDirectory: this.validateWorkingDirectoryActivity.isValidDirectory.bind(this.validateWorkingDirectoryActivity),
            speedTestSetup: this.setupActivityService.speedTestSetup.bind(this.setupActivityService),
            speedTestCleanup: this.setupActivityService.speedTestCleanup.bind(this.setupActivityService),
            readActivity: this.speedTestReadActivity.readActivity.bind(this.speedTestReadActivity),
            networkPerformanceActivity: this.speedTestReadActivity.networkPerformanceActivity.bind(this.speedTestReadActivity),
            writeActivity: this.speedTestReadActivity.writeActivity.bind(this.speedTestReadActivity),
            postResultsActivity: this.speedTestReadActivity.postResultsActivity.bind(this.speedTestReadActivity),
            getJobStateAndUpdateTaskList: this.commonActivityService.getJobStateAndUpdateTaskList.bind(this.commonActivityService),
            validatePath: this.validatePathActivity.validatePath.bind(this.validatePathActivity),
        });
      case WorkFlowType.JOB_SPECIFIC_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'TaskQueue', config, {
          publishTask: this.discoveryActivities.publishTask.bind(this.discoveryActivities),
          discoveryStatusUpdate: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
          discoveryProcess: this.discoveryActivities.discoveryStatusUpdate.bind(this.discoveryActivities),
          scanActivity: this.discoveryScanActivity.scanActivity.bind(this.discoveryScanActivity),
          publishLastEntry: this.discoveryActivities.publishLastEntry.bind(this.discoveryActivities),
          setup: this.setupActivityService.setup.bind(this.setupActivityService),
          cleanup: this.setupActivityService.cleanup.bind(this.setupActivityService),
          scanPath: this.migrationScanService.scanPath.bind(this.migrationScanService),
          publishScanTask: this.migrationTaskService.publishScanTask.bind(this.migrationTaskService),
          updateStatus: this.commonActivityService.updateStatus.bind(this.commonActivityService),
          updateLastEntry: this.commonActivityService.updateLastEntry.bind(this.commonActivityService),
          syncTask: this.migrationSyncService.syncTask.bind(this.migrationSyncService),
          updateConfigStatus: this.validateWorkingDirectoryActivity.updateConfigStatus.bind(this.validateWorkingDirectoryActivity),
          updateJobErrorStatus: this.commonActivityService.updateJobErrorStatus.bind(this.commonActivityService),
          getJobState: this.commonActivityService.getJobState.bind(this.commonActivityService),
          setJobState: this.commonActivityService.setJobState.bind(this.commonActivityService),
          getJobStateWithStreamLoad: this.commonActivityService.getJobStateWithStreamLoad.bind(this.commonActivityService),
          getJobStateAndUpdateTaskList: this.commonActivityService.getJobStateAndUpdateTaskList.bind(this.commonActivityService),
          updateWorkerResponse: this.commonActivityService.updateWorkerResponse.bind(this.commonActivityService),
          checkMemoryUsage : this.redismeorycheck.checkMemoryUsage.bind(this.redismeorycheck),
          hasRunningScanTask: this.commonActivityService.hasRunningScanTask.bind(this.commonActivityService),
          hasRunningSyncTask: this.commonActivityService.hasRunningSyncTask.bind(this.commonActivityService),
          // for new migration workflow 

          syncTaskActivity: this.migrateSyncService.syncTaskActivity.bind(this.migrateSyncService),
          getGroupOfTasksActivity: this.commonTaskService.getGroupOfTasksActivity.bind(this.commonTaskService),
          scanDirectories: this.scanService.scanDirectories.bind(this.scanService),
          createInitialDirBatch: this.commonTaskService.createInitialDirBatch.bind(this.commonTaskService),
        }, this.jobTaskActivityConcurrency);
      default:
        return undefined;
    }
  }
}