import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { UserDetails } from 'src/constants/types';
import { ProjectEntity } from 'src/entities/project.entity';
import archiver from 'archiver';
import { promisify } from 'util';

import { exec as execCb } from 'child_process';

const exec = promisify(execCb);

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
    userDetails: UserDetails,
  ): Promise<{ traceId: string }> {
    const traceId = uuidv4();
    this.logger.log(`userId - ${userDetails.user.id}`);
    this.logger.log(`traceId - ${traceId}`);
    this.logger.log(`dto - ${JSON.stringify(dto)}`);

    // const baseLogDir = '/Users/aniketdarekar/Desktop/poc/ndm_logs';
    // const outputZipDir = '/Users/aniketdarekar/Desktop/poc/generated-zips';

    // await this.generateFilteredLogsZip(baseLogDir, outputZipDir, dto.startDate, dto.endDate, dto.projectWorkerMap, userDetails.user.id);
    // return { traceId };
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
        projectWorkerMap: dto.projectWorkerMap ?? [],
        otherMetrics: dto.otherMetrics ?? [],
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
        projectWorkerMap: dto.projectWorkerMap ?? [],
        userId: userDetails.user.id,
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
      // return this.projectRepo.find({
      //   select: ['id', 'projectName'],
      // });

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

      // return this.projectRepo.find({
      //   select: ['id', 'projectName'],
      //   where: projectIds.map((id) => ({ id })),
      // });
    }
  }

  async canUserDownloadBundle(userId: string): Promise<boolean> {
    this.logger.log(`1 Checking if user ${userId} can download bundle`);
    this.logger.warn(`2 Checking if user ${userId} can download bundle`);
    this.logger.debug(`3 Checking if user ${userId} can download bundle`);
    this.logger.error(`4 Checking if user ${userId} can download bundle`);
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


 
// working code with new logic

  // async generateFilteredLogsZip(
  //   logRoot: string,
  //   outputDir: string,
  //   startDate: string,
  //   endDate: string,
  //   projectWorkerMap: ProjectWorkerMap[],
  //   userId: string,
  // ): Promise<string> {
  //   try {
  //     const zipRoot = 'ndm_logs';
  //     const zipFileName = `ndm_${userId}.zip`;
  //     const zipPath = path.join(outputDir, zipFileName);

  //     // Delete old zip if exists
  //     if (fs.existsSync(zipPath)) {
  //       fs.unlinkSync(zipPath);
  //     }

  //     if (!fs.existsSync(outputDir)) {
  //       fs.mkdirSync(outputDir, { recursive: true });
  //     }

  //     const start = new Date(startDate);
  //     const end = new Date(endDate);
  //     if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
  //       throw new Error(`Invalid date range: ${startDate} to ${endDate}`);
  //     }

  //     const dateFolders: string[] = [];
  //     const current = new Date(startDate);
  //     const endDt = new Date(endDate);

  //     while (current <= endDt) {
  //       const yyyyMmDd = current.toISOString().split('T')[0];
  //       dateFolders.push(yyyyMmDd);
  //       current.setUTCDate(current.getUTCDate() + 1); // safer for consistent UTC handling
  //     }


  //     const pathExpressions: string[] = [];

  //     for (const date of dateFolders) {
  //       const datePath = path.join(logRoot, date);

  //       for (const entry of projectWorkerMap) {
  //         if (entry.projectId) {
  //           const controlPlanePath = path.join(datePath, entry.projectId);
  //           pathExpressions.push(`-path "${controlPlanePath}"`);

  //           // const controlPlaneSubPath = path.join(controlPlanePath, 'Control plane');
  //           // pathExpressions.push(`-path "${controlPlaneSubPath}"`);
  //           // pathExpressions.push(`-path "${path.join(controlPlaneSubPath, 'Admin')}"`);
  //           // pathExpressions.push(`-path "${path.join(controlPlaneSubPath, 'job')}"`);

  //           if (entry.projectId) {
  //             const projectPath = path.join(datePath, entry.projectId);
  //             pathExpressions.push(`-path "${projectPath}"`);
  //           }
  //         }

  //         if (entry.workerIds) {
  //           for (const wid of entry.workerIds) {
  //             const workerPath = path.join(datePath, 'worker', wid);
  //             pathExpressions.push(`-path "${workerPath}"`);
  //           }
  //         }
  //       }
  //     }

  //     if (pathExpressions.length === 0) {
  //       throw new Error('No paths generated from inputs');
  //     }

  //     const findCommand = `find "${logRoot}" -type d \\( ${pathExpressions.join(' -o ')} \\)`;

  //     const { stdout } = await exec(findCommand).catch(err => {
  //       console.error('Error executing find:', err.stderr || err.message);
  //       throw new Error('Failed to execute find command');
  //     });

  //     const matchingDirs = stdout
  //       .trim()
  //       .split('\n')
  //       .map(s => s.trim())
  //       .filter(Boolean);

  //     if (matchingDirs.length === 0) {
  //       throw new Error('No matching directories found in the given date range.');
  //     }

  //     return await new Promise((resolve, reject) => {
  //       const output = fs.createWriteStream(zipPath);
  //       const archive = archiver('zip', { zlib: { level: 9 } });

  //       output.on('close', () => {
  //         console.log(`Zip created at: ${zipPath}`);
  //         resolve(zipPath);
  //       });

  //       archive.on('error', err => {
  //         console.error('Archiving error:', err);
  //         reject(err);
  //       });

  //       archive.pipe(output);

  //       for (const dir of matchingDirs) {
  //         const relative = path.relative(logRoot, dir);
  //         archive.directory(dir, path.join(zipRoot, relative));
  //       }

  //       archive.finalize();
  //     });
  //   } catch (err) {
  //     console.error('Error in fetchAndZipLogsUsingFind:', err.message);
  //     throw err;
  //   }
  // }

}
