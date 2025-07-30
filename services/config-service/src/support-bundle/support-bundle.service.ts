import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as path from 'path';
import { SupportBundleStatus, WorkFlows } from 'src/constants/enums';
import { BundleStatus, UserDetails } from 'src/constants/types';
import { ProjectEntity } from 'src/entities/project.entity';
import { SupportBundleEntity } from 'src/entities/support-bundle-log.entity';
import { Options } from 'src/work-manager/dto/validate-connection.dto';
import { WorkflowService } from 'src/workflow/workflow.service';
import { StartWorkFlowPayload } from 'src/workflow/workflow.types';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { CreateSupportBundleDTO } from './dto/create-support-bundle.dto';
import { SupportBundleWorkflowPayloadDTO } from './dto/support-bundle-workflow.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class SupportBundleService {
  private logger: LoggerService;
  private bundleOutputPath: string;
  constructor(
    @InjectRepository(SupportBundleEntity)
    private readonly supportBundleRepo: Repository<SupportBundleEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,

    private loggerFactory: LoggerFactory,
    private readonly workFlowService: WorkflowService,
    private readonly configService: ConfigService,
  ) {
    this.logger = this.loggerFactory.create(SupportBundleService.name);
    this.bundleOutputPath = this.configService.get<string>(
      'app.bundle.bundleOutputPath',
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

    await this.supportBundleRepo.save(log);

    this.logger.log(
      `Starting SupportBundleWorkflow with requestId: ${traceId} and userId: ${userDetails.user.id}`,
    );

    try {
      const payload: SupportBundleWorkflowPayloadDTO = {
        startDate: dto.startDate,
        endDate: dto.endDate,
        projectWorkerMap: dto.projectWorkerMap ?? [],
        userId: userDetails.user.id,
        options: new Options(),
        otherMetrics: dto.otherMetrics ?? [],
      };
      const startWorkFlowPayload: StartWorkFlowPayload = {
        workflowId,
        taskQueue: 'Support-TaskQueue',
        args: [
          {
            traceId: traceId,
            payload: { traceId, ...payload },
            options: payload.options,
          },
        ],
        ...payload.options,
      };

      await this.workFlowService.startWorkflow(
        WorkFlows.SUPPORT_BUNDLE_WORKFLOW,
        startWorkFlowPayload,
      );

      this.logger.log('Started SupportBundleWorkflow successfully');
    } catch (error) {
      this.logger.error(
        `Error while starting SupportBundleWorkflow - ${error.message}`,
      );
    }

    return { traceId };
  }

  async updateSupportBundleStatus(updateStatusDto: UpdateStatusDto) {
    const result = await this.supportBundleRepo.update(
      { requestId: updateStatusDto.traceId },
      {
        status: updateStatusDto.status,
        errorMessage: updateStatusDto.errorMessage,
      },
    );

    if (result.affected === 0) {
      throw new Error(
        `Support bundle not found for traceId: ${updateStatusDto.traceId}`,
      );
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

  async canUserDownloadBundle(userId: string): Promise<BundleStatus> {
    const user = await this.supportBundleRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
      select: ['status', 'errorMessage'],
    });

    if (!user) {
      return {
        isProcessing: false,
        isBundleReady: false,
        error: '',
      };
    }

    switch (user.status) {
      case SupportBundleStatus.COMPLETED:
        return { isProcessing: false, isBundleReady: true, error: null };

      case SupportBundleStatus.IN_PROGRESS:
        return { isProcessing: true, isBundleReady: false, error: null };

      case SupportBundleStatus.FAILED:
        return {
          isProcessing: false,
          isBundleReady: false,
          error: user.errorMessage,
        };

      default:
        return {
          isProcessing: false,
          isBundleReady: false,
          error: null,
        };
    }
  }

  downloadSupportBundle(fileName: string): string {
    const fullPath = path.join(this.bundleOutputPath, fileName);

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Support bundle file not found.');
    }

    return fullPath;
  }
}
