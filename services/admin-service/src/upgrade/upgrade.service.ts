import { Injectable, Inject, NotFoundException, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkflowService, WorkFlows } from '../workflow/workflow.service';
import {
  MulticastRequestDto,
  MulticastResponseDto,
  MulticastStatusDto,
} from './dto/multicast.dto';

/**
 * Constants for binary paths on CP
 */
const CP_BINARY_PATHS = {
  linux: '/upgrade/worker/linux',
  windows: '/upgrade/worker/windows',
} as const;

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
    @Inject(LoggerFactory) private loggerFactory: LoggerFactory,
  ) {
    this.logger = this.loggerFactory.create(UpgradeService.name);
  }

  /**
   * Initiates binary multicast to specified workers
   * Starts a Temporal workflow that orchestrates distribution
   */
  async startMulticast(
    dto: MulticastRequestDto,
  ): Promise<MulticastResponseDto> {
    const traceId = uuid();
    const workflowId = `BinaryMulticast-${traceId}`;

    this.logger.log(
      `Starting multicast workflow: ${workflowId} for ${dto.workerIds.length} workers, version ${dto.version}`,
    );

    try {
      // Get CP base URL for workers to download from
      const cpBaseUrl = this.getCpBaseUrl();

      // Start the BinaryMulticastWorkflow
      const handle = await this.workflowService.startWorkflow(
        WorkFlows.BINARY_MULTICAST,
        {
          taskQueue: PARENT_TASK_QUEUE,
          workflowId,
          args: [
            {
              traceId,
              workerIds: dto.workerIds,
              version: dto.version,
              cpBaseUrl,
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
        message: `Multicast workflow started for ${dto.workerIds.length} workers`,
      };
    } catch (error) {
      this.logger.error(`Failed to start multicast workflow: ${error}`);
      return {
        workflowId,
        status: 'error',
        message: error.message,
      };
    }
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

  /**
   * Serves binary file for a specific platform
   * Workers call this endpoint to download their binaries
   */
  async streamBinary(
    platform: 'linux' | 'windows',
  ): Promise<StreamableFile> {
    const basePath = CP_BINARY_PATHS[platform];

    this.logger.log(`Serving binary for platform: ${platform}, path: ${basePath}`);

    // Check if directory exists
    if (!fs.existsSync(basePath)) {
      this.logger.error(`Binary directory not found: ${basePath}`);
      throw new NotFoundException(`Binary directory not found for ${platform}`);
    }

    // Find the binary file in the directory
    const files = fs.readdirSync(basePath);
    const binaryFile = files.find((f) => {
      if (platform === 'linux') {
        return f.startsWith('datamigrator-') && !f.endsWith('.exe');
      } else {
        return f.startsWith('datamigrator-') && f.endsWith('.exe');
      }
    });

    if (!binaryFile) {
      this.logger.error(`Binary file not found in: ${basePath}`);
      throw new NotFoundException(`Binary file not found for ${platform}`);
    }

    const binaryPath = path.join(basePath, binaryFile);
    const stat = fs.statSync(binaryPath);

    this.logger.log(
      `Streaming binary: ${binaryPath}, size: ${stat.size} bytes`,
    );

    const stream = fs.createReadStream(binaryPath);

    return new StreamableFile(stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${binaryFile}"`,
      length: stat.size,
    });
  }

  /**
   * Gets information about available binaries
   */
  async getBinaryInfo(): Promise<{
    linux: { available: boolean; filename?: string; size?: number };
    windows: { available: boolean; filename?: string; size?: number };
  }> {
    const result = {
      linux: this.checkBinaryInfo('linux'),
      windows: this.checkBinaryInfo('windows'),
    };

    return result;
  }

  /**
   * Check binary info for a platform
   */
  private checkBinaryInfo(platform: 'linux' | 'windows'): {
    available: boolean;
    filename?: string;
    size?: number;
  } {
    const basePath = CP_BINARY_PATHS[platform];

    if (!fs.existsSync(basePath)) {
      return { available: false };
    }

    const files = fs.readdirSync(basePath);
    const binaryFile = files.find((f) => {
      if (platform === 'linux') {
        return f.startsWith('datamigrator-') && !f.endsWith('.exe');
      } else {
        return f.startsWith('datamigrator-') && f.endsWith('.exe');
      }
    });

    if (!binaryFile) {
      return { available: false };
    }

    const binaryPath = path.join(basePath, binaryFile);
    const stat = fs.statSync(binaryPath);

    return {
      available: true,
      filename: binaryFile,
      size: stat.size,
    };
  }

  /**
   * Gets the CP base URL that workers use to download binaries
   */
  private getCpBaseUrl(): string {
    // Try to get from env or config
    const cpUrl = this.configService.get<string>('CP_BASE_URL');
    if (cpUrl) {
      return cpUrl;
    }

    // Fallback: construct from CP_HOST or default
    const cpHost = this.configService.get<string>('CP_HOST') || 'localhost';
    const cpPort = this.configService.get<string>('CP_PORT') || '3000';
    const useHttps = this.configService.get<boolean>('USE_HTTPS') ?? true;

    return `${useHttps ? 'https' : 'http'}://${cpHost}:${cpPort}`;
  }
}
