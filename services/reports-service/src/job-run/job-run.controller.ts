import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  SerializeOptions,
  StreamableFile,
  Logger,
} from "@nestjs/common";
import {
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

@ApiTags("job-run")
@Controller("job-run")
export class JobRunController {
  constructor(
    private readonly jobRunService: JobRunService,
    private readonly logger: Logger,
    private readonly errorLogService: ErrorLogService
  ) {}

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
  @Get("generate-error-csv")
  async generateErrorCsv(
    @Query("jobRunId") jobRunId?: string,
    @Query("jobConfigId") jobConfigId?: string
  ) {
    return await this.errorLogService.createCsvFileForJob(
      jobRunId,
      jobConfigId
    );
  }

  @Get("download-error-csv")
  async downloadErrorCsv(
    @Query("jobRunId") jobRunId?: string,
    @Query("jobConfigId") jobConfigId?: string
  ): Promise<StreamableFile> {
    return this.errorLogService.downloadErrorLogCsvFile(jobRunId, jobConfigId);
  }

  @Get("is-error-csv-ready")
  isErrorCsvReady(
    @Query("jobRunId") jobRunId?: string,
    @Query("jobConfigId") jobConfigId?: string
  ) {
    return this.errorLogService.isCsvFileReady(jobRunId, jobConfigId);
  }

  @ApiOperation({ summary: "Get job run Details by ID" })
  @ApiOkResponse({
    description: "Returns a job run by its ID.",
    type: JobRunDetailsResponseDto,
  })
  @ApiResponse({ status: 404, description: "Job run not found." })
  @SerializeOptions({ type: JobRunDetailsResponseDto })
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
  @Get("coc-report/:jobRunId")
  async getCocReportByJobRunId(@Param("jobRunId") jobRunId: string) {
    this.logger.debug(`Fetching COC report for JobRunId: ${jobRunId}`);
    const response = await this.jobRunService.getCocReportByJobRunId(jobRunId);
    return response;
  }
}
