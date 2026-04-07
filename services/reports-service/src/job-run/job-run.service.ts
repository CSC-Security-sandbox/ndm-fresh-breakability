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
import { parse as parseCsv } from "csv-parse/sync";
import * as firstline from "firstline";
import * as readLastLines from "read-last-lines";
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
      select: { isReportReady: true, jobStats: true, endTime: true },
    });

    if (!getLatestReportStatus) {
      throw new NotFoundException(`Job run not found for id ${id}`);
    }

    // job_stats is snapshotted from Redis when the job reaches terminal status.
    // It is the most accurate source; prefer it over the materialized view.
    const jobStatsSnapshot = getLatestReportStatus.jobStats;
    const hasValidSnapshot =
      !!jobStatsSnapshot &&
      (
        (jobStatsSnapshot.fileCount != null && jobStatsSnapshot.fileCount !== '0') ||
        (jobStatsSnapshot.directories != null && jobStatsSnapshot.directories !== '0') ||
        (jobStatsSnapshot.totalSize != null && jobStatsSnapshot.totalSize !== '0')
      );

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
      // Cached report may have been built when the MV had zeros.
      // If we now have a valid job_stats snapshot, override the stats section.
      if (hasValidSnapshot) {
        const statsFromSnapshot = {
          fileCount: jobStatsSnapshot.fileCount,
          directories: jobStatsSnapshot.directories,
          totalSize: formatBytes(Number(jobStatsSnapshot.totalSize || '0')).toString(),
        };
        if (parsedReport.migrate) parsedReport.migrate = statsFromSnapshot;
        if (parsedReport.discovery) parsedReport.discovery = statsFromSnapshot;
        if (parsedReport.cutOver) parsedReport.cutOver = statsFromSnapshot;
        // Stats came from job_stats snapshot captured at job completion — use endTime as the accurate timestamp.
        // Only override if endTime is non-null; if missing, keep the MV lastRefreshed already set above.
        if (getLatestReportStatus.endTime != null) {
          parsedReport.lastRefreshed = getLatestReportStatus.endTime;
        }
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
    const { options, worker, jobConfig, ...jobRunRest } = jobRun;
    let response: JobRunDetailsResponseDto = {
      ...jobRunRest,
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
      `Job Stats Summary for Job Run ID ${id}: snapshot=${JSON.stringify(jobStatsSnapshot)} mv=${JSON.stringify(jobStatsSummary)}`
    );

    if (hasValidSnapshot) {
      // Prefer the job_stats snapshot — it is written atomically when the job
      // reaches a terminal state and is always more reliable than the MV.
      jobRunStatus.fileCount = jobStatsSnapshot.fileCount;
      jobRunStatus.directories = jobStatsSnapshot.directories;
      jobRunStatus.totalSize = formatBytes(Number(jobStatsSnapshot.totalSize || '0')).toString();
    } else if (jobStatsSummary) {
      jobRunStatus.fileCount = jobStatsSummary.fileCount?.toString();
      jobRunStatus.directories = jobStatsSummary.directoryCount?.toString();
      jobRunStatus.totalSize = formatBytes(
        Number(jobStatsSummary.totalSize)
      ).toString();
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

    if (jobStatsSummary) {
      // When stats come from the job_stats snapshot, use endTime (when snapshot was captured)
      // rather than the MV refresh timestamp which is unrelated to the snapshot.
      // Fall back to MV lastRefreshed if endTime is not yet set (older jobs / edge cases).
      response["lastRefreshed"] = (hasValidSnapshot && getLatestReportStatus.endTime != null)
        ? getLatestReportStatus.endTime
        : jobStatsSummary.lastRefreshed;
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
        relations: ["jobConfig", "jobConfig.sourcePath"],
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

      // Short-circuit: ZIP already on disk means generation previously completed
      const zipExists = await this.fileExists(zipFilePath);
      if (zipExists) {
        this.logger.log(`projectId: ${projectId} ZIP already present at: ${zipFilePath}, skipping generation`);
        if (jobRun.jobConfig.jobType !== JobType.CutOver) {
          await this.jobRunRepo.update({ id: jobRunId }, { isReportReady: true });
        }
        return zipFilePath;
      }

      // CSV must be generated (fresh or resumed from last valid entry)
      const csvExists = await this.fileExists(filePath);
      const jobType = jobRun.jobConfig.jobType;
      const batchSize = parseInt(process.env.CSV_BATCH_SIZE) || 50000;
      try {
        if (!csvExists) {
          this.logger.log(`projectId: ${projectId} CSV not present, generating from scratch: ${filePath}`);
          await this.csvService.generateCsv(filePath, jobRunId, batchSize, jobType);
        } else {
          const volumePath = jobRun.jobConfig.sourcePath?.volumePath ?? '';
          this.logger.log(`projectId: ${projectId} CSV exists, resuming from last valid entry: ${filePath}`);
          const resumeCursor = await this.getResumeCursor(filePath, volumePath, projectId);
          await this.csvService.generateCsv(filePath, jobRunId, batchSize, jobType, resumeCursor);
        }
      } catch (csvError) {
        this.logger.error(`projectId: ${projectId} Failed to generate CSV at: ${filePath}`, csvError?.stack || csvError);
        throw csvError;
      }

      // Create ZIP from the CSV
      this.logger.log(`projectId: ${projectId} Creating ZIP at: ${zipFilePath}`);
      try {
        await this.createZipFile([filePath], zipFilePath);
        this.logger.log(`projectId: ${projectId} COC ZIP created at: ${zipFilePath}`);
      } catch (zipError) {
        this.logger.error(`projectId: ${projectId} Failed to create ZIP at: ${zipFilePath}`, zipError?.stack || zipError);
        throw zipError;
      }

      // CSV is no longer needed — ZIP is the canonical artifact
      try {
        await fs.promises.unlink(filePath);
        this.logger.log(`projectId: ${projectId} CSV deleted after ZIP creation: ${filePath}`);
      } catch (unlinkError) {
        this.logger.warn(`projectId: ${projectId} Could not delete CSV at: ${filePath}`, unlinkError?.message);
      }

      if (jobRun.jobConfig.jobType !== JobType.CutOver) {
        this.logger.log("Updating report status for job other than cutover");
        await this.jobRunRepo.update({ id: jobRunId }, { isReportReady: true });
      }

      try {
        await fs.promises.access(zipFilePath);
      } catch {
        throw new Error(`ZIP file not found after creation: ${zipFilePath}`);
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await fs.promises.readFile(zipFilePath);
      } catch (readError) {
        this.logger.error(`projectId: ${projectId} Failed to read ZIP at: ${zipFilePath}`, readError?.stack || readError);
        throw readError;
      }
      const reportData = {
        filePath: zipFilePath,
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
      return zipFilePath;
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

  private async getResumeCursor(filePath: string, volumePath: string, projectId?: string): Promise<string | null> {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size === 0) return null;
      // Get first line and then find the index of 'Source Path' column in the header
      const headerLine = await firstline(filePath);
      const headers: string[] = parseCsv(headerLine)[0] ?? [];
      const sourcePathIndex = headers.indexOf('Source Path');
      if (sourcePathIndex === -1) {
        this.logger.warn(`projectId: ${projectId} "Source Path" column not found in CSV header, cannot resume`);
        return null;
      }
      // Get last line and then parse the line to get the 'Source Path' value
      let lastLine = await readLastLines.read(filePath, 1);

      if (!lastLine.endsWith('\n')) {
        // Partial write from a crash — truncate and fall back to the previous complete line
        const truncateAt = Math.max(0, stat.size - Buffer.byteLength(lastLine, 'utf8'));
        await fs.promises.truncate(filePath, truncateAt);
        this.logger.log(`projectId: ${projectId} Removed truncated last line, CSV truncated to ${truncateAt} bytes`);
        lastLine = await readLastLines.read(filePath, 1);
      }
      lastLine = lastLine.trimEnd();

      if (!lastLine || lastLine === headerLine) {
        this.logger.warn(`projectId: ${projectId} CSV contains only header row, will regenerate from scratch`);
        return null;
      }

      const sourcePath = (parseCsv(lastLine)[0] ?? [])[sourcePathIndex];
      if (!sourcePath) return null;

      // Parse the Source Path to get the i.path value which is the cursor
      const cursor = volumePath && sourcePath.startsWith(volumePath)
        ? sourcePath.slice(volumePath.length)
        : sourcePath;

      this.logger.log(`projectId: ${projectId} CSV resume cursor: ${cursor}`);
      return cursor;
    } catch (err) {
      this.logger.error(`projectId: ${projectId} Failed to determine resume cursor: ${err.message}`);
      return null;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
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