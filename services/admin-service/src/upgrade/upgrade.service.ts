import { Injectable, Inject, NotFoundException, BadRequestException, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkFlows } from '../workflow/workflow.types';
import {
  MulticastRequestDto,
  MulticastResponseDto,
  MulticastStatusDto,
  WorkerAckDto,
  ExecuteUpgradeRequestDto,
  ExecuteUpgradeResponseDto,
  ExecutionStatusDto,
  ExecutionAckDto,
  WorkerExecutionStatusDto,
} from './dto/multicast.dto';
import { WorkerEntity } from '../entities/worker.entity';
import { UpgradeBundleStatus, UpgradeExecutionStatus } from '../constants/worker.enums';

/**
 * Base path for upgrade bundles on CP.
 * Structure: /upgrade/{version}/worker/{linux|windows|env}/
 */
const CP_UPGRADE_BASE = '/upgrade';

/**
 * Task queue for parent workflows
 */
const PARENT_TASK_QUEUE = 'ParentWorkflow-TaskQueue';

/** Max seconds since last health check to consider a worker healthy. */
const WORKER_HEALTH_TIMEOUT_SECONDS = 20; // window of 3 pings from worker 

@Injectable()
export class UpgradeService {
  private logger: LoggerService;

  constructor(
    private readonly configService: ConfigService,
    private readonly workflowService: WorkflowService,
    @InjectRepository(WorkerEntity)
    private readonly workerRepository: Repository<WorkerEntity>,
    @Inject(LoggerFactory) private loggerFactory: LoggerFactory,
  ) {
    this.logger = this.loggerFactory.create(UpgradeService.name);
  }

  // Helper functions
  // Sanitize version string to prevent path traversal attacks.
  private sanitizeVersion(version: string): string {
    if (!version || !/^[a-zA-Z0-9._-]+$/.test(version)) {
      throw new BadRequestException(
        `Invalid version string: ${version}. Only alphanumeric, dots, dashes, and underscores allowed.`,
      );
    }
    return version;
  }

  // Build versioned path for platform bundle on CP. Validates version and platform against path traversal. 
  private cpBundlePath(version: string, platform: 'linux' | 'windows'): string {
    if (platform !== 'linux' && platform !== 'windows') {
      throw new BadRequestException(`Invalid platform: ${platform}. Must be 'linux' or 'windows'.`);
    }
    const safeVersion = this.sanitizeVersion(version);
    const resolved = path.resolve(CP_UPGRADE_BASE, safeVersion, 'worker', platform);

    // Ensure the resolved absolute path stays within CP_UPGRADE_BASE
    if (!resolved.startsWith(path.resolve(CP_UPGRADE_BASE))) {
      throw new BadRequestException(`Invalid version path: ${version}`);
    }

    return resolved;
  }

  // Check bundle info for a version and platform.
  private async checkBundleInfo(version: string, platform: 'linux' | 'windows'): Promise<{
    available: boolean;
    filename?: string;
    size?: number;
  }> {
    const basePath = this.cpBundlePath(version, platform);

    try {
      await fs.access(basePath);
    } catch {
      return { available: false };
    }

    const files = await fs.readdir(basePath);
    const bundleFile = files.find((f) =>
      f.startsWith(`datamigrator-worker-${platform}-`) && (f.endsWith('.tar.gz') || f.endsWith('.zip')),
    );

    if (!bundleFile) {
      return { available: false };
    }

    const stat = await fs.stat(path.join(basePath, bundleFile));
    return { available: true, filename: bundleFile, size: stat.size };
  }
  
  // Validate that upgrade bundles exist on CP for the given version.
  private async validateBundlesExist(version: string): Promise<{
    linux: { available: boolean; filename?: string; size?: number };
    windows: { available: boolean; filename?: string; size?: number };
  }> {
    const [linux, windows] = await Promise.all([
      this.checkBundleInfo(version, 'linux'),
      this.checkBundleInfo(version, 'windows'),
    ]);

    if (!linux.available && !windows.available) {
      throw new BadRequestException(
        `No upgrade bundles found for version ${version}. Expected files in ${this.cpBundlePath(version, 'linux')} or ${this.cpBundlePath(version, 'windows')}`,
      );
    }

    this.logger.log(
      `Precheck passed for version ${version}: linux=${linux.available}, windows=${windows.available}`,
    );

    return { linux, windows };
  }

  // Actual controller functions
  // Initiates binary multicast to ALL active workers.
  async startMulticast(
    dto: MulticastRequestDto,
  ): Promise<MulticastResponseDto> {
    const traceId = uuid();
    const workflowId = `BinaryMulticast-${traceId}`;
    let workerIds: string[] = [];
    try {
      // 1. Precheck: ensure bundles exist for this version before starting workflow
      await this.validateBundlesExist(dto.version);

      // 2. Fetch only healthy workers (Online + health ping within threshold)
      const cutoff = new Date(Date.now() - WORKER_HEALTH_TIMEOUT_SECONDS * 1000);
      const activeWorkers = await this.workerRepository
        .createQueryBuilder('worker')
        .innerJoinAndSelect('worker.stats', 'stats')
        .where('worker.status = :status', { status: 'Online' })
        .andWhere('stats.updated_at > :cutoff', { cutoff })
        .getMany();

      if (activeWorkers.length === 0) {
        return {
          workflowId,
          status: 'error',
          message: 'No healthy workers found. Workers must be Online and reporting health checks.',
        };
      }

      this.logger.log(`Health check: ${activeWorkers.length} healthy worker(s) found`);

      workerIds = activeWorkers.map((w) => w.workerId);

      this.logger.log(
        `Starting multicast workflow: ${workflowId} for ${workerIds.length} active workers, version ${dto.version}`,
      );

      // 3. Set upgrade_bundle_staged to IN_PROGRESS for all active workers
      await this.workerRepository.update(
        { workerId: In(workerIds) },
        { upgradeBundleStaged: UpgradeBundleStatus.IN_PROGRESS , stagedVersion: dto.version },
      );
      this.logger.log(`Set upgrade_bundle_staged=IN_PROGRESS for ${workerIds.length} workers`);

      // 4. Start the BinaryMulticastWorkflow
      const handle = await this.workflowService.startWorkflow(
        WorkFlows.BINARY_MULTICAST,
        {
          taskQueue: PARENT_TASK_QUEUE,
          workflowId,
          args: [
            {
              traceId,
              workerIds,
              version: dto.version,
            },
          ],
        },
      );

      this.logger.log(
        `Multicast workflow started: ${handle.workflowId}, runId: ${handle.firstExecutionRunId}`,
      );

      return {
        workflowId: handle.workflowId,
        status: 'started',
        message: `Multicast workflow started for ${workerIds.length} active workers`,
      };
    } catch (error) {
      this.logger.error(`Failed to start multicast workflow: ${error}`);

      // Re-throw BadRequestException (precheck failure) directly
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Reset workers to IDLE in DB if workflow failed to start after DB was updated
      if (workerIds?.length) {
        try {
          await this.workerRepository.update(
            { workerId: In(workerIds) },
            { upgradeBundleStaged: UpgradeBundleStatus.IDLE, stagedVersion: null },
          );
          this.logger.log(`Reset upgrade_bundle_staged=IDLE for ${workerIds.length} workers after workflow start failure`);
        } catch (resetError) {
          this.logger.error(`Failed to reset worker status after workflow start failure: ${resetError}`);
        }
      }

      return {
        workflowId,
        status: 'error',
        message: error.message,
      };
    }
  }

  // Acknowledge successful binary download from a worker.
  async acknowledgeWorkerDownload(
    dto: WorkerAckDto,
  ): Promise<{ acknowledged: boolean }> {
    this.logger.log(
      `Worker ${dto.workerId} ack: ${dto.status} for version ${dto.version}`,
    );

    if (dto.status === 'success') {
      await this.workerRepository.update(dto.workerId, {
        upgradeBundleStaged: UpgradeBundleStatus.COMPLETED,
      });
      this.logger.log(`Set upgrade_bundle_staged=COMPLETED for worker ${dto.workerId}`);
    } else{
      await this.workerRepository.update(dto.workerId, {
        upgradeBundleStaged: UpgradeBundleStatus.FAILED,
        stagedVersion: null,
      });
      this.logger.log(`Worker ${dto.workerId} reported failure: ${dto.message}`);
    }

    return { acknowledged: true };
  }

  /**
   * Get multicast workflow status combined with per-worker distribution status.
   * Queries Temporal for workflow state + DB for per-worker bundle status + health.
   */
  async getWorkflowStatus(workflowId: string): Promise<MulticastStatusDto> {
    this.logger.log(`Getting status for workflow: ${workflowId}`);

    // 1. Get workflow status from Temporal
    const workflowData = await this.workflowService.getWorkflowStatus(workflowId);

    // 2. Get all workers with stats for health check
    const workers = await this.workerRepository.find({
      relations: ['stats'],
    });

    // 3. Build per-worker status
    const healthTimeout = WORKER_HEALTH_TIMEOUT_SECONDS;
    const now = new Date();

    const workerStatuses = workers.map((w) => {
      const lastSeen = w.stats?.updatedAt ? new Date(w.stats.updatedAt) : null;
      const healthy = lastSeen
        ? Math.floor(Math.abs(now.getTime() - lastSeen.getTime()) / 1000) < healthTimeout
        : false;

      return {
        workerId: w.workerId,
        workerName: w.workerName,
        ipAddress: w.ipAddress, 
        platform: w.platform,
        currentVersion: w.workerVersion,
        stagedVersion: w.stagedVersion,
        bundleStatus: w.upgradeBundleStaged,
        healthy,
        lastSeen: lastSeen?.toISOString(),
      };
    });

    // 4. Calculate summary
    const summary = {
      total: workerStatuses.length,
      completed: workerStatuses.filter((w) => w.bundleStatus === UpgradeBundleStatus.COMPLETED).length,
      inProgress: workerStatuses.filter((w) => w.bundleStatus === UpgradeBundleStatus.IN_PROGRESS).length,
      failed: workerStatuses.filter((w) => w.bundleStatus === UpgradeBundleStatus.FAILED).length,
      idle: workerStatuses.filter((w) => w.bundleStatus === UpgradeBundleStatus.IDLE).length,
    };

    // 5. Get workflow result if completed
    const workflowResult = workflowData.status === 'COMPLETED' ? workflowData.completed : undefined;

    return {
      workflowId,
      workflowStatus: workflowData.status,
      summary,
      workers: workerStatuses,
      workflowResult,
    };
  }

  // =========================================================================
  // Upgrade Execution
  // =========================================================================

  /** Trigger upgrade execution on all workers where bundles are staged. */
  async startExecution(
    dto: ExecuteUpgradeRequestDto,
  ): Promise<ExecuteUpgradeResponseDto> {
    const traceId = uuid();
    const workflowId = `UpgradeExecution-${traceId}`;
    let workerIds: string[] = [];

    try {
      const stagedWorkers = await this.workerRepository.find({
        where: {
          upgradeBundleStaged: UpgradeBundleStatus.COMPLETED,
          stagedVersion: dto.version,
        },
      });

      if (stagedWorkers.length === 0) {
        return {
          workflowId,
          status: 'error',
          message: `No workers have completed binary staging for version ${dto.version}`,
        };
      }

      workerIds = stagedWorkers.map((w) => w.workerId);

      this.logger.log(
        `Starting execution workflow: ${workflowId} for ${workerIds.length} staged workers, version ${dto.version}`,
      );

      await this.workerRepository.update(
        { workerId: In(workerIds) },
        { upgradeExecutionStatus: UpgradeExecutionStatus.IN_PROGRESS },
      );

      await this.workflowService.startWorkflow(
        WorkFlows.UPGRADE_EXECUTION,
        {
          taskQueue: PARENT_TASK_QUEUE,
          workflowId,
          args: [{ traceId, workerIds, version: dto.version }],
        },
      );

      this.logger.log(`Execution workflow started: ${workflowId}`);

      return {
        workflowId,
        status: 'started',
        message: `Upgrade execution triggered for ${workerIds.length} workers`,
        triggeredWorkers: workerIds,
      };
    } catch (error) {
      this.logger.error(`Failed to start execution workflow: ${error}`);

      if (workerIds?.length) {
        try {
          await this.workerRepository.update(
            { workerId: In(workerIds) },
            { upgradeExecutionStatus: UpgradeExecutionStatus.IDLE },
          );
        } catch (resetError) {
          this.logger.error(`Failed to reset execution status: ${resetError}`);
        }
      }

      if (error instanceof BadRequestException) throw error;

      return { workflowId, status: 'error', message: error.message };
    }
  }

  /** Get upgrade execution status. After 5-minute window, marks remaining as timed out. */
  async getExecutionStatus(workflowId: string): Promise<ExecutionStatusDto> {
    const EXECUTION_WINDOW_MS = 5 * 60 * 1000;

    const workflowData = await this.workflowService.getWorkflowStatus(workflowId);

    const allWorkers = await this.workerRepository.find();

    // Workers involved in execution (IN_PROGRESS, COMPLETED, FAILED)
    const executionWorkers = allWorkers.filter(
      (w) => w.upgradeExecutionStatus !== UpgradeExecutionStatus.IDLE,
    );

    const earliestUpdate = executionWorkers
      .map((w) => w.updatedAt ? new Date(w.updatedAt).getTime() : Date.now())
      .reduce((min, t) => Math.min(min, t), Date.now());
    const elapsed = Date.now() - earliestUpdate;
    const windowElapsed = elapsed >= EXECUTION_WINDOW_MS;

    if (windowElapsed) {
      const stillInProgress = executionWorkers.filter(
        (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IN_PROGRESS,
      );
      if (stillInProgress.length > 0) {
        await this.workerRepository.update(
          { workerId: In(stillInProgress.map((w) => w.workerId)) },
          { upgradeExecutionStatus: UpgradeExecutionStatus.FAILED },
        );
        stillInProgress.forEach((w) => {
          w.upgradeExecutionStatus = UpgradeExecutionStatus.FAILED;
        });
        this.logger.log(
          `Timed out ${stillInProgress.length} workers after 5-minute window`,
        );
      }
    }

    const toDto = (w: WorkerEntity): WorkerExecutionStatusDto => ({
      workerId: w.workerId,
      workerName: w.workerName,
      ipAddress: w.ipAddress,
      platform: w.platform,
      currentVersion: w.workerVersion,
      executionStatus: w.upgradeExecutionStatus,
      upgradeCompletedAt: w.upgradeCompletedAt?.toISOString(),
    });

    const completed = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.COMPLETED,
    );
    const notCompleted = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IN_PROGRESS
        || w.upgradeExecutionStatus === UpgradeExecutionStatus.FAILED,
    );
    const notStaged = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IDLE,
    );
    const failedCount = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.FAILED,
    ).length;
    const inProgressCount = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IN_PROGRESS,
    ).length;
    const notStartedCount = allWorkers.filter(
      (w) => w.upgradeExecutionStatus === UpgradeExecutionStatus.IDLE,
    ).length;

    const allDone = inProgressCount === 0 && executionWorkers.length > 0;
    const upgradeCompleted = allDone || windowElapsed;

    let upgradeStatus: 'success' | 'failure' | 'in_progress';
    if (!upgradeCompleted) {
      upgradeStatus = 'in_progress';
    } else if (failedCount === 0 && notStartedCount === 0 && completed.length === allWorkers.length) {
      upgradeStatus = 'success';
    } else {
      upgradeStatus = 'failure';
    }

    return {
      workflowId,
      workflowStatus: workflowData.status,
      upgradeCompleted,
      upgradeStatus,
      summary: {
        total: allWorkers.length,
        completed: completed.length,
        inProgress: inProgressCount,
        failed: failedCount,
        notStarted: notStartedCount,
      },
      completed: completed.map(toDto),
      notCompleted: notCompleted.map(toDto),
      notStaged: notStaged.map(toDto),
    };
  }

  /** Worker ACK after upgrade execution. Only marks COMPLETED if ACK version matches staged version. */
  async acknowledgeExecution(
    dto: ExecutionAckDto,
  ): Promise<{ acknowledged: boolean; message?: string }> {
    this.logger.log(
      `Worker ${dto.workerId} execution ack: upgraded to ${dto.version}`,
    );

    const worker = await this.workerRepository.findOne({ where: { workerId: dto.workerId } });

    if (!worker) {
      this.logger.warn(`Worker ${dto.workerId} not found in DB`);
      return { acknowledged: false, message: 'Worker not found' };
    }

    if (worker.stagedVersion && worker.stagedVersion !== dto.version) {
      this.logger.warn(
        `Worker ${dto.workerId} ACK version mismatch: ack=${dto.version}, staged=${worker.stagedVersion}`,
      );
      await this.workerRepository.update(dto.workerId, {
        upgradeExecutionStatus: UpgradeExecutionStatus.FAILED,
      });
      this.logger.log(`Worker ${dto.workerId}: execution=FAILED (version mismatch)`);
      return {
        acknowledged: false,
        message: `Version mismatch: worker sent ${dto.version} but staged version is ${worker.stagedVersion}`,
      };
    }

    await this.workerRepository.update(dto.workerId, {
      upgradeExecutionStatus: UpgradeExecutionStatus.COMPLETED,
      upgradeBundleStaged: UpgradeBundleStatus.IDLE,
      stagedVersion: null,
      workerVersion: dto.version,
      upgradeCompletedAt: new Date(),
    });

    this.logger.log(`Worker ${dto.workerId}: execution=COMPLETED, bundle_staged=IDLE, version=${dto.version}`);
    return { acknowledged: true };
  }

  // Stream the upgrade bundle for a specific version and platform.
  async streamBundle(
    version: string,
    platform: 'linux' | 'windows',
  ): Promise<StreamableFile> {
    const basePath = this.cpBundlePath(version, platform);

    this.logger.log(`Serving bundle: version=${version}, platform=${platform}, path=${basePath}`);

    try {
      await fs.access(basePath);
    } catch {
      throw new NotFoundException(`Bundle directory not found: ${basePath}`);
    }

    const files = await fs.readdir(basePath);
    let bundleFile: string | undefined;
    let contentType: string | undefined;

    if (platform === 'linux') {
      const tarGzName = `datamigrator-worker-linux-${version}.tar.gz`;
      if (files.includes(tarGzName)) {
        bundleFile = tarGzName;
        contentType = 'application/gzip';
      }
    } else if (platform === 'windows') {
      const zipName = `datamigrator-worker-windows-${version}.zip`;
      if (files.includes(zipName)) {
        bundleFile = zipName;
        contentType = 'application/zip';
      }
    }

    if (!bundleFile) {
      throw new NotFoundException(`Bundle not found in ${basePath}`);
    }

    const bundlePath = path.join(basePath, bundleFile);
    const stat = await fs.stat(bundlePath);

    this.logger.log(`Streaming: ${bundlePath} (${stat.size} bytes)`);

    return new StreamableFile(createReadStream(bundlePath), {
      type: contentType,
      disposition: `attachment; filename="${bundleFile}"`,
      length: stat.size,
    });
  }
}
