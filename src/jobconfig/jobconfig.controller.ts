import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { JobConfigService } from './jobconfig.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDTO } from '../dto/jobconfig.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('jobs')
@Controller('jobs')
export class JobConfigController {
  constructor(private readonly jobConfigService: JobConfigService) {}

  @ApiOperation({ summary: 'Create a new job' })
  @ApiResponse({ status: 201, description: 'The job has been successfully created.' })
  @Post()
  async createJob(@Body() jobData: JobConfigDTO): Promise<JobConfigEntity> {
    return await this.jobConfigService.createJob(jobData);
  }

  @ApiOperation({ summary: 'Get all jobs' })
  @ApiResponse({ status: 200, description: 'Returns a list of all jobs.' })
  @Get()
  async getAllJob(): Promise<JobConfigEntity[]> {
    return await this.jobConfigService.getAllJob();
  }

  @ApiOperation({ summary: 'Get job by ID' })
  @ApiResponse({ status: 200, description: 'Returns a job by its ID.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @Get(':id')
  async getJobById(@Param('id') id: string): Promise<JobConfigEntity> {
    return await this.jobConfigService.getJobById(id);
  }

  @ApiOperation({ summary: 'Update a job by ID' })
  @ApiResponse({ status: 200, description: 'The job has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @Put(':id')
  async updateJob(
    @Param('id') id: string,
    @Body() jobData: JobConfigDTO,
  ): Promise<JobConfigEntity> {
    return await this.jobConfigService.updateJob(id, jobData);
  }

  @ApiOperation({ summary: 'Delete a job by ID' })
  @ApiResponse({ status: 200, description: 'The job has been successfully deleted.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @Delete(':id')
  async deleteJob(@Param('id') id: string): Promise<{ message: string }> {
    return await this.jobConfigService.deleteJob(id);
  }

}
