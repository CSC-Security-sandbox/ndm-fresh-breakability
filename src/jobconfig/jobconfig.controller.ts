import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigService } from './jobconfig.service';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigCutoverBulk, JobConfigDiscoverBulk, JobConfigMigrateBulk, JobConfigPrecheck } from './dto/jobdicoverybulk.dto';
import { JobConfigBulkCutoverRes, JobConfigBulkMigrateRes, JobConfigPrecheckRes } from './jobconfig.types';

@ApiTags('jobs')
@Controller('jobs')
export class JobConfigController {
  constructor(
    private readonly jobConfigService: JobConfigService,
  ) {}

  @ApiOperation({ summary: 'Create a new discovery job' })
  @ApiResponse({ status: 201, description: 'Discovery job has been successfully created.' })
  @Post('/bulk-discovery')
  async createBulkDiscovery(@Body() bulkDiscovery: JobConfigDiscoverBulk): Promise<JobConfigEntity[]> {
    const jobConfig = await this.jobConfigService.createBulkDiscovery(bulkDiscovery);
    return jobConfig;
  }

  @ApiOperation({ summary: 'Create a new migrate job' })
  @ApiResponse({ status: 201, description: 'Migrate job has been successfully created.' })
  @Post('/bulk-migrate')
  async createBulkMigrate(@Body() bulkMigrate: JobConfigMigrateBulk): Promise<JobConfigBulkMigrateRes[]> {
    return await this.jobConfigService.createBulkMigrate(bulkMigrate);
  }

  @ApiOperation({ summary: 'Create a new cutover job' })
  @ApiResponse({ status: 201, description: 'Cutover job has been successfully created.' })
  @Post('/bulk-cutover')
  async createBulkCutover(@Body() bulkCutover: JobConfigCutoverBulk): Promise<JobConfigBulkCutoverRes[]> {
    return await this.jobConfigService.createBulkCutover(bulkCutover);
  }

  @ApiOperation({ summary: 'precheck for migration job' })
  @ApiResponse({ status: 200, description: 'Precheck is passed' })
  @Get('/precheck')
  async precheck(@Body() bulkCutover: JobConfigPrecheck): Promise<JobConfigPrecheckRes> {
    return await this.jobConfigService.precheck(bulkCutover);
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
  @Patch(':id')
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
