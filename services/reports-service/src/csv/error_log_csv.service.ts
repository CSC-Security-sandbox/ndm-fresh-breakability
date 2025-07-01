import { Injectable, StreamableFile, Logger } from "@nestjs/common";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { Raw, Repository, In } from "typeorm";
import * as fs from "fs";
import * as fastCsv from "fast-csv";
import { InjectRepository } from "@nestjs/typeorm";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import * as path from "path";

@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name);
  constructor(
    @InjectRepository(OperationErrorEntity)
    private operationErrorRepo: Repository<OperationErrorEntity>,
    @InjectRepository(WorkerJobRunMap)
    private workerJobRunMapRepo: Repository<WorkerJobRunMap>
  ) {}

  async getPaginatedErrors({
    jobConfigId,
    jobRunId,
    pageSize,
    offset,
  }: {
    jobConfigId?: string;
    jobRunId?: string;
    pageSize: number;
    offset: number;
  }) {
    if (!jobConfigId && !jobRunId) {
      throw new Error("Either jobConfigId or jobRunId must be provided");
    }

    const params: any[] = [];
    let whereClause = "";

    if (jobConfigId) {
      const jobRunIds = await this.getJobRunIds(jobConfigId);
      if (!jobRunIds.length) return [];
      whereClause = `o.job_run_id IN (${jobRunIds.map((_, i) => `$${i + 1}`).join(",")})`;
      params.push(...jobRunIds);
    } else {
      whereClause = "o.job_run_id = $1";
      params.push(jobRunId);
    }

    params.push(pageSize, offset);

    const query = `
    SELECT
      MIN(oe.id::text)           AS "Id",
      MIN(oe.error_message)      AS "Error Message",
      MIN(oe.error_type)         AS "Error Type",
      MIN(oe.created_at)         AS "Created At",
      MIN(oe.file_name)          AS "File Name",
      MIN(oe.file_path)          AS "File Path",
      MIN(oe.origin)             AS "Origin",
      MIN(oe.operation_type)     AS "Operation Type",
      MIN(oe.error_code)         AS "Error Code",
      COUNT(*)                   AS "Occurrence"
    FROM datamigrator.operation_errors oe
    LEFT JOIN datamigrator.operations o ON o.id = oe.operation_id
    WHERE ${whereClause}
    GROUP BY oe.file_path
    ORDER BY MIN(oe.created_at)
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

    return this.operationErrorRepo.query(query, params);
  }

  async getWorkerSetupErrors(
    jobRunIds: string | string[]
  ): Promise<WorkerJobRunMap[]> {
    return this.workerJobRunMapRepo.find({
      where: {
        jobRunId: Array.isArray(jobRunIds) ? In(jobRunIds) : jobRunIds,
        workerResponse: Raw(
          (alias) =>
            `${alias} IS NOT NULL AND ${alias} ->> 'code' = 'SETUP_WORKER_FAILURE' AND ${alias} ->> 'status' = 'FAILED'`
        ),
      },
    });
  }

  // Utility to sanitize and validate file paths for security
  private sanitizeAndValidateFilePath(filePath: string): string {
    const baseDir = path.resolve(this.getErrorLogsDirectory);
    const resolvedPath = path.resolve(baseDir, filePath);
    // Ensure the resolved path is within the base directory
    if (!resolvedPath.startsWith(baseDir + path.sep)) {
      throw new Error("Invalid file path: Path traversal detected");
    }
    // Optionally, restrict file name pattern (alphanumeric, dash, underscore, .csv)
    const fileName = path.basename(resolvedPath);
    if (!/^[\w\-]+-error-\d+\.csv(\.processing)?$/.test(fileName)) {
      throw new Error("Invalid file name");
    }
    return resolvedPath;
  }

  // Utility to strictly validate identifier for regex/file usage
  private sanitizeIdentifier(identifier: string): string {
    // Only allow alphanumeric, dash, and underscore
    if (!/^[\w-]+$/.test(identifier)) {
      throw new Error(
        "Invalid identifier: Only alphanumeric, dash, and underscore allowed"
      );
    }
    return identifier;
  }

  // Utility to escape regex metacharacters in user input
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async writeLargeCsvToDisk(
    filePath: string,
    jobRunId?: string,
    jobConfigId?: string,
    pageSize: number = 10000
  ): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      const safeFilePath = this.sanitizeAndValidateFilePath(
        path.basename(filePath)
      );
      const writeStream = fs.createWriteStream(safeFilePath);
      const csvStream = fastCsv.format({ headers: true });
      csvStream.pipe(writeStream);
      const processingFilePath = this.sanitizeAndValidateFilePath(
        `${path.basename(filePath)}.processing`
      );
      fs.writeFileSync(processingFilePath, "processing");

      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const ErrorsHashMap = await this.getPaginatedErrors({
          jobConfigId,
          jobRunId,
          pageSize,
          offset,
        });

        const totalJobRunIds = jobConfigId
          ? await this.getJobRunIds(jobConfigId)
          : jobRunId;

        const setupFailedError =
          offset === 0
            ? await this.fetchFormattedSetupErrors(totalJobRunIds)
            : [];

        const chunk =
          offset === 0
            ? [...ErrorsHashMap, ...setupFailedError]
            : ErrorsHashMap;

        for (const row of chunk) {
          csvStream.write(row);
        }

        hasMore = ErrorsHashMap.length === pageSize;
        offset += pageSize;
      }
      csvStream.end();
      writeStream.on("finish", () => resolve());
      writeStream.on("error", reject);
      csvStream.on("error", reject);
      fs.unlinkSync(processingFilePath);
    });
  }

  private async fetchFormattedSetupErrors(
    jobRunId: string
  ): Promise<Record<string, any>[]> {
    const rawErrors = await this.getWorkerSetupErrors(jobRunId);
    return rawErrors.map((err) => ({
      Id: err.id,
      "Error Message": err.workerResponse.message,
      "Error Type": "FATAL_ERROR",
      "Created At": err.workerResponse.createdAt,
      "Operation Type": err.workerResponse.operation,
      "Error Code": err.workerResponse.code,
      Origin: err.workerResponse.origin,
      Occurrence: err.workerResponse.occurrence || 1,
    }));
  }

  get getErrorLogsDirectory(): string {
    return process.env.ERROR_LOGS_DOWNLOAD_LOCATION || "./error-logs";
  }

  async createCsvFileForJob(
    jobRunId?: string,
    jobConfigId?: string
  ): Promise<string> {
    const identifier = jobRunId || jobConfigId;
    if (!identifier) {
      throw new Error("Either jobRunId or jobConfigId must be provided");
    }

    let errorCount: number;
    let fileName: string;
    let filePattern: RegExp;

    if (jobConfigId) {
      errorCount = await this.getTotalErrorCountForConfig(identifier);
    } else {
      errorCount = await this.getTotalErrorCountForJobRun(identifier);
    }
    fileName = `${identifier}-error-${errorCount}.csv`;
    // Sanitize and escape identifier before using in regex
    const safeIdentifier = this.escapeRegex(
      this.sanitizeIdentifier(identifier)
    );
    filePattern = new RegExp(`^${safeIdentifier}-error-\\d+\\.csv$`);

    const dir = this.getErrorLogsDirectory;
    const filePath = this.sanitizeAndValidateFilePath(fileName);

    // If the latest file already exists, return it
    if (fs.existsSync(filePath)) {
      return filePath;
    }

    // Clean up old files matching the pattern (except the one being created)
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (filePattern.test(f) && f !== fileName) {
          try {
            fs.unlinkSync(this.sanitizeAndValidateFilePath(f));
          } catch (err) {
            this.logger.warn(
              `Failed to delete old error log file: ${f}. Reason: ${err instanceof Error ? err.message : err}`
            );
          }
        }
      }
    }

    await this.writeLargeCsvToDisk(filePath, jobRunId, jobConfigId);
    return filePath;
  }

  async downloadErrorLogCsvFile(
    jobRunId?: string,
    jobConfigId?: string
  ): Promise<StreamableFile> {
    const identifier = jobRunId || jobConfigId;
    if (!identifier) {
      throw new Error("A jobRunId or jobConfigId must be provided.");
    }
    let fileName: string;
    if (jobConfigId) {
      const errorCount = await this.getTotalErrorCountForConfig(jobConfigId);
      fileName = `${jobConfigId}-error-${errorCount}.csv`;
    } else {
      const errorCount = await this.getTotalErrorCountForJobRun(jobRunId!);
      fileName = `${jobRunId}-error-${errorCount}.csv`;
    }
    const filePath = this.sanitizeAndValidateFilePath(fileName);
    if (!fs.existsSync(filePath)) {
      // If file does not exist, create it first
      await this.createCsvFileForJob(jobRunId, jobConfigId);
    }
    const fileStream = fs.createReadStream(filePath);
    return new StreamableFile(fileStream, {
      type: "text/csv",
      disposition: `attachment; filename=\"${fileName}\"`,
    });
  }

  async isCsvFileUpToDate(jobConfigId: string): Promise<boolean> {
    const errorCount = await this.getTotalErrorCountForConfig(jobConfigId);
    const fileName = `${jobConfigId}-error-${errorCount}.csv`;
    const filePath = this.sanitizeAndValidateFilePath(fileName);
    return fs.existsSync(filePath);
  }

  getJobRunIds = async (jobConfigId) => {
    const result = await this.operationErrorRepo.query(
      `SELECT id FROM datamigrator.jobrun WHERE job_config_id = $1`,
      [jobConfigId]
    );
    return result.map((row: any) => row.id);
  };

  async getTotalErrorCountForJobRun(jobRunId: string): Promise<number> {
    const [{ count: opCount }] = await this.operationErrorRepo.query(
      `SELECT COUNT(*) as count
         FROM datamigrator.operation_errors oe
         LEFT JOIN datamigrator.operations o ON o.id = oe.operation_id
         WHERE o.job_run_id = $1`,
      [jobRunId]
    );
    const workerSetupCount = await this.getWorkerSetupCount(jobRunId);
    return Number(opCount) + workerSetupCount;
  }

  async getTotalErrorCountForConfig(jobConfigId: string): Promise<number> {
    const jobRunIds = await this.getJobRunIds(jobConfigId);
    if (jobRunIds.length === 0) return 0;
    const placeholders = jobRunIds.map((_, i) => `$${i + 1}`).join(",");
    const [{ count: opCount }] = await this.operationErrorRepo.query(
      `SELECT COUNT(*) as count
         FROM datamigrator.operation_errors oe
         LEFT JOIN datamigrator.operations o ON o.id = oe.operation_id
         WHERE o.job_run_id IN (${placeholders})`,
      jobRunIds
    );
    const workerSetupCount = await this.getWorkerSetupCount(jobRunIds);
    return Number(opCount) + workerSetupCount;
  }

  private async getWorkerSetupCount(
    jobRunIds: string | string[]
  ): Promise<number> {
    return this.workerJobRunMapRepo.count({
      where: {
        jobRunId: Array.isArray(jobRunIds) ? In(jobRunIds) : jobRunIds,
        workerResponse: Raw(
          (alias) =>
            `${alias} IS NOT NULL AND ${alias} ->> 'code' = 'SETUP_WORKER_FAILURE' AND ${alias} ->> 'status' = 'FAILED'`
        ),
      },
    });
  }

  async isCsvFileReady(
    jobRunId?: string,
    jobConfigId?: string
  ): Promise<{ ready: boolean; processing: boolean }> {
    const identifier = jobRunId || jobConfigId;
    if (!identifier) {
      throw new Error("A jobRunId or jobConfigId must be provided.");
    }
    let errorCount: number;
    if (jobConfigId) {
      errorCount = await this.getTotalErrorCountForConfig(identifier);
    } else {
      errorCount = await this.getTotalErrorCountForJobRun(identifier);
    }
    const fileName = `${identifier}-error-${errorCount}.csv`;
    const filePath = this.sanitizeAndValidateFilePath(fileName);
    const processingFilePath = this.sanitizeAndValidateFilePath(
      `${fileName}.processing`
    );
    const processing = fs.existsSync(processingFilePath);
    const ready = !processing && fs.existsSync(filePath);
    return { ready, processing };
  }
}
