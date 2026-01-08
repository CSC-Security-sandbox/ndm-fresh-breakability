import { CsvService } from "./../csv/csv_export.service"; 
import {
  Injectable,
  Logger,
  NotFoundException,
  NotAcceptableException,
  Optional,
  Inject
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { JobRunStatus, JobType, ReportType } from "src/constants/enums";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { ReportsEntity } from "src/entities/reports.entity";
import { TaskEntity } from "src/entities/task.entity";
import { ProjectIdCacheService } from "../utils/project-id-cache.service";
import { Repository } from "typeorm";
import { JobRunDetailsResponseDto, JobRunStats, TaskDto, } from "./dto/job-rundetails.dto";
import * as fs from "fs";
import * as crypto from "crypto";
import { formatBytes } from "@netapp-cloud-datamigrate/jobs-lib";
import * as path from "path";
import { JobStatsSummaryMvEntity } from "src/entities/job-stats-summary-mv.entity";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class JobRunService {
  private readonly logger: LoggerService | Logger;
  constructor(
    @InjectRepository(JobRunEntity)
    private jobRunRepo: Repository<JobRunEntity>,
    @InjectRepository(InventoryEntity)
    private inventoryRepo: Repository<InventoryEntity>,
    @InjectRepository(TaskEntity)
    private taskRepo: Repository<TaskEntity>,
    @InjectRepository(ReportsEntity)
    private reportsRepo: Repository<ReportsEntity>,
    private csvService: CsvService,
    @InjectRepository(JobStatsSummaryMvEntity)
    private jobStatsSummaryMvRepo: Repository<JobStatsSummaryMvEntity>,
    private readonly projectIdCacheService: ProjectIdCacheService,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(JobRunService.name);
    } else {
      // Fallback to basic NestJS Logger for worker threads
      this.logger = new Logger(JobRunService.name);
    }
  }

  async jobRunReportByJobRunId(jobRunId: string, reportType: string) {
    const report = await this.reportsRepo.findOne({
      where: { jobRunId: jobRunId, reportType: reportType },
      order: { createdAt: "DESC" },
      select: ["reportData"],
    });
    if (!report)
      throw new NotFoundException(
        `${reportType} - report is not generated yet`
      );
    if (report) return report.reportData;
  }

  async getJobStatsId(id: string) {
    const getLatestReportStatus = await this.jobRunRepo.findOne({
      where: { id: id },
      select: ["isReportReady"],
    });

    if (!getLatestReportStatus) {
      throw new NotFoundException(`Job run not found for id ${id}`);
    }

    const saved = await this.reportsRepo.findOne({
      where: { jobRunId: id, reportType: ReportType.JOB_RUN_STATS },
      select: { reportData: true },
    });
    const jobStatsSummary: JobStatsSummaryMvEntity =
      await this.jobStatsSummaryMvRepo.findOne({
        where: { jobRunId: id },
      });

    if (saved) {
      const parsedReport = JSON.parse(saved.reportData);
      if (parsedReport.isReportReady !== getLatestReportStatus?.isReportReady) {
        parsedReport.isReportReady = getLatestReportStatus?.isReportReady;
        saved.reportData = JSON.stringify(parsedReport);
        await this.reportsRepo.update(
          { jobRunId: id, reportType: ReportType.JOB_RUN_STATS },
          { reportData: JSON.stringify(parsedReport) }
        );
      }
      if (jobStatsSummary) {
        parsedReport.lastRefreshed = jobStatsSummary.lastRefreshed;
      }
      return parsedReport;
    }

    const volumeSearch = {
      volumePath: true,
      fileServer: {
        protocol: true,
        config: { configName: true },
      },
    };

    const reportTypes = await this.reportsRepo
      .createQueryBuilder("report")
      .innerJoin("jobrun", "jobrun", "jobrun.id = report.job_run_id")
      .innerJoin(
        "jobconfig",
        "jobconfig",
        "jobconfig.id = jobrun.job_config_id"
      )
      .where("report.job_run_id = :jobRunId", { jobRunId: id })
      .andWhere("jobconfig.job_type = :jobType", { jobType: JobType.CutOver })
      .andWhere("report.report_type IN (:...types)", {
        types: [ReportType.COC, ReportType.JOBS_RREPORT],
      })
      .select("report.report_type", "report_type")
      .groupBy("report.report_type")
      .getRawMany();

    if (reportTypes.length === 2) {
      this.logger.log("Both COC & JOBS_REPORT are completed for cutover job");
      await this.jobRunRepo.update({ id: id }, { isReportReady: true });
    }

    const jobRun: JobRunEntity = await this.jobRunRepo.findOne({
      where: { id },
      select: {
        id: true,
        startTime: true,
        isReportReady: true,
        status: true,
        endTime: true,
        // worker: {workerId: true},
        jobConfig: {
          id: true,
          jobType: true,
          sourcePath: volumeSearch,
          destinationPath: volumeSearch,
        },
        options: {
          preserveAccessTime: true,
          excludeOlderThan: true,
          excludeFilePatterns: true,
          skipFile: true,
          identityMappingId: true,
        },
      },
      relations: {
        worker: true,
        options: true,
        jobConfig: {
          sourcePath: { fileServer: { config: true } },
          destinationPath: { fileServer: { config: true } },
        },
      },
    });

    if (!jobRun)
      throw new NotFoundException(`Job Run does not exist for id: ${id}`);
    let response: JobRunDetailsResponseDto = {
      ...jobRun,
      jobConfig: {
        id: jobRun.jobConfig?.id,
        jobType: jobRun.jobConfig?.jobType,
        sourceServer: {
          protocol: jobRun?.jobConfig?.sourcePath?.fileServer?.protocol,
          path: jobRun?.jobConfig?.sourcePath?.volumePath,
          serverName:
            jobRun?.jobConfig?.sourcePath?.fileServer?.config?.configName,
        },
        destinationServer: {
          protocol: jobRun?.jobConfig?.destinationPath?.fileServer?.protocol,
          path: jobRun?.jobConfig?.destinationPath?.volumePath,
          serverName:
            jobRun?.jobConfig?.destinationPath?.fileServer?.config?.configName,
        },
      },
      jobOptions: jobRun.options && {
        preserveAccessTime: jobRun.options.preserveAccessTime,
        excludeOlderThan: jobRun.options.excludeOlderThan,
        excludeFilePatterns: jobRun.options.excludeFilePatterns,
        skipFile: jobRun.options.skipFile,
        identityMappingId: jobRun.options.identityMappingId,
      },
      worker: jobRun?.worker?.length ?? 0,
    };
    const jobRunStatus = new JobRunStats();
    this.logger.log(
      `Job Stats Summary for Job Run ID ${id}: ${JSON.stringify(jobStatsSummary)}`
    );

    if (jobStatsSummary) {
      jobRunStatus.fileCount = jobStatsSummary.fileCount?.toString();
      jobRunStatus.directories = jobStatsSummary.directoryCount?.toString();
      jobRunStatus.totalSize = formatBytes(
        Number(jobStatsSummary.totalSize)
      ).toString();
      // Assign lastRefreshed to top-level property for DTO compatibility
    } else {
      jobRunStatus.fileCount = "0";
      jobRunStatus.directories = "0";
      jobRunStatus.totalSize = "0";
    }

    if (jobRun?.jobConfig?.jobType === JobType.Discover)
      response["discovery"] = jobRunStatus;
    if (jobRun?.jobConfig?.jobType === JobType.Migrate)
      response["migrate"] = jobRunStatus;
    if (jobRun?.jobConfig?.jobType === JobType.CutOver)
      response["cutOver"] = jobRunStatus;

    response["task"] = new TaskDto();
    if (jobStatsSummary) {
      response["task"]["completed"] = Number(jobStatsSummary.completed);
      response["task"]["pending"] = Number(jobStatsSummary.pending);
      response["task"]["errored"] = Number(jobStatsSummary.errored);
      response["task"]["running"] = Number(jobStatsSummary.running);
      response["lastRefreshed"] = jobStatsSummary.lastRefreshed;
    }
    this.logger.log("Job Run Status: " + jobStatsSummary?.jobRunStatus);
    if (jobStatsSummary?.jobRunStatus === JobRunStatus.Completed) {
      this.logger.log(
        `Job Run with ID ${id} is completed,and reportData is ready ${JSON.stringify(response)}`
      );
      const report = this.reportsRepo.create({
        jobRunId: id,
        reportData: JSON.stringify(response),
        reportType: ReportType.JOB_RUN_STATS,
      });
      await this.reportsRepo.save(report);
    }

    return response;
  }

  get getReportsDirectory(): string {
    return process.env.REPORT_DOWNLOAD_LOCATION || "./reports";
  }

  async getCocReportByJobRunId(jobRunId: string) {
    const projectId = await this.projectIdCacheService.getProjectIdFromCache(jobRunId);
    this.logger.log(`projectId: ${projectId} Generating COC report for jobRunId: ${jobRunId}`);
    
    try {
      const jobRun = await this.jobRunRepo.findOne({
        where: { id: jobRunId },
        relations: ["jobConfig"],
      });
      if (!jobRun)
        throw new NotFoundException(`Job Run with id ${jobRunId} not found`);
      if (jobRun.jobConfig.jobType === JobType.Discover)
        throw new NotFoundException(
          `Job Run with id ${jobRunId} is not a migration job`
        );
      const sanitizedFileName = `${jobRunId}-coc-report.csv`.replace(
        /[^a-zA-Z0-9-_.]/g,
        ""
      );
      const filePath = path.join(this.getReportsDirectory, sanitizedFileName);
      if (!filePath.startsWith(this.getReportsDirectory)) {
        throw new NotAcceptableException(`Invalid file path: ${filePath}`);
      }

      if (fs.existsSync(filePath)) return filePath;
      
      const jobType = jobRun.jobConfig.jobType;
      await this.csvService.generateCsv(filePath, jobRunId, 10000, jobType);

      if (jobRun.jobConfig.jobType !== JobType.CutOver) {
        this.logger.log("Updating report status for job other than cutover");
        await this.jobRunRepo.update({ id: jobRunId }, { isReportReady: true });
      }

      if (!fs.existsSync(filePath))
        throw new Error(`File not found: ${filePath}`);

      const fileBuffer = fs.readFileSync(filePath);
      const reportData = {
        filePath,
        size: fileBuffer.length,
        digest: crypto.createHash("sha256").update(fileBuffer).digest("hex"),
      };
      const report = this.reportsRepo.create({
        jobRunId,
        reportData: JSON.stringify(reportData),
        reportType: ReportType.COC,
      });
      await this.reportsRepo.save(report);
      this.logger.log(`projectId: ${projectId} COC Report generated successfully for jobRunId: ${jobRunId}`);
      return filePath;
    } catch (error) {
      this.logger.error(`projectId: ${projectId} Error while generating COC report for jobRunId: ${jobRunId}: ${error.message}`, error?.stack || error);
      throw error;
    }
  }

  async getJobSubStatus(jobRunId: string) {
    return await this.jobRunRepo.findOne({
      where: { id: jobRunId },
      select: ["subStatus"],
    });
  }
}