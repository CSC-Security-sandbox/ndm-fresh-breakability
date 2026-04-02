import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { SupportBundleStatus, WorkFlows } from 'src/constants/enums';
import { BundleStatus, UserDetails } from 'src/constants/types';
import { SupportBundleEntity } from 'src/entities/support-bundle-log.entity';
import { Options } from 'src/work-manager/dto/validate-connection.dto';
import { WorkflowService } from 'src/workflow/workflow.service';
import { StartWorkFlowPayload } from 'src/workflow/workflow.types';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { WORKFLOW_TIMEOUTS } from '../constants/constants';
import { CreateSupportBundleDTO } from './dto/create-support-bundle.dto';
import { SupportBundleWorkflowPayloadDTO } from './dto/support-bundle-workflow.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { ProjectEntity } from 'src/entities/project.entity';

@Injectable()
export class SupportBundleService {
  private logger: LoggerService;
  private bundleOutputPath: string;
  private reportsSupportBundleSendUrl: string;
  constructor(
    @InjectRepository(SupportBundleEntity)
    private readonly supportBundleRepo: Repository<SupportBundleEntity>,

    private loggerFactory: LoggerFactory,
    private readonly workFlowService: WorkflowService,
    private readonly configService: ConfigService,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
  ) {
    this.logger = this.loggerFactory.create(SupportBundleService.name);
    this.bundleOutputPath = this.configService.get<string>(
      'app.bundle.bundleOutputPath',
    );
    this.reportsSupportBundleSendUrl = this.configService.get<string>(
      'app.reports.supportBundleSendUrl',
    );
  }

  async create(
    dto: CreateSupportBundleDTO,
    userDetails: UserDetails,
  ): Promise<{ traceId: string }> {
    const traceId = uuidv4();
    const workflowId = WorkFlows.SUPPORT_BUNDLE_WORKFLOW + '-' + traceId;

    const log = this.supportBundleRepo.create({
      requestId: traceId,
      userId: userDetails.user.id,
      status: SupportBundleStatus.IN_PROGRESS,
      createdBy: userDetails.user.id,
      workflowId: workflowId,
      filters: {
        startDate: dto.startDate,
        endDate: dto.endDate,
        projectWorkerMap: dto.projectWorkerMap ?? [],
        otherMetrics: dto.otherMetrics ?? [],
      },
    });

    this.logger.log(
      `Starting SupportBundleWorkflow with requestId: ${traceId} and userId: ${userDetails.user.id}`,
    );

    try {
      const payload: SupportBundleWorkflowPayloadDTO = {
        startDate: dto.startDate,
        endDate: dto.endDate,
        projectWorkerMap: dto.projectWorkerMap ?? [],
        userId: userDetails.user.id,
        otherMetrics: dto.otherMetrics ?? [],
      };
      const startWorkFlowPayload: StartWorkFlowPayload = {
        workflowId,
        taskQueue: 'Support-TaskQueue',
        args: [
          {
            traceId: traceId,
            payload: { traceId, ...payload },
          },
        ],
        workflowExecutionTimeout: WORKFLOW_TIMEOUTS.PARENT_WORKFLOW_EXECUTION_TIMEOUT, // Allow enough time for all child workflows
        workflowRunTimeout: WORKFLOW_TIMEOUTS.PARENT_WORKFLOW_RUN_TIMEOUT,
      };

      await this.workFlowService.startWorkflow(
        WorkFlows.SUPPORT_BUNDLE_WORKFLOW,
        startWorkFlowPayload,
      );
      await this.supportBundleRepo.save(log);
      this.logger.log('Started SupportBundleWorkflow successfully');
    } catch (error) {
      this.logger.error(
        `Error while starting SupportBundleWorkflow - ${error.message}`,
      );
    }

    return { traceId };
  }

  async updateSupportBundleStatus(updateStatusDto: UpdateStatusDto) {
    this.logger.log(`Updating the support bundle status for traceId - ${updateStatusDto.traceId}`);
    const result = await this.supportBundleRepo.update(
      { requestId: updateStatusDto.traceId },
      {
        status: updateStatusDto.status,
        errorMessage: updateStatusDto.errorMessage,
      },
    );

    if (result.affected === 0) {
      throw new NotFoundException(
        `Support bundle not found for traceId: ${updateStatusDto.traceId}`,
      );
    }
  }

  async isBundleReady(userId: string): Promise<BundleStatus> {
    const latestBundle = await this.supportBundleRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
      select: [
        'status',
        'errorMessage',
        'filters',
        'createdAt',
        'workflowId',
        'requestId',
      ],
    });

    const defaultResponse: BundleStatus = {
      isProcessing: false,
      isBundleReady: false,
      filters: latestBundle?.filters || null,
      createdAt: latestBundle?.createdAt || null,
    };

    if (!latestBundle) {
      return defaultResponse;
    }

    if (latestBundle.status === SupportBundleStatus.COMPLETED) {
      return { ...defaultResponse, isBundleReady: true };
    }

    try {
      const response = await this.workFlowService.getWorkFlowRes(
        latestBundle.workflowId,
      );
      if (
        response?.status === 'TERMINATED' ||
        response?.status === 'FAILED' ||
        response?.status === 'TIMED_OUT'
      ) {
        await this.supportBundleRepo.update(
          { requestId: latestBundle.requestId },
          {
            status: SupportBundleStatus.FAILED,
            errorMessage: `Support bundle generation failed, activity ${response?.status}`,
          },
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to check workflow status in isBundleReady:',
        error,
      );
    }

    if (latestBundle.status === SupportBundleStatus.IN_PROGRESS) {
      return { ...defaultResponse, isProcessing: true };
    }

    if (latestBundle.status === SupportBundleStatus.FAILED) {
      throw new InternalServerErrorException(
        latestBundle.errorMessage || 'Support bundle generation failed',
      );
    } else {
      return defaultResponse;
    }
  }

  downloadSupportBundle(fileName: string): string {
    const fullPath = path.join(this.bundleOutputPath, fileName);

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Support bundle file not found.');
    }

    return fullPath;
  }

  async sendSupportBundleToAsup(fileName: string): Promise<void> {
    this.logger.log(`[SendSupportBundleToAsup] Looking up file: ${fileName}`);

    const fullPath = this.downloadSupportBundle(fileName);
    this.logger.log(`[SendSupportBundleToAsup] File found at path: ${fullPath}`);

    const bundleBuffer = await fs.promises.readFile(fullPath);
    const fileSizeMB = (bundleBuffer.length / (1024 * 1024)).toFixed(2);
    this.logger.log(`[SendSupportBundleToAsup] File read successfully - size=${fileSizeMB}MB (${bundleBuffer.length} bytes)`);

    const bundleBase64 = bundleBuffer.toString('base64');
    const base64SizeMB = (Buffer.byteLength(bundleBase64) / (1024 * 1024)).toFixed(2);
    this.logger.log(`[SendSupportBundleToAsup] Base64 encoded size=${base64SizeMB}MB - forwarding to reports-service at: ${this.reportsSupportBundleSendUrl}`);

    try {
      await axios.post(
        this.reportsSupportBundleSendUrl,
        {
          fileName,
          bundleBase64,
        },
        {
          timeout: 0,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );
      this.logger.log(`[SendSupportBundleToAsup] reports-service accepted the bundle successfully`);
    } catch (error) {
      const status = error?.response?.status;
      const responseData = JSON.stringify(error?.response?.data);
      this.logger.error(
        `[SendSupportBundleToAsup] reports-service call failed - status=${status}, url=${this.reportsSupportBundleSendUrl}, response=${responseData}, error=${error?.message}`,
        error?.stack,
      );
      throw error;
    }
  }

  async getProjects(userDetails: UserDetails) {
    const isAppAdmin = userDetails.user.roles.some(
      (role) => role.projects.length === 0,
    );
    if (isAppAdmin) {
      const projects = await this.projectRepo.find({
        select: ['id', 'projectName'],
        relations: ['workers'],
      });

      return projects.map((project) => ({
        label: project.projectName,
        id: project.id,
        ...(project.workers?.length > 0 && {
          childrens: project.workers.map((worker) => ({
            label: `${worker.workerName} (${project.projectName})`,
            id: worker.workerId,
          })),
        }),
      }));
    } else {
      const projectIdsSet = new Set<string>();
      userDetails.user.roles.forEach((role) => {
        role.projects.forEach((id: string) => projectIdsSet.add(id));
      });

      const projectIds = Array.from(projectIdsSet);

      const projects = await this.projectRepo.find({
        where: { id: In(projectIds) },
        select: ['id', 'projectName'],
        relations: ['workers'],
      });

      return projects.map((project) => ({
        label: project.projectName,
        id: project.id,
        ...(project.workers?.length > 0 && {
          childrens: project.workers.map((worker) => ({
            label: `${worker.workerName} (${project.projectName})`,
            id: worker.workerId,
          })),
        }),
      }));
    }
  }
}
