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
import { Repository } from "typeorm";
import {
  JobRunDetailsResponseDto,
  JobRunStats,
  TaskDto,
} from "./dto/job-rundetails.dto";
import { InventoryStatusSummary, TaskStatusCount } from "./job-run.type";
import * as fs from "fs";
import * as crypto from "crypto";
import { formatBytes } from "@netapp-cloud-datamigrate/jobs-lib";
import * as path from "path";
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class JobRunService {
  private readonly logger : LoggerService;
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
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(JobRunService.name);
    } else {
      // Fallback to basic NestJS Logger for worker threads
      this.logger = new Logger(JobRunService.name) as any;
    }
  }

  async jobRunReportByJobRunId(jobRunId: string, reportType: string) {
    try {
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
    } catch (error) {
      this.logger.error(
        `Error while fetching report for jobRunId: ${jobRunId} and reportType: ${reportType} - ERROR: ${error}`
      );
      if (error instanceof NotFoundException || error instanceof NotAcceptableException) {
        throw error;
      } else {
        throw new NotFoundException(
          `Failed to fetch report for jobRunId: ${jobRunId} and reportType: ${reportType}`
        );
      }
    }
  }

  async getJobStatsId(id: string) {
    try {
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
        },
        relations: {
          worker: true,
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
        worker: jobRun?.worker?.length ?? 0,
      };

      const inventorySummary: InventoryStatusSummary[] = await this.inventoryRepo
        .createQueryBuilder("i")
        .select("i.is_directory", "isDirectory")
        .addSelect("COUNT(i.is_directory)", "counts")
        .addSelect("SUM(i.file_size)", "totalFileSize")
        .where("i.job_run_id = :jobRunId", { jobRunId: id })
        .groupBy("i.is_directory")
        .getRawMany();

      const jobRunStatus = new JobRunStats();
      for (let i = 0; i < inventorySummary.length; i++) {
        if (inventorySummary[i].isDirectory)
          jobRunStatus.directories = inventorySummary[i].counts?.toString();
        else {
          jobRunStatus.fileCount = inventorySummary[i].counts?.toString();
          jobRunStatus.totalSize = formatBytes(
            Number(inventorySummary[i].totalFileSize)
          ).toString();
        }
      }

      if (jobRun?.jobConfig?.jobType === JobType.Discover)
        response["discovery"] = jobRunStatus;
      if (jobRun?.jobConfig?.jobType === JobType.Migrate)
        response["migrate"] = jobRunStatus;
      if (jobRun?.jobConfig?.jobType === JobType.CutOver)
        response["cutOver"] = jobRunStatus;

      const taskStatusCounts: TaskStatusCount[] = await this.taskRepo
        .createQueryBuilder("t")
        .select("t.status", "status")
        .addSelect("COUNT(1)", "count")
        .where("t.job_run_id = :jobRunId", { jobRunId: id })
        .groupBy("t.status")
        .getRawMany();

      response["task"] = new TaskDto();
      for (let i = 0; i < taskStatusCounts.length; i++)
        response["task"][taskStatusCounts[i].status?.toLowerCase()] = Number(
          taskStatusCounts[i].count
        );

      if (response.status === JobRunStatus.Completed) {
        const report = this.reportsRepo.create({
          jobRunId: id,
          reportData: JSON.stringify(response),
          reportType: ReportType.JOB_RUN_STATS,
        });
        await this.reportsRepo.save(report);
      }
      return response;
    } catch (error) {
      this.logger.error(
        `Error while fetching job run stats for id: ${id} - ERROR: ${error}`
      );
      if (error instanceof NotFoundException || error instanceof NotAcceptableException) {
        throw error;
      } else {
        throw new NotFoundException(
          `Failed to fetch job run stats for id: ${id}`
        );
      }
    }
  }

  get getReportsDirectory(): string {
    return process.env.REPORT_DOWNLOAD_LOCATION || "./reports";
  }

  async getCocReportByJobRunId(jobRunId: string) {
    try {
      this.logger.log(`Generating COC report for jobRunId: ${jobRunId}`);
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
      await this.csvService.generateCsv(filePath, jobRunId);

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
      this.logger.log(`COC Report generated for jobRunId: ${jobRunId}`);
      return filePath;
    } catch (error) {
      this.logger.error(
        `Error while generating COC report for jobRunId: ${jobRunId} - ERROR: ${error}`
      );
      if (error instanceof NotFoundException || error instanceof NotAcceptableException) {
        throw error;
      } else {
        throw new NotFoundException(
          `Failed to generate COC report for jobRunId: ${jobRunId}`
        );
      }
    }
  }

  async getJobSubStatus(jobRunId: string) {
    return await this.jobRunRepo.findOne({
      where: { id: jobRunId },
      select: ["subStatus"],
    });
  }
}
