import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  SerializeOptions,
  StreamableFile,
  Logger,
  Inject,
  Optional
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JobRunService } from "./job-run.service";
import {
  JobReportResponseDto,
  JobRunDetailsResponseDto,
  serializeJobRunDetailsResponse,
} from "./dto/job-rundetails.dto";
import { ErrorLogService } from "src/csv/error_log_csv.service";
import {
  Auth,
  AuthWorker,
  Permission,
} from "@netapp-cloud-datamigrate/auth-lib";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { SkipResponseTransform } from '../decorators/skip-response-transform.decorator';

@ApiTags("job-run")
@Controller("job-run")
export class JobRunController {
  private readonly logger : LoggerService;
  constructor(
    private readonly jobRunService: JobRunService,
    private readonly errorLogService: ErrorLogService,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
  ) {
        if (loggerFactory) {
            this.logger = loggerFactory.create(JobRunController.name);
        } else {
            // Fallback to basic NestJS Logger
            this.logger = new Logger(JobRunController.name) as any;
        }
    }

  @ApiOperation({ summary: "Get job run Report by JobRunId" })
  @ApiOkResponse({
    description: "Returns a job run report by its JobRunId.",
    type: JobReportResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "Job run report not found for the provided JobRunId.",
  })
  @SerializeOptions({ type: JobReportResponseDto })
  @Auth(Permission.Reports)
  @ApiBearerAuth()
  @Get("job-report")
  async getJobReportById(
    @Query("jobRunId") jobRunId: string,
    @Query("reportType") reportType: string
  ) {
    const response = await this.jobRunService.jobRunReportByJobRunId(
      jobRunId,
      reportType
    );
    return JSON.parse(response);
  }

  @ApiOperation({
    summary: "Generate Error Logs using JobRunId or jobConfigId",
  })
  @ApiOkResponse({
    description: "Returns Error Logs using JobRunId or jobConfigId",
  })
  @ApiResponse({ status: 404, description: "Error log file not found." })
  @Get("generate-error-csv/:type/:id")
  async generateErrorCsv(
    @Param("id") id: string,
    @Param("type") type: "job-run" | "job-config"
  ) {
    return await this.errorLogService.createCsvFileForJob(type, id);
  }

  @SkipResponseTransform() // Skip response transformation for binary downloads
  @Get("download-error-csv/:type/:id")
  async downloadErrorCsv(
    @Param("id") id: string,
    @Param("type") type: "job-run" | "job-config"
  ): Promise<StreamableFile> {
    return this.errorLogService.downloadErrorLogCsvFile(type, id);
  }

  @Get("is-error-csv-ready/:type/:id")
  isErrorCsvReady(
    @Param("id") id: string,
    @Param("type") type: "job-run" | "job-config"
  ) {
    return this.errorLogService.isCsvFileReady(type, id);
  }

  @ApiOperation({ summary: "Get job run Details by ID" })
  @ApiOkResponse({
    description: "Returns a job run by its ID.",
    type: JobRunDetailsResponseDto,
  })
  @ApiResponse({ status: 404, description: "Job run not found." })
  @SerializeOptions({ type: JobRunDetailsResponseDto })
  @Auth(Permission.Reports)
  @ApiBearerAuth()
  @Get(":id")
  async getJobStatsId(@Param("id") id: string) {
    const response = await this.jobRunService.getJobStatsId(id);
    const jobSubStatus = await this.jobRunService.getJobSubStatus(id);
    response.status =
      (!!jobSubStatus && jobSubStatus.subStatus) || response.status;
    return serializeJobRunDetailsResponse(response);
  }

  @ApiOperation({ summary: "Get COC Report by JobRunId" })
  @ApiOkResponse({ description: "Returns a COC report by its JobRunId." })
  @ApiResponse({ status: 404, description: "COC report not found." })
  @AuthWorker()
  @ApiBearerAuth()
  @Get("coc-report/:jobRunId")
  async getCocReportByJobRunId(@Param("jobRunId") jobRunId: string) {
    this.logger.debug(`Fetching COC report for JobRunId: ${jobRunId}`);
    this.jobRunService.getCocReportByJobRunId(jobRunId);
    this.logger.log(`COC report generation started for JobRunId: ${jobRunId}`);
    return { 
      status: 'success',
      message: `COC report generation started for JobRunId: ${jobRunId}`
    };
  }
}
