import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobMappingService } from './../jobmappings/jobmapping.service';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigService } from './jobconfig.service';

@ApiTags('jobs')
@Controller('jobs')
export class JobConfigController {
  constructor(
    private readonly jobConfigService: JobConfigService,
    private readonly jobMappingService: JobMappingService
  ) {}

  @ApiOperation({ summary: 'Create a new job' })
  @ApiResponse({ status: 201, description: 'The job has been successfully created.' })
  @Post()
  async createJobConfig(@Body() jobConfigData: JobConfigDto): Promise<JobConfigEntity> {
    const jobConfig = await this.jobConfigService.createJobConfig(jobConfigData);
    return jobConfig;
  }

  @ApiOperation({ summary: 'Get all jobs' })
  @ApiResponse({ status: 200, description: 'Returns a list of all jobs.' })
  @Get()
  async getAllJobConfig(): Promise<JobConfigEntity[]> {
    return await this.jobConfigService.getAllJobConfig();
  }

  @ApiOperation({ summary: 'Get job by ID' })
  @ApiResponse({ status: 200, description: 'Returns a job by its ID.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @Get(':id')
  async getJobConfigById(@Param('id') id: string): Promise<JobConfigEntity> {
    return await this.jobConfigService.getJobConfigById(id);
  }

  @ApiOperation({ summary: 'Update a job by ID' })
  @ApiResponse({ status: 200, description: 'The job has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @Put(':id')
  async updateJobConfig(
    @Param('id') id: string,
    @Body() jobConfigData: JobConfigDto,
  ): Promise<JobConfigEntity> {
    return await this.jobConfigService.updateJobConfig(id, jobConfigData);
  }

  @ApiOperation({ summary: 'Delete a job by ID' })
  @ApiResponse({ status: 200, description: 'The job has been successfully deleted.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @Delete(':id')
  async deleteJobConfig(@Param('id') id: string): Promise<{ message: string }> {
    return await this.jobConfigService.deleteJobConfig(id);
  }

}
