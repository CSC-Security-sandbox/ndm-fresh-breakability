import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JobRunEntity } from './../entities/jobrun.entity';
import { JobRunService } from './jobrun.service';
import { JobRunDto } from '../dto/jobrun.dto';

@ApiTags('jobs run')
@Controller('job-run')
export class JobRunController {
  constructor(private readonly jobRunService: JobRunService) {}

  @ApiOperation({ summary: 'Create a new job run' })
  @ApiResponse({ status: 201, description: 'The job run has been successfully created.' })
  @Post()
  async createJob(@Body() jobRunData: JobRunDto): Promise<JobRunEntity> {
    return await this.jobRunService.createJobRun(jobRunData);
  }

  @ApiOperation({ summary: 'Get all job run' })
  @ApiResponse({ status: 200, description: 'Returns a list of all job run' })
  @Get()
  async getAllJob(): Promise<JobRunEntity[]> {
    return await this.jobRunService.getJobRun({});
  }

  @ApiOperation({ summary: 'Get job run by ID' })
  @ApiResponse({ status: 200, description: 'Returns a job run by its ID.' })
  @ApiResponse({ status: 404, description: 'Job run not found.' })
  @Get(':id')
  async getJobById(@Param('id') id: string): Promise<JobRunEntity[]> {
    return await this.jobRunService.getJobRun({ where: { id } });
  }
}