import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigService } from './jobconfig.service';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigDiscoverBulk } from './dto/jobdicoverybulk.dto';

@ApiTags('jobs')
@Controller('jobs')
export class JobConfigController {
  constructor(
    private readonly jobConfigService: JobConfigService,
  ) {}

  @ApiOperation({ summary: 'Create a new job' })
  @ApiResponse({ status: 201, description: 'The job has been successfully created.' })
  @Post('/bulk-discovery')
  async createBulkDiscovery(@Body() bulkDiscovery: JobConfigDiscoverBulk): Promise<JobConfigEntity[]> {
    const jobConfig = await this.jobConfigService.createBulkDiscovery(bulkDiscovery);
    return jobConfig;
  }
  

  @ApiOperation({ summary: 'Get all jobs' })
  @ApiResponse({ status: 200, description: 'Returns a list of all jobs.' })
  @ApiQuery({name:'projectId',required:true,description:'Project Id',type:String})
  @Get()
  async getAllJobConfig(@Query('projectId')projectId:string): Promise<JobListingDTO[]> {
    if(!projectId){
      throw new BadRequestException(`Required parameters['ProjectId'] is missing in the request`);
    }
    return await this.jobConfigService.getAllJobConfig(projectId);
  }

  @ApiOperation({ summary: 'Get jobfindallConfigPageDto: FindallConfigPageDto by ID' })
  @ApiResponse({ status: 200, description: 'Returns a job by its ID.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @Get(':id')
  async getJobConfigById(@Param('id') id: string): Promise<any> {
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
