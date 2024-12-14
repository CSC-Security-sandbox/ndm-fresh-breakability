import { BadRequestException, Controller, Get, Logger, Param, Query, ValidationPipe } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JobRunEntity } from './../entities/jobrun.entity';
import { JobRunService } from './jobrun.service';
import { JobRunFilterDto } from './dto/jobrun.dto';
import { JobRunPageDto, JobRunPageResponseDto } from './dto/jobrunpage.dto';

@ApiTags('jobs run')
@Controller('job-run')
export class JobRunController {
  private readonly logger = new Logger(JobRunController.name);
  constructor(private readonly jobRunService: JobRunService) {}

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
  async getJobById(@Param('id') id: string): Promise<JobRunEntity[]> {
    return await this.jobRunService.getJobRun({ where: { id } });
  }
}