import { Body, Controller, Get, Logger, Param, Patch, Post, Put, Query, ValidationPipe } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JobRunDetailsDTO } from './dto/jobrun.dto';
import { ApproveData, JobRunActionsReq } from './dto/jobrunactions.dto';
import { JobRunPageDto, JobRunPageResponseDto } from './dto/jobrunpage.dto';
import { JobRunService } from './jobrun.service';
import { AdHocRunDTO } from './dto/adhockjobrun.dto';
import { JobRunStatus } from 'src/constants/enums';

@ApiTags('jobs run')
@Controller('job-run')
export class JobRunController {
  private readonly logger = new Logger(JobRunController.name);
  constructor(private readonly jobRunService: JobRunService) {}

  // remove the schedule cron job
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron(){
    await this.jobRunService.scheduleAJob()
  }


  @ApiOperation({ summary: 'Get a paginated list of  Job Run',  description: 'Returns a list of  Job Run based on the provided pagination parameters.'})
  @ApiOkResponse({ description: 'The list of Job Run has been retrieved successfully.',  type: JobRunPageResponseDto})
  @ApiBadRequestResponse({
      description: 'Invalid pagination parameters.'
  })
  @Get('/')
  async getJobRuns(@Query(new ValidationPipe({ transform: false, whitelist: true }))  jobRunPageDto: JobRunPageDto) {
      return await this.jobRunService.getJobAllRuns(jobRunPageDto);
  }

  @ApiOperation({ summary: 'Get job run by ID' })
  @ApiResponse({ status: 200, description: 'Returns a job run by its ID.' })
  @ApiResponse({ status: 404, description: 'Job run not found.' })
  @Get(':id')
  async getJobById(@Param('id') id: string): Promise<JobRunDetailsDTO> {
    return await this.jobRunService.getJobRun(id);
  }


  @ApiOperation({ summary: 'Job Run Actions PAUSE | RESUME | STOP' })
  @ApiResponse({ status: 200, description: 'The job run action completed successfully .' })
  @Put('/action')
  async actions(@Body() jobRunActions: JobRunActionsReq) {
    return this.jobRunService.actions(jobRunActions)
  }

  @ApiOperation({ summary: 'Approve cutover by jon run ID' })
  @ApiResponse({ status: 200, description: 'The cutover job approved successfully.' })
  @Put('/cutover/approve')
  async cutoverApprove(@Body() approveData: ApproveData) {
    return this.jobRunService.cutoverApprove(approveData?.jobRunId);
  }

  @ApiOperation({ summary: 'Creates excesive job run based on job config' })
  @ApiResponse({ status: 200, description: 'The job run created completed successfully .' })
  @Post('/ad-hoc')
  async adhocRun(@Body() adhocRun: AdHocRunDTO) {
    return this.jobRunService.addHocRun(adhocRun.jobConfigId)
  }

  @ApiOperation({ summary: 'Update Job Run Status' })
  @ApiResponse({ status: 200, description: 'The job run status updated successfully .' })
  @Patch('/:jobRunId/:status')
  async updateJobRunStatus(@Param('jobRunId') jobRunId: string, @Param('status') status: JobRunStatus) {
    console.log('updatingStatus' + 'jobRunId', jobRunId, 'status', status);
    return await this.jobRunService.updateJobRunStatus(jobRunId, status);
  }

}