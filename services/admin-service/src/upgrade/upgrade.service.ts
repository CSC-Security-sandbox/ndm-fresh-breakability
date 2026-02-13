import { Injectable, Inject, NotFoundException, BadRequestException, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkflowService, WorkFlows } from '../workflow/workflow.service';
import {
  MulticastRequestDto,
  MulticastResponseDto,
  MulticastStatusDto,
  WorkerAckDto,
} from './dto/multicast.dto';
import { WorkerEntity, UpgradeBundleStatus } from '../entities/worker.entity';

/**
 * Base path for upgrade bundles on CP.
 * Structure: /upgrade/{version}/worker/{linux|windows|env}/
 */
const CP_UPGRADE_BASE = '/upgrade';

/**
 * Task queue for parent workflows
 */
const PARENT_TASK_QUEUE = 'ParentWorkflow-TaskQueue';

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

  // =============================================================================
  // Path helpers (versioned)
  // =============================================================================

  /** Build versioned path for platform bundle on CP */
  private cpBundlePath(version: string, platform: 'linux' | 'windows'): string {
    return path.join(CP_UPGRADE_BASE, version, 'worker', platform);
  }

  // =============================================================================
  // Precheck + Multicast
  // =============================================================================

  /**
   * Validate that upgrade bundles exist on CP for the given version.
   * Checks that at least one platform bundle (tar.gz or zip) exists.
   * Each bundle contains binary + env + checksums.
   * Throws BadRequestException if validation fails.
   */
  validateBundlesExist(version: string): {
    linux: { available: boolean; filename?: string; size?: number };
    windows: { available: boolean; filename?: string; size?: number };
  } {
    const linux = this.checkBundleInfo(version, 'linux');
    const windows = this.checkBundleInfo(version, 'windows');

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

  /**
   * Initiates binary multicast to ALL active workers.
   * 1. Precheck: validate version directory and bundles exist on CP
   * 2. Fetches all Online workers from DB
   * 3. Sets upgrade_bundle_staged = IN_PROGRESS for all of them
   * 4. Starts Temporal multicast workflow
   */
  async startMulticast(
    dto: MulticastRequestDto,
  ): Promise<MulticastResponseDto> {
    const traceId = uuid();
    const workflowId = `BinaryMulticast-${traceId}`;

    try {
      // 1. Precheck: ensure bundles exist for this version before starting workflow
      this.validateBundlesExist(dto.version);

      // 2. Fetch all active (Online) workers
      const activeWorkers = await this.workerRepository.find({
        where: { status: 'Online' },
      });

      if (activeWorkers.length === 0) {
        return {
          workflowId,
          status: 'error',
          message: 'No active workers found',
        };
      }

      const workerIds = activeWorkers.map((w) => w.workerId);

      this.logger.log(
        `Starting multicast workflow: ${workflowId} for ${workerIds.length} active workers, version ${dto.version}`,
      );

      // 3. Set upgrade_bundle_staged to IN_PROGRESS for all active workers
      await this.workerRepository.update(
        workerIds.map((id) => id),
        { upgradeBundleStaged: UpgradeBundleStatus.IN_PROGRESS },
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
      return {
        workflowId,
        status: 'error',
        message: error.message,
      };
    }
  }

  /**
   * Acknowledge successful binary download from a worker.
   * Sets upgrade_bundle_staged = true for the worker.
   */
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
    } else {
      this.logger.log(`Worker ${dto.workerId} reported failure: ${dto.message}`);
      // Keep as IN_PROGRESS on failure (admin can see it didn't complete)
    }

    return { acknowledged: true };
  }

  /**
   * Get upgrade distribution status for all workers
   */
  async getDistributionStatus(): Promise<{
    total: number;
    completed: number;
    inProgress: number;
    idle: number;
    workers: { workerId: string; platform: string; bundleStatus: UpgradeBundleStatus }[];
  }> {
    const workers = await this.workerRepository.find();
    const completed = workers.filter((w) => w.upgradeBundleStaged === UpgradeBundleStatus.COMPLETED).length;
    const inProgress = workers.filter((w) => w.upgradeBundleStaged === UpgradeBundleStatus.IN_PROGRESS).length;

    return {
      total: workers.length,
      completed,
      inProgress,
      idle: workers.length - completed - inProgress,
      workers: workers.map((w) => ({
        workerId: w.workerId,
        platform: w.platform || 'unknown',
        bundleStatus: w.upgradeBundleStaged,
      })),
    };
  }

  /**
   * Gets status of a multicast workflow
   */
  async getMulticastStatus(workflowId: string): Promise<MulticastStatusDto> {
    this.logger.log(`Getting status for workflow: ${workflowId}`);

    const result = await this.workflowService.getWorkflowStatus(workflowId);

    // Map Temporal status to our status
    let status: 'running' | 'completed' | 'partial' | 'failed';
    switch (result.status) {
      case 'RUNNING':
        status = 'running';
        break;
      case 'COMPLETED':
        // Check if all workers succeeded
        if (result.completed?.status === 'completed') {
          status = 'completed';
        } else if (result.completed?.status === 'partial') {
          status = 'partial';
        } else {
          status = 'failed';
        }
        break;
      case 'FAILED':
      case 'TERMINATED':
      case 'TIMED_OUT':
        status = 'failed';
        break;
      default:
        status = 'running';
    }

    const summary = result.completed?.summary || {
      total: result.pending?.length || 0,
      success: 0,
      failed: 0,
      pending: result.pending?.length || 0,
    };

    return {
      workflowId,
      status,
      summary: {
        total: summary.total,
        success: summary.success,
        failed: summary.failed,
        pending: summary.pending || (summary.total - summary.success - summary.failed),
      },
      results: result.completed?.results,
    };
  }

  /**
   * Terminates a running multicast workflow
   */
  async terminateMulticast(workflowId: string): Promise<boolean> {
    this.logger.log(`Terminating workflow: ${workflowId}`);
    return this.workflowService.terminateWorkflow(workflowId);
  }

  // =============================================================================
  // Streaming (versioned)
  // =============================================================================

  /**
   * Serves the upgrade bundle for a specific version and platform.
   * Linux:   /upgrade/{version}/worker/linux/datamigrator-*-linux.tar.gz
   * Windows: /upgrade/{version}/worker/windows/datamigrator-*-windows.zip
   */
  async streamBundle(
    version: string,
    platform: 'linux' | 'windows',
  ): Promise<StreamableFile> {
    const basePath = this.cpBundlePath(version, platform);

    this.logger.log(`Serving bundle: version=${version}, platform=${platform}, path=${basePath}`);

    if (!fs.existsSync(basePath)) {
      throw new NotFoundException(`Bundle directory not found: ${basePath}`);
    }

    const files = fs.readdirSync(basePath);
    // Linux: *.tar.gz, Windows: *.zip
    const bundleFile = files.find((f) =>
      f.startsWith('datamigrator-') && (f.endsWith('.tar.gz') || f.endsWith('.zip')),
    );

    if (!bundleFile) {
      throw new NotFoundException(`Bundle not found in ${basePath}`);
    }

    const bundlePath = path.join(basePath, bundleFile);
    const stat = fs.statSync(bundlePath);
    const contentType = bundleFile.endsWith('.zip') ? 'application/zip' : 'application/gzip';

    this.logger.log(`Streaming: ${bundlePath} (${stat.size} bytes)`);

    return new StreamableFile(fs.createReadStream(bundlePath), {
      type: contentType,
      disposition: `attachment; filename="${bundleFile}"`,
      length: stat.size,
    });
  }

  // =============================================================================
  // Bundle Info (versioned)
  // =============================================================================

  /**
   * Gets information about available bundles for a version.
   */
  async getBundleInfo(version: string): Promise<{
    version: string;
    linux: { available: boolean; filename?: string; size?: number };
    windows: { available: boolean; filename?: string; size?: number };
  }> {
    return {
      version,
      linux: this.checkBundleInfo(version, 'linux'),
      windows: this.checkBundleInfo(version, 'windows'),
    };
  }

  /**
   * Check bundle info for a version and platform.
   * Linux: looks for *.tar.gz, Windows: looks for *.zip
   */
  private checkBundleInfo(version: string, platform: 'linux' | 'windows'): {
    available: boolean;
    filename?: string;
    size?: number;
  } {
    const basePath = this.cpBundlePath(version, platform);

    if (!fs.existsSync(basePath)) {
      return { available: false };
    }

    const files = fs.readdirSync(basePath);
    const bundleFile = files.find((f) =>
      f.startsWith('datamigrator-') && (f.endsWith('.tar.gz') || f.endsWith('.zip')),
    );

    if (!bundleFile) {
      return { available: false };
    }

    const stat = fs.statSync(path.join(basePath, bundleFile));
    return { available: true, filename: bundleFile, size: stat.size };
  }
}
