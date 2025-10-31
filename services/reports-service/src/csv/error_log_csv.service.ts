import {
  Injectable,
  StreamableFile,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  Optional,
  Inject,
} from "@nestjs/common";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { Raw, Repository, In } from "typeorm";
import * as fs from "fs";
import * as fastCsv from "fast-csv";
import { InjectRepository } from "@nestjs/typeorm";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import * as path from "path";
import {
  sanitizeAndValidateFilePath,
  sanitizeIdentifier,
} from "../utils/file-utils";
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

/**
 * Error types that should be visible to users
 * RECOVERABLE_ERROR is excluded as it's handled internally through retry mechanism
 */
const USER_VISIBLE_ERROR_TYPES = ['FATAL_ERROR', 'TRANSIENT_ERROR'] as const;

@Injectable()
export class ErrorLogService {
  private readonly logger : LoggerService;
  constructor(
    @InjectRepository(OperationErrorEntity)
    private operationErrorRepo: Repository<OperationErrorEntity>,
    @InjectRepository(WorkerJobRunMap)
    private workerJobRunMapRepo: Repository<WorkerJobRunMap>,
     @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
  ) {
    if (loggerFactory) {
            this.logger = loggerFactory.create(ErrorLogService.name);
    } else {
        // Fallback to basic NestJS Logger for worker threads
        this.logger = new Logger(ErrorLogService.name) as any;
    }
  }

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
    await this.handleError(jobRunId, jobConfigId);
    try {
      const params: (string | number)[] = [];
      let whereClause = "";

      if (jobConfigId) {
        whereClause = "jc.id = $1";
        params.push(jobConfigId);
      } else {
        whereClause = "o.job_run_id = $1";
        params.push(jobRunId);
      }

      // Add error types as parameters
      const errorTypesParamIndex = params.length + 1;
      params.push([...USER_VISIBLE_ERROR_TYPES]);
      params.push(pageSize, offset);

      const query = `
    SELECT
      MIN(oe.id::text)           AS "Error Id",
      MIN(oe.created_at)         AS "Created At",
      (o.job_run_id)             AS "Job Run Id",
      MIN(jc.job_type)           AS "Job Type",
      MIN(oe.error_type)         AS "Error Type",
      MIN(oe.error_message)      AS "Error Details",
      MIN(oe.file_name)          AS "File Name",
      MIN(oe.file_path)          AS "File Path",
      MIN(oe.origin)             AS "Origin",
      MIN(oe.operation_type)     AS "Operation",
      MIN(oe.error_code)         AS "Code",
      COUNT(*)                   AS "Occurrence"
    FROM datamigrator.operation_errors oe
    LEFT JOIN datamigrator.operations o ON o.id = oe.operation_id
    LEFT JOIN datamigrator.jobrun jr ON jr.id = o.job_run_id
    LEFT JOIN datamigrator.jobconfig jc ON jc.id = jr.job_config_id
    WHERE ${whereClause}
      AND oe.error_type = ANY($${errorTypesParamIndex})
    GROUP BY oe.file_path, o.job_run_id
    ORDER BY MIN(oe.created_at)
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

      return this.operationErrorRepo.query(query, params);
    } catch (error) {
      throw new BadRequestException({
        displayMessage: "Something went wrong while fetching errors.",
        message: error.message,
      });
    }
  }

  async getWorkerSetupErrors(jobRunIds: string | string[]): Promise<any[]> {
    try {
      let whereClause: string;
      let params: (string | number)[];
      if (Array.isArray(jobRunIds) && jobRunIds.length > 0) {
        whereClause = `wjrm.job_run_id IN (${jobRunIds.map((_, i) => `$${i + 1}`).join(",")})`;
        params = jobRunIds;
      } else if (!Array.isArray(jobRunIds)) {
        whereClause = "wjrm.job_run_id = $1";
        params = [jobRunIds];
      } else {
        return [];
      }
      const query = `
        SELECT
          wjrm.id,
          wjrm.job_run_id,
          wjrm.worker_response,
          jc.job_type
        FROM datamigrator.worker_jobrun_mapping wjrm
        LEFT JOIN datamigrator.jobrun jr ON jr.id = wjrm.job_run_id
        LEFT JOIN datamigrator.jobconfig jc ON jc.id = jr.job_config_id
        WHERE ${whereClause}
          AND wjrm.worker_response IS NOT NULL
          AND wjrm.worker_response ->> 'code' = 'SETUP_WORKER_FAILURE'
          AND wjrm.worker_response ->> 'status' = 'FAILED'
      `;
      return this.workerJobRunMapRepo.query(query, params);
    } catch (error) {
      throw new BadRequestException({
        displayMessage: "Something went wrong while fetching errors.",
        message: error.message,
      });
    }
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
      try {
        const safeFilePath = sanitizeAndValidateFilePath(
          path.basename(filePath)
        );
        const writeStream = fs.createWriteStream(safeFilePath);
        const csvStream = fastCsv.format({ headers: true });
        csvStream.pipe(writeStream);
        const processingFilePath = sanitizeAndValidateFilePath(
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
        writeStream.on("finish", () => {
          fs.unlinkSync(processingFilePath);
          resolve();
        });
        writeStream.on("error", reject);
        csvStream.on("error", reject);
      } catch (error) {
        throw new BadRequestException({
          displayMessage:
            "Something went wrong while writing errors on the file.",
          message: error.message,
        });
      }
    });
  }

  // Helper to parse worker_response safely
  parseWorkerResponse = (resp: any) => {
    if (!resp) return {};
    if (typeof resp === "string") {
      try {
        return JSON.parse(resp);
      } catch {
        return {};
      }
    }
    return resp;
  };

  private async fetchFormattedSetupErrors(
    jobRunId: string
  ): Promise<Record<string, any>[]> {
    try {
      const rawErrors = await this.getWorkerSetupErrors(jobRunId);

      return rawErrors.map((err) => {
        const workerResponse = this.parseWorkerResponse(err.worker_response);
        return {
          "Error Id": err.id,
          "Created At": workerResponse.createdAt,
          "Job Run Id": err.job_run_id,
          "Job Type": err.job_type,
          "Error Type": "FATAL_ERROR",
          "Error Details": workerResponse.message,
          Origin: workerResponse.origin,
          Operation: workerResponse.operation,
          Code: workerResponse.code,
          Occurrence: workerResponse.occurrence ?? 1,
        };
      });
    } catch (error) {
      throw new BadRequestException({
        displayMessage:
          "Something went wrong while writing errors on the file.",
        message: error.message,
      });
    }
  }

  get getErrorLogsDirectory(): string {
    return process.env.ERROR_LOGS_DOWNLOAD_LOCATION || "./error-logs";
  }

  async handleError(jobRunId?: string, jobConfigId?: string) {
    const isMissing = !jobRunId || jobRunId === "undefined";
    const isMissingConfig = !jobConfigId || jobConfigId === "undefined";
    if (isMissing && isMissingConfig) {
      throw new BadRequestException("jobRunId or jobConfigId is required.");
    }
    if (
      jobRunId &&
      jobConfigId &&
      jobRunId !== "undefined" &&
      jobConfigId !== "undefined"
    ) {
      throw new BadRequestException(
        "Provide either jobRunId or jobConfigId, not both."
      );
    }
  }

  async createCsvFileForJob(type?: string, id?: string): Promise<any> {
    const { jobRunId, jobConfigId } = this.extractJobIdentifiers(type, id);
    await this.handleError(jobRunId, jobConfigId);
    try {
      const identifier = jobRunId || jobConfigId;
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
      const safeIdentifier = this.escapeRegex(sanitizeIdentifier(identifier));
      filePattern = new RegExp(`^${safeIdentifier}-error-\\d+\\.csv$`);

      const dir = this.getErrorLogsDirectory;
      const filePath = sanitizeAndValidateFilePath(fileName);

      // If the latest file already exists, return it
      if (fs.existsSync(filePath)) {
        return filePath;
      }

      // Clean up old files matching the pattern (except the one being created)
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (filePattern.test(f) && f !== fileName) {
            try {
              fs.unlinkSync(sanitizeAndValidateFilePath(f));
            } catch (err) {
              throw new BadRequestException({
                displayMessage:
                  "Error while cleaning up old error report files.",
                message: err.message,
              });
            }
          }
        }
      }

      await this.writeLargeCsvToDisk(filePath, jobRunId, jobConfigId);
      return { message: "CSV generation started" };
    } catch (error) {
      throw new BadRequestException({
        displayMessage: "Error Report generation failed",
        message: error.message,
      });
    }
  }

  async downloadErrorLogCsvFile(
    type?: string,
    id?: string
  ): Promise<StreamableFile> {
    try {
      const { jobRunId, jobConfigId } = this.extractJobIdentifiers(type, id);
      await this.handleError(jobRunId, jobConfigId);
      let fileName: string;
      if (jobConfigId) {
        const errorCount = await this.getTotalErrorCountForConfig(jobConfigId);
        fileName = `${jobConfigId}-error-${errorCount}.csv`;
      } else {
        const errorCount = await this.getTotalErrorCountForJobRun(jobRunId!);
        fileName = `${jobRunId}-error-${errorCount}.csv`;
      }
      const filePath = sanitizeAndValidateFilePath(fileName);
      if (!fs.existsSync(filePath)) {
        // If file does not exist, create it first
        await this.createCsvFileForJob(jobRunId, jobConfigId);
      }
      const fileStream = fs.createReadStream(filePath);
      return new StreamableFile(fileStream, {
        type: "text/csv",
        disposition: `attachment; filename=\"${fileName}\"`,
      });
    } catch (error) {
      throw new BadRequestException({
        displayMessage: "Download Error Report failed",
        message: error.message,
      });
    }
  }

  getJobRunIds = async (jobConfigId) => {
    try {
      const result = await this.operationErrorRepo.query(
        `SELECT id FROM datamigrator.jobrun WHERE job_config_id = $1`,
        [jobConfigId]
      );
      return result.map((row: any) => row.id);
    } catch (error) {
      throw new BadRequestException({
        displayMessage:
          "Error while fetching job run IDs for the given job config.",
        message: error.message,
      });
    }
  };

  async getTotalErrorCountForJobRun(jobRunId: string): Promise<number> {
    try {
      const [{ count: opCount }] = await this.operationErrorRepo.query(
        `SELECT COUNT(*) as count
         FROM datamigrator.operation_errors oe
         LEFT JOIN datamigrator.operations o ON o.id = oe.operation_id
         WHERE o.job_run_id = $1
           AND oe.error_type = ANY($2)`,
        [jobRunId, [...USER_VISIBLE_ERROR_TYPES]]
      );
      const workerSetupCount = await this.getWorkerSetupCount(jobRunId);
      return Number(opCount) + workerSetupCount;
    } catch (error) {
      throw new BadRequestException({
        displayMessage:
          "Error while fetching total error count for the job run.",
        message: error.message,
      });
    }
  }

  async getTotalErrorCountForConfig(jobConfigId: string): Promise<number> {
    try {
      const jobRunIds = await this.getJobRunIds(jobConfigId);
      if (jobRunIds.length === 0) return 0;
      const placeholders = jobRunIds.map((_, i) => `$${i + 1}`).join(",");
      const errorTypesParamIndex = jobRunIds.length + 1;
      const [{ count: opCount }] = await this.operationErrorRepo.query(
        `SELECT COUNT(*) as count
         FROM datamigrator.operation_errors oe
         LEFT JOIN datamigrator.operations o ON o.id = oe.operation_id
         WHERE o.job_run_id IN (${placeholders})
           AND oe.error_type = ANY($${errorTypesParamIndex})`,
        [...jobRunIds, [...USER_VISIBLE_ERROR_TYPES]]
      );
      const workerSetupCount = await this.getWorkerSetupCount(jobRunIds);
      return Number(opCount) + workerSetupCount;
    } catch (error) {
      throw new BadRequestException({
        displayMessage:
          "Error while fetching total error count for the job config.",
        message: error.message,
      });
    }
  }

  private async getWorkerSetupCount(
    jobRunIds: string | string[]
  ): Promise<number> {
    try {
      return this.workerJobRunMapRepo.count({
        where: {
          jobRunId: Array.isArray(jobRunIds) ? In(jobRunIds) : jobRunIds,
          workerResponse: Raw(
            (alias) =>
              `${alias} IS NOT NULL AND ${alias} ->> 'code' = 'SETUP_WORKER_FAILURE' AND ${alias} ->> 'status' = 'FAILED'`
          ),
        },
      });
    } catch (error) {
      throw new BadRequestException({
        displayMessage: "Error while fetching worker setup count.",
        message: error.message,
      });
    }
  }

  // Helper to extract jobRunId or jobConfigId based on type
  private extractJobIdentifiers(
    type?: string,
    id?: string
  ): { jobRunId?: string; jobConfigId?: string } {
    if (type === "job-run") {
      return { jobRunId: id };
    } else if (type === "job-config") {
      return { jobConfigId: id };
    } else {
      throw new BadRequestException({
        displayMessage: "Invalid type. Must be 'job-run' or 'job-config'.",
      });
    }
  }

  async isCsvFileReady(
    type?: string,
    id?: string
  ): Promise<{ ready: boolean; processing: boolean }> {
    try {
      const { jobRunId, jobConfigId } = this.extractJobIdentifiers(type, id);
      const identifier = jobRunId || jobConfigId;
      await this.handleError(jobRunId, jobConfigId);
      let errorCount: number;
      if (jobConfigId) {
        errorCount = await this.getTotalErrorCountForConfig(identifier);
      } else {
        errorCount = await this.getTotalErrorCountForJobRun(identifier);
      }
      const fileName = `${identifier}-error-${errorCount}.csv`;
      const filePath = sanitizeAndValidateFilePath(fileName);
      const processingFilePath = sanitizeAndValidateFilePath(
        `${fileName}.processing`
      );
      const processing = fs.existsSync(processingFilePath);
      const ready = !processing && fs.existsSync(filePath);
      return { ready, processing };
    } catch (error) {
      throw new BadRequestException({
        displayMessage:
          "Something went wrong while checking CSV file readiness.",
        message: error.message,
      });
    }
  }
}
