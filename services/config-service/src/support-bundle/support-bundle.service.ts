import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateSupportBundleDTO } from './dto/create-support-bundle.dto';
import { SupportBundleStatus, WorkFlows } from 'src/constants/enums';
import { SupportBundleEntity } from 'src/entities/support-bundle-log.entity';
import { StartWorkFlowPayload } from 'src/workflow/workflow.types';
import { SupportBundleWorkflowPayloadDTO } from './dto/support-bundle-workflow.dto';
import { Options } from 'src/work-manager/dto/validate-connection.dto';
import { WorkflowService } from 'src/workflow/workflow.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

import * as fs from 'fs';
import * as path from 'path';
import { UserDetails } from 'src/constants/types';
import { ProjectEntity } from 'src/entities/project.entity';

@Injectable()
export class SupportBundleService {
  private logger: LoggerService;
  private readonly bundleDir = '/private/tmp/ndm-logs';
  constructor(
    @InjectRepository(SupportBundleEntity)
    private readonly supportBundleRepo: Repository<SupportBundleEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,

    private loggerFactory: LoggerFactory,
    private readonly workFlowService: WorkflowService,
  ) {
    this.logger = this.loggerFactory.create(SupportBundleService.name);
  }

  async create(
    dto: CreateSupportBundleDTO,
    traceId: string,
    userDetails: UserDetails,
  ): Promise<{ traceId: string }> {
    console.log(`userId - ${userDetails.user.id}`);
    console.log(`traceId - ${traceId}`);
    console.log(`dto - ${JSON.stringify(dto)}`);

    const workflowId = WorkFlows.SUPPORT_BUNDLE_WORKFLOW + '-' + traceId;

    const log = this.supportBundleRepo.create({
      request_id: traceId,
      user_id: userDetails.user.id,
      status: SupportBundleStatus.IN_PROGRESS,
      created_at: new Date(),
      created_by: userDetails.user.id,
      workflow_id: workflowId,
      filters: {
        startDate: dto.startDate,
        endDate: dto.endDate,
        projectIds: dto.projectIds ?? [],
      },
    });

    await this.supportBundleRepo.save(log);

    this.logger.debug(
      `Starting SupportBundleWorkflow with request_id: ${traceId}  and user_id: ${userDetails.user.id}`,
    );

    try {
      const payload: SupportBundleWorkflowPayloadDTO = {
        startDate: dto.startDate,
        endDate: dto.endDate,
        projectIds: dto.projectIds ?? [],
        options: new Options(),
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
      this.logger.debug('Started SupportBundleWorkflow successfully');
    } catch (error) {
      this.logger.error(
        `Error while starting SupportBundleWorkflow - ${error.message}`,
      );
    }

    return { traceId };
  }

  async getProjects(userDetails: UserDetails) {
    const isAppAdmin = userDetails.user.roles.some(
      (role) => role.projects.length === 0,
    );
    if (isAppAdmin) {
      return this.projectRepo.find({
        select: ['id', 'projectName'],
      });
    } else {
      const projectIdsSet = new Set<string>();
      userDetails.user.roles.forEach((role) => {
        role.projects.forEach((id: string) => projectIdsSet.add(id));
      });

      const projectIds = Array.from(projectIdsSet);

      return this.projectRepo.find({
        select: ['id', 'projectName'],
        where: projectIds.map((id) => ({ id })),
      });
    }
  }

  async canUserDownloadBundle(userId: string): Promise<boolean> {
    const user = await this.supportBundleRepo.findOne({
      where: { user_id: userId },
      select: ['status'],
    });

    return user?.status === SupportBundleStatus.COMPLETED;
  }

  downloadSupportBundle(fileName: string): string {
    const fullPath = path.join(this.bundleDir, fileName);

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Support bundle file not found.');
    }

    return fullPath;
  }
}
