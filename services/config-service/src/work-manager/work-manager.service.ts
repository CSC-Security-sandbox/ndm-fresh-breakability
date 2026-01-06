import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { Repository, IsNull, Not, In } from 'typeorm';
import { WorkerConfiguration } from 'src/constants/types';
import {
  ConfigStatus,
  Platform,
  WorkerStatus,
  WorkFlows,
  WorkFlowType,
} from 'src/constants/enums';
import { WorkerEntity } from 'src/entities/worker.entity';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';
import { ConfigEntity } from 'src/entities/config.entity';

import { WorkflowService } from 'src/workflow/workflow.service';
import { StartWorkFlowPayload } from 'src/workflow/workflow.types';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { ConfigStatusPayloadDTO } from './dto/validate-export-path.dto';
import { SendMailService } from 'src/util/send-email';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { generateWorkerName } from 'src/util/utils';
import { SuccessEmailType } from 'src/util/send-email.type';

@Injectable()
export class WorkManagerService {
  readonly logger: LoggerService;
  constructor(
    @InjectRepository(WorkerEntity)
    private readonly workerEntity: Repository<WorkerEntity>,
    private loggerFactory: LoggerFactory,
    private readonly workFlowService: WorkflowService,
    @InjectRepository(JobRunEntity)
    private readonly jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(ConfigEntity)
    private readonly configRepo: Repository<ConfigEntity>,
    @InjectRepository(WorkerJobRunMap)
    private readonly workerJobRunMap: Repository<WorkerJobRunMap>,
    private readonly configService: ConfigService,
    private readonly sendMailService: SendMailService,
  ) {
    this.logger = this.loggerFactory.create(WorkManagerService.name);
  }

  async getConfiguration(
    id: string,
    ip: string,
    projectId: string,
    platform: Platform,
    envVariables: Record<string, any>,
    isRebootCall: boolean,
  ): Promise<WorkerConfiguration[]> {
    try {
      const workerMetaConfig = await this.workerEntity.findOne({
        where: { workerId: id },
      });
      if (workerMetaConfig) {
        const jobRunConfig = await this.jobRunRepo.find({
          where: {
            status: In([
              JobRunStatus.Running,
              JobRunStatus.Ready,
              JobRunStatus.Pausing,
              JobRunStatus.Stopping,
              JobRunStatus.Paused,
            ]),
            workerMap: {
              workerId: id,
              metaConfig: Not(IsNull()),
              isActive: true,
            },
          },
          relations: {
            workerMap: true,
          },
          select: {
            workerMap: {
              metaConfig: {},
              workerId: true,
            },
          },
        });
        jobRunConfig.forEach((data) => {
          if (Array.isArray(data.workerMap)) {
            data.workerMap.forEach((wm) => {
              if (wm.metaConfig) {
                this.logger.debug(
                  `JobRunId: ${data.id}, WorkerId: ${wm.workerId}, MetaConfig: ${JSON.stringify(wm.metaConfig)}`,
                );
                workerMetaConfig.metaConfig.push(wm.metaConfig);
              }
            });
          }
        });
        if (isRebootCall) {
          await this.workerEntity.update(
            { workerId: workerMetaConfig.workerId },
            {
              workerName: generateWorkerName(
                workerMetaConfig.workerNumber,
                platform,
              ),
              platform: platform,
              envVariables: envVariables,
            },
          );
        }
        return workerMetaConfig.metaConfig;
      }
      this.logger.warn(`project ID : ${projectId}`);

      const newWorker = this.workerEntity.create({
        workerId: id,
        ipAddress: ip,
        metaConfig: this.createWorkerConfiguration(id),
        status: WorkerStatus.Online,
        workerName: id,
        createdBy: id,
        projectId,
        platform: platform,
        envVariables: envVariables,
      });
      const result = await this.workerEntity.save(newWorker);

      await this.sendMailService.sendMail({
        successEmailType: SuccessEmailType.WORKER_USAGE,
        projectId,
        workerUsage: { id, ip },
      });
      await this.workerEntity.update(
        { workerId: result.workerId },
        {
          workerName: generateWorkerName(result.workerNumber, platform),
          envVariables: envVariables,
        },
      );

      return result.metaConfig;
    } catch (error) {
      this.logger.error(
        `Error while fetching worker configuration for workerId: ${id}, ${error}`,
      );
      throw new Error('Error while fetching worker configuration');
    }
  }

  createWorkerConfiguration = (workerId: string): WorkerConfiguration[] => [
    {
      configName: WorkFlowType.PARENT_WORKFLOW,
      dynamicTaskQueue: false,
      taskQueueId: null,
      workerId: workerId,
    },
    {
      configName: WorkFlowType.WORKER_SPECIFIC_WORKFLOW,
      dynamicTaskQueue: true,
      taskQueueId: workerId,
      workerId: workerId,
    },
  ];

  async validateConnection(payload: CreateRequestDto, traceId: string) {
    try {
      const startWorkFlowPayload: StartWorkFlowPayload = {
        workflowId: WorkFlows.VALIDATE_CONNECTION + '-' + traceId,
        taskQueue: 'ParentWorkflow-TaskQueue',
        args: [
          {
            traceId: traceId,
            payload: {
              traceId,
              feature: this.configService.get('app.feature'),
              ...payload,
            },
            options: payload.options,
          },
        ],
        ...payload.options,
      };
      const workflow = await this.workFlowService.startWorkflow(
        WorkFlows.VALIDATE_CONNECTION,
        startWorkFlowPayload,
      );
      return { workflowId: workflow.workflowId };
    } catch (error) {
      this.logger.error(`Error in validateConnection: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to start validate connection workflow for traceId: ${traceId}, ${error.message}`,
      );
    }
  }

  async validateWorkingDirectory(data: ConfigStatusPayloadDTO) {
    try {
      this.logger.log(
        `Received validateWorkingDirectory callback: configId=${data.configId}, fileServerId=${data.fileServerId}, status=${data.status}`,
      );

      // Check if this is a Dell per-zone callback (fileServerId present)
      if (data.fileServerId) {
        // Dell: Update file server status first
        this.logger.log(`Dell per-zone callback: Updating file server ${data.fileServerId} status to ${data.status}`);
        
        const config = await this.configRepo.findOne({
          where: { id: data.configId },
          relations: ['fileServers'],
        });
        
        if (config) {
          const fileServer = config.fileServers.find(fs => fs.id === data.fileServerId);
          if (fileServer) {
            fileServer.status = data.status;
            await this.configRepo.save(config);
          }
          
          // Then aggregate to config level
          await this.aggregateDellConfigStatus(config);
        }
      } else {
        // Other NAS: Update config status directly
        const config = await this.configRepo.findOne({
          where: { id: data.configId },
          relations: ['fileServers'],
        });
        
        if (config) {
          config.status = data.status;
          config.errorMessage = data.errorMessage;
          
          // Also sync status to all file servers for consistency
          config.fileServers.forEach(fs => {
            fs.status = data.status;
          });
          
          await this.configRepo.save(config);
        }
      }
    } catch (error) {
      this.logger.error(
        `Error while updating the status of a file server after validating export path and working directory- ${error.message}`,
      );
    }
  }

  /**
   * Aggregate Dell config status from all file server statuses
   * Priority order:
   * 1. DRAFT if any file server is DRAFT (no workers assigned)
   * 2. ERRORED if any file server is ERRORED
   * 3. ACTIVE if all file servers are ACTIVE
   * 4. IN_PROGRESS otherwise
   */
  private async aggregateDellConfigStatus(config: ConfigEntity) {
    try {
      if (!config.fileServers || config.fileServers.length === 0) {
        this.logger.warn(`No file servers found for config ${config.id}`);
        return;
      }
      
      const fileServers = config.fileServers;

      let aggregatedStatus: ConfigStatus;
      let errorMessage: string | null = null;

      const hasDraft = fileServers.some(fs => fs.status === ConfigStatus.DRAFT);
      const hasErrored = fileServers.some(fs => fs.status === ConfigStatus.ERRORED);
      const allActive = fileServers.every(fs => fs.status === ConfigStatus.ACTIVE);

      if (hasDraft) {
        aggregatedStatus = ConfigStatus.DRAFT;
        errorMessage = 'One or more zones have no workers assigned';
      } else if (hasErrored) {
        aggregatedStatus = ConfigStatus.ERRORED;
        errorMessage = 'One or more zones failed validation';
      } else if (allActive) {
        aggregatedStatus = ConfigStatus.ACTIVE;
        errorMessage = null;
      } else {
        aggregatedStatus = ConfigStatus.IN_PROGRESS;
        errorMessage = null;
      }

      this.logger.log(
        `Dell config ${config.id}: Aggregated status = ${aggregatedStatus} (${fileServers.length} file servers, hasDraft=${hasDraft}, hasErrored=${hasErrored}, allActive=${allActive})`,
      );

      // Update config status
      config.status = aggregatedStatus;
      config.errorMessage = errorMessage;
      await this.configRepo.save(config);
    } catch (error) {
      this.logger.error(`Error aggregating Dell config status: ${error.message}`);
    }
  }

  async getChildWorkFlowRes(id: string) {
    try {
      if (!id) {
        throw new BadRequestException('Child Workflow ID is required');
      }

      const response = await this.workFlowService.getWorkFlowRes(id);

      if (!response) {
        throw new NotFoundException(`No workflow response found for ID: ${id}`);
      }

      if (response.status === 'TERMINATED' || response.status === 'FAILED' || response.status === 'TIMED_OUT') {
        const errorMessage = `Pre-check with ID ${id} is ${response.status.toLowerCase()}. Please check the workflow logs for more details.`;
        const payload = await this.workFlowService.getWorkFlowPayload(id);
        return {
          ...response,
          workflow: {
            errors: [errorMessage],
            sourcePathId: payload?.[0]?.payload?.preChecks?.[0]?.pathId ?? null,
            destinationPathIds: payload?.[0]?.payload?.preChecks?.[0]?.destinations?.map(d => d?.pathId) ?? null,
          },
        };
      }
      return response;
    } catch (error) {
      this.logger.error(`Error in getChildWorkFlowRes: ${error.message}`);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to retrieve child workflow response for ID: ${id}`,
      );
    }
  }

  async updateWorkerConfigurations(jobRunId: string, workerId: string) {
    if (jobRunId) {
      try {
        const workerConfiguration = {
          configName: WorkFlowType.JOB_SPECIFIC_WORKFLOW,
          dynamicTaskQueue: true,
          taskQueueId: `${jobRunId}`,
          workerId: workerId,
        };

        await this.workerJobRunMap.update(
          { jobRunId: jobRunId, workerId: workerId },
          { metaConfig: workerConfiguration },
        );
      } catch (error) {
        this.logger.error(
          `Error while updating worker configurations for jobRunId: ${jobRunId}`,
          error.stack,
        );
        throw new Error('Error while updating worker configurations');
      }
    } else {
      this.logger.error('JobRunId is required to update worker configurations');
      throw new Error('JobRunId is required to update worker configurations');
    }
  }
}
