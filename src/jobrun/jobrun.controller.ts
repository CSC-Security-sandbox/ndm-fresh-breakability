import { Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JobRunFilterDto } from '../dto/jobrun.dto';
import { JobRunEntity } from './../entities/jobrun.entity';
import { JobRunService } from './jobrun.service';

@ApiTags('jobs run')
@Controller('job-run')
export class JobRunController {
  private readonly logger = new Logger(JobRunController.name);
  constructor(private readonly jobRunService: JobRunService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron(){
    // this.logger.log('Cron job executed at: ', new Date());
    await this.jobRunService.scheduleAJob()
  }


  @Get()
  @ApiOperation({ summary: 'Get all job runs with pagination, sorting, and filtering' })
  @ApiQuery({ name: 'page', type: Number, required: false, example: 1, description: 'Page number for pagination' })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 10, description: 'Number of records per page' })
  @ApiQuery({ name: 'sortField', type: String, required: false, example: 'start_time', description: 'Field to sort by' })
  @ApiQuery({ name: 'sortOrder', enum: ['ASC', 'DESC'], required: false, example: 'ASC', description: 'Sort order' })
  @ApiQuery({ 
    name: 'filter', 
    required: false, 
    description: 'Filter object for job runs',
    type: JobRunFilterDto,
  })
  async getJobRuns(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('sortField') sortField = 'start_time',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'ASC',
    @Query() filter: JobRunFilterDto,
  ) {
    return this.jobRunService.getJobAllRuns(page, limit, sortField, sortOrder, filter);
  }

  @ApiOperation({ summary: 'Get job run by ID' })
  @ApiResponse({ status: 200, description: 'Returns a job run by its ID.' })
  @ApiResponse({ status: 404, description: 'Job run not found.' })
  @Get(':id')
  async getJobById(@Param('id') id: string): Promise<JobRunEntity[]> {
    return await this.jobRunService.getJobRun({ where: { id } });
  }
}