import { CsvService, COC_BUNDLE_ENTRIES } from "./../csv/csv_export.service";
import {
  Injectable,
  Logger,
  NotFoundException,
  NotAcceptableException,
  InternalServerErrorException,
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
import * as os from "os";
import { JobStatsSummaryMvEntity } from "src/entities/job-stats-summary-mv.entity";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

/** Job run states where persisted job_stats snapshot should drive UI counts (incl. cutover review states). */
const TERMINAL_JOB_RUN_STATUSES: JobRunStatus[] = [
  JobRunStatus.Completed,
  JobRunStatus.Failed,
  JobRunStatus.Stopped,
  JobRunStatus.Blocked,
  JobRunStatus.Approved,
  JobRunStatus.Rejected,
];

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
        (jobStatsSnapshot.totalSize != null && jobStatsSnapshot.totalSize !== '0') ||
        (jobStatsSnapshot.newlyCopiedCount != null && jobStatsSnapshot.newlyCopiedCount !== '0') ||
        (jobStatsSnapshot.modifiedCount != null && jobStatsSnapshot.modifiedCount !== '0') ||
        (jobStatsSnapshot.skippedCount != null && jobStatsSnapshot.skippedCount !== '0') ||
        (jobStatsSnapshot.deletedCount != null && jobStatsSnapshot.deletedCount !== '0')
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
          newlyCopiedCount: jobStatsSnapshot.newlyCopiedCount,
          modifiedCount: jobStatsSnapshot.modifiedCount,
          skippedCount: jobStatsSnapshot.skippedCount,
          deletedCount: jobStatsSnapshot.deletedCount,
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
      // Cached report may have been built when the MV had zeros.
      // If we now have a valid job_stats snapshot, override the stats section.
      if (hasValidSnapshot) {
        const statsFromSnapshot = {
          fileCount: jobStatsSnapshot.fileCount,
          directories: jobStatsSnapshot.directories,
          totalSize: formatBytes(Number(jobStatsSnapshot.totalSize || '0')).toString(),
          newlyCopiedCount: jobStatsSnapshot.newlyCopiedCount,
          modifiedCount: jobStatsSnapshot.modifiedCount,
          skippedCount: jobStatsSnapshot.skippedCount,
          deletedCount: jobStatsSnapshot.deletedCount,
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
    
    // For completed jobs, use persisted jobStats from jobRun (accurate at completion time)
    // For running jobs, fall back to materialized view
    const isTerminal = TERMINAL_JOB_RUN_STATUSES.includes(jobRun.status as JobRunStatus);
    
    if (isTerminal && jobRun.jobStats) {
      this.logger.log(`Job Run ${id} using persisted jobStats: ${JSON.stringify(jobRun.jobStats)}`);
      jobRunStatus.fileCount = jobRun.jobStats.fileCount?.toString() ?? jobStatsSummary?.fileCount?.toString() ?? "0";
      jobRunStatus.directories = jobRun.jobStats.directories?.toString() ?? jobStatsSummary?.directoryCount?.toString() ?? "0";
      jobRunStatus.totalSize = formatBytes(Number(jobRun.jobStats.totalSize ?? jobStatsSummary?.totalSize ?? 0)).toString();
      jobRunStatus.deletedCount = (jobRun.jobStats as any).deletedCount ?? jobStatsSummary?.deletedCount?.toString() ?? "0";
      jobRunStatus.excludedCount = (jobRun.jobStats as any).excludedCount ?? jobStatsSummary?.excludedCount?.toString() ?? "0";
      jobRunStatus.skippedCount = (jobRun.jobStats as any).skippedCount ?? jobStatsSummary?.skippedCount?.toString() ?? "0";
      jobRunStatus.newlyCopiedCount = (jobRun.jobStats as any).newlyCopiedCount ?? jobStatsSummary?.newlyCopiedCount?.toString() ?? "0";
      jobRunStatus.modifiedCount = (jobRun.jobStats as any).modifiedCount ?? jobStatsSummary?.recopiedCount?.toString() ?? "0";
    } else if (jobStatsSummary) {
      this.logger.log(`Job Run ${id} using MV stats: ${JSON.stringify(jobStatsSummary)}`);
      jobRunStatus.fileCount = jobStatsSummary.fileCount?.toString() ?? "0";
      jobRunStatus.directories = jobStatsSummary.directoryCount?.toString() ?? "0";
      jobRunStatus.totalSize = formatBytes(Number(jobStatsSummary.totalSize)).toString();
      jobRunStatus.deletedCount = jobStatsSummary.deletedCount?.toString() ?? "0";
      jobRunStatus.excludedCount = jobStatsSummary.excludedCount?.toString() ?? "0";
      jobRunStatus.skippedCount = jobStatsSummary.skippedCount?.toString() ?? "0";
      jobRunStatus.newlyCopiedCount = jobStatsSummary.newlyCopiedCount?.toString() ?? "0";
      jobRunStatus.modifiedCount = jobStatsSummary.recopiedCount?.toString() ?? "0";
    } else {
      jobRunStatus.fileCount = "0";
      jobRunStatus.directories = "0";
      jobRunStatus.totalSize = "0";
      jobRunStatus.deletedCount = "0";
      jobRunStatus.excludedCount = "0";
      jobRunStatus.skippedCount = "0";
      jobRunStatus.newlyCopiedCount = "0";
      jobRunStatus.modifiedCount = "0";
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

  /**
   * Picks a directory where we can actually create files (mkdir + write + unlink test).
   * Falls back from REPORT_DOWNLOAD_LOCATION → ./reports (cwd) → os.tmpdir()/ndm-reports
   * to avoid EACCES on cloud-synced or read-only paths (e.g. OneDrive).
   */
  private async ensureWritableReportsBaseDir(): Promise<string> {
    const configured = process.env.REPORT_DOWNLOAD_LOCATION?.trim();
    const candidates: string[] = [];
    if (configured) {
      candidates.push(path.resolve(configured));
    }
    candidates.push(path.resolve(process.cwd(), "reports"));
    candidates.push(path.join(os.tmpdir(), "ndm-reports"));

    for (const dir of candidates) {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        const testFile = path.join(dir, `.ndm-write-test-${process.pid}-${Date.now()}`);
        await fs.promises.writeFile(testFile, "ok", { flag: "w" });
        await fs.promises.unlink(testFile);
        this.logger.log(`Using writable reports directory: ${dir}`);
        return dir;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Reports directory not usable (${msg}), trying next: ${dir}`);
      }
    }
    throw new InternalServerErrorException(
      "No writable directory for reports. Set REPORT_DOWNLOAD_LOCATION to a local folder (e.g. /tmp/ndm-reports) with write permission."
    );
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
      const sanitizedBaseName = `${jobRunId}-coc-report`.replace(
        /[^a-zA-Z0-9-_.]/g,
        ""
      );
      if (!sanitizedBaseName) {
        throw new NotAcceptableException(`Invalid jobRunId for COC report path: ${jobRunId}`);
      }
      const reportsBaseDir = await this.ensureWritableReportsBaseDir();
      const resolvedReportsBase = path.resolve(reportsBaseDir);
      const zipFilePath = path.resolve(resolvedReportsBase, `${sanitizedBaseName}.zip`);
      const relativeZipPath = path.relative(resolvedReportsBase, zipFilePath);
      if (relativeZipPath.startsWith("..") || path.isAbsolute(relativeZipPath) || relativeZipPath === "") {
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

      const bundleDir = path.resolve(resolvedReportsBase, sanitizedBaseName);
      const relativeBundleDir = path.relative(resolvedReportsBase, bundleDir);
      if (
        relativeBundleDir.startsWith("..") ||
        path.isAbsolute(relativeBundleDir) ||
        relativeBundleDir === ""
      ) {
        throw new NotAcceptableException(`Invalid bundle directory path: ${bundleDir}`);
      }
      await fs.promises.mkdir(bundleDir, { recursive: true });

      const bundleCsvPaths = COC_BUNDLE_ENTRIES.map((entry) =>
        path.join(bundleDir, entry.fileName),
      );

      const jobType = jobRun.jobConfig.jobType;
      const batchSize = parseInt(process.env.CSV_BATCH_SIZE || "", 10) || 50000;
      const volumePath = jobRun.jobConfig.sourcePath?.volumePath ?? "";

      const resumeCursorForFile = async (filePath: string): Promise<string | null> =>
        (await this.fileExists(filePath))
          ? await this.getResumeCursor(filePath, volumePath, projectId)
          : null;

      try {
        for (let i = 0; i < COC_BUNDLE_ENTRIES.length; i++) {
          const entry = COC_BUNDLE_ENTRIES[i];
          const filePath = bundleCsvPaths[i];
          const resume = await resumeCursorForFile(filePath);
          this.logger.log(
            `projectId: ${projectId} ${resume ? 'Resuming' : 'Generating'} ${entry.fileName} for jobRunId: ${jobRunId}${resume ? `, cursor: ${resume}` : ''}`
          );
          if (entry.kind === "inventory") {
            await this.csvService.generateCsv(filePath, jobRunId, batchSize, jobType, resume);
          } else {
            await this.csvService.generateListCsv(filePath, jobRunId, entry.listType, batchSize, resume);
          }
        }
      } catch (csvError) {
        this.logger.error(
          `projectId: ${projectId} Failed to generate COC CSV bundle at: ${bundleDir}`,
          csvError?.stack || csvError
        );
        throw csvError;
      }

      // Create ZIP from the four CSV files under the bundle folder
      this.logger.log(`projectId: ${projectId} Creating ZIP at: ${zipFilePath}`);
      try {
        await this.createZipFile(bundleCsvPaths, zipFilePath);
        this.logger.log(`projectId: ${projectId} COC ZIP created at: ${zipFilePath}`);
      } catch (zipError) {
        this.logger.error(`projectId: ${projectId} Failed to create ZIP at: ${zipFilePath}`, zipError?.stack || zipError);
        throw zipError;
      }

      // Bundle directory is no longer needed — ZIP is the canonical artifact
      const relativeBundle = path.relative(resolvedReportsBase, bundleDir);
      if (
        !relativeBundle.startsWith("..") &&
        !path.isAbsolute(relativeBundle) &&
        relativeBundle !== ""
      ) {
        try {
          await fs.promises.rm(bundleDir, { recursive: true, force: true });
          this.logger.log(`projectId: ${projectId} Bundle directory removed after ZIP creation: ${bundleDir}`);
        } catch (rmError: unknown) {
          const msg = rmError instanceof Error ? rmError.message : String(rmError);
          this.logger.warn(`projectId: ${projectId} Could not remove bundle directory at: ${bundleDir}`, msg);
        }
      } else {
        this.logger.warn(
          `projectId: ${projectId} Skipping bundle cleanup — path outside reports base: ${bundleDir}`
        );
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
      const cursor =
        volumePath && sourcePath.startsWith(volumePath)
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
      const resolvedOutput = path.resolve(outputPath);
      const baseDir = path.dirname(resolvedOutput);
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
        archive.file(resolved, { name: path.relative(baseDir, resolved) });
      }
      archive.finalize().catch(reject);
    });
  }
}