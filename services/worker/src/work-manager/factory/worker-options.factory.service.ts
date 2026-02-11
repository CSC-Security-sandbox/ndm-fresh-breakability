import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NativeConnection } from "@temporalio/worker";
import { CommonActivityService } from "src/activities/common/common.service";
import { ScanService } from "src/activities/core/scan/scan-activity.service";
import { ListPathActivity } from "src/activities/list-path/list-path.service";
import { CommonTaskService } from "src/activities/core/common/common-task.service";
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
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { SyncService } from "src/activities/core/migrate/sync-activity.service";
import { MappingResolverService } from "src/activities/core/initializer/mapping-resolver.service";
import { SetupExportsPathPermissionService } from "src/activities/core/initializer/setup-exports-path-permission.service";
import { FetchFailedOperationsActivity } from "src/activities/core/retry/fetch-failed-operations.activity";
import { ProcessRetryBatchActivity } from "src/activities/core/retry/process-retry-batch.activity";
import { UpgradeActivityService } from "src/activities/upgrade/upgrade.activity.service";

@Injectable()
export class WorkerOptionsService {
  readonly jobTaskActivityConcurrency : number;
  private readonly logger: LoggerService;
  readonly shutDownForceTime: string;

  constructor(
    private readonly listPathActivityService: ListPathActivity,
    private readonly validateConnectionService: ValidateConnectionActivity,
    private readonly setupActivityService: SetupActivityService,
    private readonly validateWorkingDirectoryActivity: ValidateWorkingDirectoryActivity,
    private readonly precheckActivity:PrecheckActivity,
    private readonly commonActivityService:CommonActivityService,
    private readonly speedTestReadActivity: SpeedTestActivities,
    private readonly redismeorycheck: RedisMemoryCheckActivity,
    private readonly commonTaskService: CommonTaskService,
    private readonly scanService: ScanService,
    private readonly syncService: SyncService,
    private readonly validatePathActivity: ValidatePathActivity,
    private readonly mappingResolverService: MappingResolverService,
    private readonly setupExportsPathPermissionService: SetupExportsPathPermissionService,
    private readonly fetchFailedOperationsActivity: FetchFailedOperationsActivity,
    private readonly processRetryBatchActivity: ProcessRetryBatchActivity,
    private readonly upgradeActivityService: UpgradeActivityService,

    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.jobTaskActivityConcurrency = this.configService.get<number>('worker.maxActivityConcurrency') || 1;
    this.shutDownForceTime = this.configService.get<string>('worker.shutDownForceTime') || '10s';
    this.logger = loggerFactory.create(WorkerOptionsService.name);
    this.logger.log(`WorkerOptionsService initialized with jobTaskActivityConcurrency: ${this.jobTaskActivityConcurrency}`, WorkerOptionsService.name);
  }

  createWorkerOptions(id: string, config: WorkerConfiguration, workerId: string, connection: NativeConnection) {
    switch (config.configName) {
      case WorkFlowType.PARENT_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'ParentWorkflow-TaskQueue', config, {
          updateStatus: this.commonActivityService.updateStatus.bind(this.commonActivityService),
          updateLastEntry: this.commonActivityService.updateLastEntry.bind(this.commonActivityService),
          generateJobsReport: this.commonActivityService.generateJobsReport.bind(this.commonActivityService),
          updateJobErrorStatus: this.commonActivityService.updateJobErrorStatus.bind(this.commonActivityService),
          updateWorkerResponse: this.commonActivityService.updateWorkerResponse.bind(this.commonActivityService),
          checkMemoryUsage : this.redismeorycheck.checkMemoryUsage.bind(this.redismeorycheck),
          cleanupJobContext: this.commonActivityService.cleanupJobContext.bind(this.commonActivityService),
          isWorkflowRunningActivity: this.commonTaskService.isWorkflowRunningActivity.bind(this.commonTaskService),
          postValidationResult: this.validatePathActivity.postValidationResult.bind(this.validatePathActivity),
          generateDiscoveryReport: this.commonActivityService.generateDiscoveryReport.bind(this.commonActivityService),
          updateCutOverStatus: this.commonActivityService.updateCutOverStatus.bind(this.commonActivityService),
          generateCOCReport: this.commonActivityService.generateCOCReport.bind(this.commonActivityService),
        });
      case WorkFlowType.WORKER_SPECIFIC_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'TaskQueue', config, {
            listPath: this.listPathActivityService.listPath.bind(this.listPathActivityService),
            validate: this.validateConnectionService.validate.bind(this.validateConnectionService),
            setup: this.setupActivityService.setup.bind(this.setupActivityService),
            cleanup: this.setupActivityService.cleanup.bind(this.setupActivityService),
            updateStatus: this.commonActivityService.updateStatus.bind(this.commonActivityService),
            updateLastEntry: this.commonActivityService.updateLastEntry.bind(this.commonActivityService),
            preCheckPath: this.precheckActivity.preCheckPath.bind(this.precheckActivity),
            validateWorkingDirectory: this.validateWorkingDirectoryActivity.validateWorkingDirectory.bind(this.validateWorkingDirectoryActivity),
            isValidDirectory: this.validateWorkingDirectoryActivity.isValidDirectory.bind(this.validateWorkingDirectoryActivity),
            speedTestSetup: this.setupActivityService.speedTestSetup.bind(this.setupActivityService),
            speedTestCleanup: this.setupActivityService.speedTestCleanup.bind(this.setupActivityService),
            readActivity: this.speedTestReadActivity.readActivity.bind(this.speedTestReadActivity),
            networkPerformanceActivity: this.speedTestReadActivity.networkPerformanceActivity.bind(this.speedTestReadActivity),
            writeActivity: this.speedTestReadActivity.writeActivity.bind(this.speedTestReadActivity),
            postResultsActivity: this.speedTestReadActivity.postResultsActivity.bind(this.speedTestReadActivity),
            validatePath: this.validatePathActivity.validatePath.bind(this.validatePathActivity),
            // Upgrade activities (for WorkerDownloadWorkflow)
            ensureStagingDir: this.upgradeActivityService.ensureStagingDir.bind(this.upgradeActivityService),
            downloadBinary: this.upgradeActivityService.downloadBinary.bind(this.upgradeActivityService),
            downloadEnv: this.upgradeActivityService.downloadEnv.bind(this.upgradeActivityService),
            isBinaryStaged: this.upgradeActivityService.isBinaryStaged.bind(this.upgradeActivityService),
            getAuthToken: this.upgradeActivityService.getAuthToken.bind(this.upgradeActivityService),
            getCpBaseUrl: this.upgradeActivityService.getCpBaseUrl.bind(this.upgradeActivityService),
            detectPlatform: this.upgradeActivityService.detectPlatform.bind(this.upgradeActivityService),
        });
      case WorkFlowType.JOB_SPECIFIC_WORKFLOW:
        return new WorkFlowOptions(id, workerId, connection, 'TaskQueue', config, {
          setup: this.setupActivityService.setup.bind(this.setupActivityService),
          cleanup: this.setupActivityService.cleanup.bind(this.setupActivityService),
          updateStatus: this.commonActivityService.updateStatus.bind(this.commonActivityService),
          updateLastEntry: this.commonActivityService.updateLastEntry.bind(this.commonActivityService),
          updateConfigStatus: this.validateWorkingDirectoryActivity.updateConfigStatus.bind(this.validateWorkingDirectoryActivity),
          updateJobErrorStatus: this.commonActivityService.updateJobErrorStatus.bind(this.commonActivityService),
          updateWorkerResponse: this.commonActivityService.updateWorkerResponse.bind(this.commonActivityService),
          checkMemoryUsage : this.redismeorycheck.checkMemoryUsage.bind(this.redismeorycheck),
          // for new migration workflow 

          syncTaskActivity: this.syncService.syncTaskActivity.bind(this.syncService),
          getGroupOfTasksActivity: this.commonTaskService.getGroupOfTasksActivity.bind(this.commonTaskService),
          scanDirectories: this.scanService.scanDirectories.bind(this.scanService),
          createInitialDirBatch: this.commonTaskService.createInitialDirBatch.bind(this.commonTaskService),
          isCmdStreamLenValid: this.commonTaskService.isCmdStreamLenValid.bind(this.commonTaskService),
          resolveUsernamesToSids: this.mappingResolverService.resolveUsernamesToSids.bind(this.mappingResolverService),
          setupExportPathPermission: this.setupExportsPathPermissionService.setupExportPathPermission.bind(this.setupExportsPathPermissionService),
          // Retry workflow activities
          fetchFailedOperations: this.fetchFailedOperationsActivity.fetchFailedOperations.bind(this.fetchFailedOperationsActivity),
          processRetryBatch: this.processRetryBatchActivity.processRetryBatch.bind(this.processRetryBatchActivity),
        }, this.jobTaskActivityConcurrency, this.shutDownForceTime);
      default:
        return undefined;
    }
  }
}