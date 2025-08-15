import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ValidationPipe,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from "@nestjs/swagger";

import { JobRunDetailsDTO } from "./dto/jobrun.dto";
import { ApprovalRequestDTO, JobRunActionsReq } from "./dto/jobrunactions.dto";
import { JobRunPageDto, JobRunPageResponseDto } from "./dto/jobrunpage.dto";
import { JobRunService } from "./jobrun.service";
import { AdHocRunDTO } from "./dto/adhockjobrun.dto";
import { CutOverStatus, JobRunStatus } from "src/constants/enums";
import { JobRunInitService } from "./jobrun.init.service";
import { JobErrorQueryDto } from "./dto/jobRunErrors.dto";
import { Auth, AuthWorker, Permission } from "@netapp-cloud-datamigrate/auth-lib";
import { JobRunActionService } from "./jobrun-action.service";
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@ApiTags("jobs run")
@Controller("job-run")
export class JobRunController {
  private readonly logger: LoggerService;

  constructor(
    private readonly jobRunService: JobRunService,
    private readonly jobRunInitService: JobRunInitService,
    private readonly jobRunActionService: JobRunActionService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(JobRunController.name);
  }

  // remove the schedule cron job
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron() {
    await this.jobRunInitService.scheduleAJob();
  }

  @ApiOperation({
    summary: "Get a paginated list of  Job Run",
    description:
      "Returns a list of  Job Run based on the provided pagination parameters.",
  })
  @ApiOkResponse({
    description: "The list of Job Run has been retrieved successfully.",
    type: JobRunPageResponseDto,
  })
  @ApiBadRequestResponse({
    description: "Invalid pagination parameters.",
  })
  @ApiBearerAuth()
  @Auth(Permission.ViewJob)
  @Get("/")
  async getJobRuns(
    @Query(new ValidationPipe({ transform: false, whitelist: true }))
    jobRunPageDto: JobRunPageDto
  ) {
    return await this.jobRunService.getJobAllRuns(jobRunPageDto);
  }

  @ApiOperation({ summary: "Get Job Run Errors" })
  @ApiResponse({
    status: 200,
    description: "The job run errors retrieved successfully .",
  })
  @ApiBearerAuth()
  @Auth(Permission.ViewJob)
  @Get("/errors")
  async getJobRunErrors(
    @Query(new ValidationPipe({ transform: false, whitelist: true }))
    jobErrorQuery: JobErrorQueryDto
  ) {
    return this.jobRunService.getJobRunErrors(jobErrorQuery);
  }

  @ApiOperation({ summary: "Get job run by ID" })
  @ApiResponse({ status: 200, description: "Returns a job run by its ID." })
  @ApiResponse({ status: 404, description: "Job run not found." })
  @ApiBearerAuth()
  @Auth(Permission.ViewJob)
  @Get(":id")
  async getJobById(@Param("id") id: string): Promise<JobRunDetailsDTO> {
    return await this.jobRunService.getJobRun(id);
  }

  @ApiOperation({ summary: "Job Run Actions PAUSE | RESUME | STOP" })
  @ApiResponse({
    status: 200,
    description: "The job run action completed successfully .",
  })
  @ApiBearerAuth()
  @Auth(Permission.ManageJob)
  @Put("/action")
  async actions(@Body() jobRunActions: JobRunActionsReq) {
    return this.jobRunActionService.actions(jobRunActions);
  }

  @ApiOperation({ summary: "Approve cutover by jon run ID" })
  @ApiResponse({
    status: 200,
    description: "The cutover job approved successfully.",
  })
  @ApiBearerAuth()
  @Auth(Permission.ManageJob)
  @Put("/cutover/approve")
  async cutoverApprove(@Body() approval: ApprovalRequestDTO) {
    this.logger.log(JSON.stringify(approval));
    return this.jobRunService.approveCutoverRequest(approval);
  }

  @ApiOperation({ summary: "Creates excesive job run based on job config" })
  @ApiResponse({
    status: 200,
    description: "The job run created completed successfully .",
  })
  @ApiBearerAuth()
  @Auth(Permission.ManageJob)
  @Post("/ad-hoc")
  async adhocRun(@Body() adhocRun: AdHocRunDTO) {
    return this.jobRunService.addHocRun(adhocRun.jobConfigId);
  }

  @ApiOperation({ summary: "Update Job Run Status" })
  @ApiResponse({
    status: 200,
    description: "The job run status updated successfully .",
  })
  @AuthWorker()
  @Patch("/:jobRunId/:status")
  async updateJobRunStatus(
    @Param("jobRunId") jobRunId: string,
    @Param("status") status: JobRunStatus
  ) {
    console.log("updatingStatus" + "jobRunId", jobRunId, "status", status);
    return await this.jobRunService.updateJobRunStatus(jobRunId, status);
  }

  @ApiOperation({ summary: "Approve cutover by jon run ID" })
  @ApiResponse({
    status: 200,
    description: "The cutover job approved successfully.",
  })
  @ApiBearerAuth()
  @AuthWorker()
  @Put("/cutover/:jobRunId/:status")
  async cutoverApproval(
    @Param("jobRunId") jobRunId: string,
    @Param("status") status: CutOverStatus
  ) {
    return this.jobRunService.cutOverApproval(jobRunId, status);
  }

  @ApiOperation({ summary: "Get Job Run Error Overview" })
  @ApiResponse({
    status: 200,
    description: "The job run error overview retrieved successfully .",
  })
  @ApiBearerAuth()
  @Auth(Permission.Reports)
  @Get("/:jobRunId/errors/overview")
  async getErrorOverview(@Param("jobRunId") jobRunId: string) {
    return this.jobRunService.getErrorOverview(jobRunId);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async checkWorkerHealthCron() {
    await this.jobRunService.checkWorkerHealth();
  }

  @ApiOperation({ summary: "Update worker response" })
  @ApiResponse({
    status: 200,
    description: "The worker response updated successfully.",
  })
  @AuthWorker()
  @Put("/worker-response/:jobRunId/:workerId")
  @ApiBody({
    description: "The response data returned by the worker (can include status, message, code, etc.)",
    type: Object,
  })
  async updateWorkerResponse(
    @Param("jobRunId") jobRunId: string,
    @Param("workerId") workerId: string,
    @Body() workerResponse: Record<string, any>
  ) {
    return this.jobRunService.updateWorkerResponse(jobRunId, workerId, workerResponse);
  }
}
