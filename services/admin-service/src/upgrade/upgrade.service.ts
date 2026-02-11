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
 * Path for common env file
 */
const CP_ENV_PATH = '/upgrade/worker/env';

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
      // Start the BinaryMulticastWorkflow
      // Workers will resolve CP URL and platform from their own config at runtime
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
   * Serves common env file for workers
   * Workers call this endpoint to download their env configuration
   */
  async streamEnvFile(): Promise<StreamableFile> {
    this.logger.log(`Serving env file from: ${CP_ENV_PATH}`);

    // Check if directory exists
    if (!fs.existsSync(CP_ENV_PATH)) {
      this.logger.error(`Env directory not found: ${CP_ENV_PATH}`);
      throw new NotFoundException(`Env directory not found`);
    }

    // Find the env file in the directory (look for .env file or env file)
    const files = fs.readdirSync(CP_ENV_PATH);
    const envFile = files.find((f) => 
      f === '.env' || f === 'env' || f.endsWith('.env')
    );

    if (!envFile) {
      this.logger.error(`Env file not found in: ${CP_ENV_PATH}`);
      throw new NotFoundException(`Env file not found`);
    }

    const envPath = path.join(CP_ENV_PATH, envFile);
    const stat = fs.statSync(envPath);

    this.logger.log(
      `Streaming env file: ${envPath}, size: ${stat.size} bytes`,
    );

    const stream = fs.createReadStream(envPath);

    return new StreamableFile(stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${envFile}"`,
      length: stat.size,
    });
  }

  /**
   * Gets information about available binaries and env file
   */
  async getBinaryInfo(): Promise<{
    linux: { available: boolean; filename?: string; size?: number };
    windows: { available: boolean; filename?: string; size?: number };
    env: { available: boolean; filename?: string; size?: number };
  }> {
    const result = {
      linux: this.checkBinaryInfo('linux'),
      windows: this.checkBinaryInfo('windows'),
      env: this.checkEnvInfo(),
    };

    return result;
  }

  /**
   * Check env file info
   */
  private checkEnvInfo(): {
    available: boolean;
    filename?: string;
    size?: number;
  } {
    if (!fs.existsSync(CP_ENV_PATH)) {
      return { available: false };
    }

    const files = fs.readdirSync(CP_ENV_PATH);
    const envFile = files.find((f) => 
      f === '.env' || f === 'env' || f.endsWith('.env')
    );

    if (!envFile) {
      return { available: false };
    }

    const envPath = path.join(CP_ENV_PATH, envFile);
    const stat = fs.statSync(envPath);

    return {
      available: true,
      filename: envFile,
      size: stat.size,
    };
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
}
