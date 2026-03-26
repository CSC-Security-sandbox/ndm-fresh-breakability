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
import * as archiver from "archiver";
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
        fileServerName: true,
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
          sourceDirectoryPath: true, 
          destinationPath: volumeSearch,
          destinationDirectoryPath: true,
        },
        options: {
          preserveAccessTime: true,
          preservePermissions: true,
          excludeOlderThan: true,
          excludeFilePatterns: true,
          skipFile: true,
          identityMappingId: true,
          shouldScanADS: true,
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
          directoryPath: jobRun?.jobConfig?.sourceDirectoryPath,
          serverName:
            jobRun?.jobConfig?.sourcePath?.fileServer?.fileServerName,
          configName: jobRun?.jobConfig?.sourcePath?.fileServer?.config?.configName,
        },
        destinationServer: {
          protocol: jobRun?.jobConfig?.destinationPath?.fileServer?.protocol,
          path: jobRun?.jobConfig?.destinationPath?.volumePath,
          directoryPath: jobRun?.jobConfig?.destinationDirectoryPath,
          serverName:
            jobRun?.jobConfig?.destinationPath?.fileServer?.fileServerName,
            configName: jobRun?.jobConfig?.destinationPath?.fileServer?.config?.configName,
        },
      },
      jobOptions: jobRun.options && {
        preserveAccessTime: jobRun.options.preserveAccessTime,
        preservePermissions: jobRun.options.preservePermissions,
        excludeOlderThan: jobRun.options.excludeOlderThan,
        excludeFilePatterns: jobRun.options.excludeFilePatterns,
        skipFile: jobRun.options.skipFile,
        identityMappingId: jobRun.options.identityMappingId,
        shouldScanADS: jobRun.options.shouldScanADS,
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

      const sanitizedZipFileName = sanitizedFileName.replace('.csv', '.zip');
      const zipFilePath = path.join(this.getReportsDirectory, sanitizedZipFileName);
      if (!zipFilePath.startsWith(this.getReportsDirectory)) {
        throw new NotAcceptableException(`Invalid file path: ${zipFilePath}`);
      }

      let csvExists = false;
      try {
        await fs.promises.access(filePath);
        csvExists = true;
      } catch {
        this.logger.log(`projectId: ${projectId} CSV not yet present at: ${filePath}, will generate`);
      }

      if (csvExists) {
        let zipExists = false;
        try {
          await fs.promises.access(zipFilePath);
          zipExists = true;
        } catch {
          this.logger.log(`projectId: ${projectId} ZIP not yet present at: ${zipFilePath}, creating backfill ZIP`);
        }

        if (!zipExists) {
          try {
            await this.createZipFile([filePath], zipFilePath);
            this.logger.log(`projectId: ${projectId} COC ZIP (backfill) created at: ${zipFilePath}`);
          } catch (zipError) {
            this.logger.error(`projectId: ${projectId} Failed to create backfill ZIP at: ${zipFilePath}`, zipError?.stack || zipError);
            throw zipError;
          }
        }
        return filePath;
      }

      const jobType = jobRun.jobConfig.jobType;
      try {
        await this.csvService.generateCsv(filePath, jobRunId, 500000, jobType);
      } catch (csvError) {
        this.logger.error(`projectId: ${projectId} Failed to generate CSV at: ${filePath}`, csvError?.stack || csvError);
        throw csvError;
      }

      try {
        await this.createZipFile([filePath], zipFilePath);
        this.logger.log(`projectId: ${projectId} COC ZIP created at: ${zipFilePath}`);
      } catch (zipError) {
        this.logger.error(`projectId: ${projectId} Failed to create ZIP at: ${zipFilePath}`, zipError?.stack || zipError);
        throw zipError;
      }

      if (jobRun.jobConfig.jobType !== JobType.CutOver) {
        this.logger.log("Updating report status for job other than cutover");
        await this.jobRunRepo.update({ id: jobRunId }, { isReportReady: true });
      }

      try {
        await fs.promises.access(filePath);
      } catch {
        throw new Error(`File not found after generation: ${filePath}`);
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await fs.promises.readFile(filePath);
      } catch (readError) {
        this.logger.error(`projectId: ${projectId} Failed to read file at: ${filePath}`, readError?.stack || readError);
        throw readError;
      }
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

  private createZipFile(filePaths: string[], outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Resolve and validate all paths at the point of use so CodeQL (and any
      // runtime check) can see that tainted input never reaches fs calls raw.
      const baseDir = path.resolve(this.getReportsDirectory);
      const resolvedOutput = path.resolve(outputPath);
      if (!resolvedOutput.startsWith(baseDir + path.sep)) {
        return reject(new Error(`Output path escapes the reports directory: ${outputPath}`));
      }

      const resolvedSources: string[] = [];
      for (const filePath of filePaths) {
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(baseDir + path.sep)) {
          return reject(new Error(`Source path escapes the reports directory: ${filePath}`));
        }
        resolvedSources.push(resolved);
      }

      const output = fs.createWriteStream(resolvedOutput);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", () => resolve());
      output.on("error", (err) => reject(err));
      archive.on("error", (err) => reject(err));

      archive.pipe(output);
      for (const resolved of resolvedSources) {
        archive.file(resolved, { name: path.basename(resolved) });
      }
      archive.finalize().catch(reject);
    });
  }
}