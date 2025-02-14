import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WorkerConfiguration } from 'src/constants/types';
import { WorkerEntity } from 'src/entities/worker.entity';
import { Repository } from 'typeorm';
import { WorkerStatus, WorkFlows, WorkFlowType } from 'src/constants/enums';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { WorkflowService } from 'src/workflow/workflow.service';
import { StartWorkFlowPayload } from 'src/workflow/workflow.types';
import { ConfigService } from '@nestjs/config';
import { JobRunEntity, JobRunStatus } from 'src/entities/jobrun.entity';

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
    private readonly configService: ConfigService,
  ) {
    this.logger = this.loggerFactory.create(WorkManagerService.name);
  }

  async getConfiguration(
    id: string,
    ip: string,
    projectId: string,
  ): Promise<WorkerConfiguration[]> {
    try {
      const status = JobRunStatus.Completed;
      const workerMetaConfig = await this.workerEntity.findOne({
        where: { workerId: id },
      });
      if (workerMetaConfig) {
        const jobRunConfig = await this.jobRunRepo
          .createQueryBuilder('jobrun')
          .leftJoin(
            'worker_jobrun_mapping',
            'mapping',
            'mapping.jobRunId = jobrun.id',
          )
          .where('mapping.workerId = :id', { id })
          .andWhere('jobrun.status <> :status', { status })
          .select(['jobrun.metaConfig AS jobRunMetaConfig'])
          .getRawMany();
        const mergedConfigs = [
          ...workerMetaConfig.metaConfig,
          ...jobRunConfig.map((data) => data.jobrunmetaconfig),
        ];
        return mergedConfigs;
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
      });

      const result = await this.workerEntity.save(newWorker);
      await this.workerEntity.update(
        { workerId: result.workerId },
        { workerName: `Worker-${result.workerNumber}` },
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
  }

  async getChildWorkFlowRes(id: string) {
    return this.workFlowService.getWorkFlowRes(id);
  }
  async updateWorkerConfigurations(jobRunId: string, workerIds: string[]) {
    if (jobRunId) {
      try {
        const workerConfiguration = workerIds.map((worker) => ({
          configName: WorkFlowType.JOB_SPECIFIC_WORKFLOW,
          dynamicTaskQueue: true,
          taskQueueId: `${jobRunId}`,
          workerId: worker,
        }));

        await this.jobRunRepo.update(
          { id: jobRunId },
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
