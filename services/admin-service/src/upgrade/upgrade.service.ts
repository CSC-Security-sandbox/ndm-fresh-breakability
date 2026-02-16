import { Injectable, Inject, NotFoundException, BadRequestException, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkFlows } from '../workflow/workflow.types';
import {
  MulticastRequestDto,
  MulticastResponseDto,
  WorkerAckDto,
} from './dto/multicast.dto';
import { WorkerEntity } from '../entities/worker.entity';
import { UpgradeBundleStatus } from '../constants/worker.enums';

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
      f.startsWith(`datamigrator-worker-${platform}-`) && (f.endsWith('.tar.gz') || f.endsWith('.zip')),
    );

    if (!bundleFile) {
      return { available: false };
    }

    const stat = fs.statSync(path.join(basePath, bundleFile));
    return { available: true, filename: bundleFile, size: stat.size };
  }
  
  // Validate that upgrade bundles exist on CP for the given version.
  private validateBundlesExist(version: string): {
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

  // Actual controller functions
  // Initiates binary multicast to ALL active workers.
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
        { workerId: In(workerIds) },
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
    } else {
      this.logger.log(`Worker ${dto.workerId} reported failure: ${dto.message}`);
      // Keep as IN_PROGRESS on failure (admin can see it didn't complete)
    }

    return { acknowledged: true };
  }

  // Stream the upgrade bundle for a specific version and platform.
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
    const stat = fs.statSync(bundlePath);

    this.logger.log(`Streaming: ${bundlePath} (${stat.size} bytes)`);

    return new StreamableFile(fs.createReadStream(bundlePath), {
      type: contentType,
      disposition: `attachment; filename="${bundleFile}"`,
      length: stat.size,
    });
  }
}
