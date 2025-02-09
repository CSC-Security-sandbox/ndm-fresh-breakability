import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigService } from './jobconfig.service';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigCutoverBulk, JobConfigDiscoverBulk, JobConfigPrecheck } from './dto/jobdicoverybulk.dto';
import { JobConfigBulkCutoverRes, JobConfigBulkMigrateRes, JobConfigPrecheckRes } from './jobconfig.types';
import { BulkMigrateJobConfig } from './dto/bulkMigrateJob.dto';
import { Response } from 'express';

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
    if (!bulkDiscovery.sourcePathIds || bulkDiscovery.sourcePathIds.length === 0) {
      throw new BadRequestException('Source path IDs cannot be empty.');
    }
    const jobConfig = await this.jobConfigService.createBulkDiscovery(bulkDiscovery);
    return jobConfig;
  }

  @ApiOperation({ summary: 'Create a new migrate job' })
  @ApiResponse({ status: 201, description: 'Migrate job has been successfully created.' })
  @Post('/bulk-migrate')
  async createBulkMigrate(@Body() bulkMigrate: BulkMigrateJobConfig): Promise<JobConfigBulkMigrateRes[]> {
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
  @Post('/precheck')
  async precheck(@Body() precheckData: JobConfigPrecheck): Promise<JobConfigPrecheckRes> {
    return await this.jobConfigService.precheck(precheckData);
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

  @Get('download-template')
  async downloadTemplate(
    @Res() res: Response,
    @Query('sid') sid?: string, 
    @Query('gid') gid?: string, 
    @Query('uid') uid?: string
  ) {
    const params = { sid, gid, uid };
    const activeParams = Object.keys(params).filter(key => params[key]);

    if (activeParams.length !== 1) {
      throw new BadRequestException('Either sid, gid, or uid is required');
    }

    const filename = this.jobConfigService.getTemplateFilename(params);
    this.jobConfigService.sendCsvFile(filename, res);
  }

  @ApiOperation({ summary: 'Get jobfindallConfigPageDto: FindallConfigPageDto by ID' })
  @ApiResponse({ status: 200, description: 'Returns a job by its ID.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @Get(':id')
  async getJobConfigById(@Param('id') id: string): Promise<any> {
    return await this.jobConfigService.getJobConfigById(id);
  }

  @ApiOperation({ summary: 'Get Cutover details' })
  @ApiResponse({ status: 200, description: 'Cutover details Found' })
  @ApiResponse({ status: 404, description: 'Cutover details Not Found' })
  @Get('cutover/:fileServerId')
  async getCutoverDetailsByFileServerId(@Param('fileServerId') fileServerId: string) {
      return await this.jobConfigService.getCutoverDetailsByFileServerId(fileServerId);
  }

  @ApiOperation({ summary: 'Get Configs and Volumes by project ID' })
  @ApiResponse({ status: 200, description: 'Configuration Found' })
  @ApiResponse({ status: 404, description: 'Configuration Not Found' })
  @Get('project/:projectId')
  async getConfigurationsByProjectId(@Param('projectId') projectId: string) {
      return await this.jobConfigService.getConfigsByProjectId(projectId);
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
