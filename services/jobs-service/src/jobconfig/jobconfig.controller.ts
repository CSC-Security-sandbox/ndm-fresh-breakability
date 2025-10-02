import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, Inject } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import {SpeedTestConfigEntity } from "src/entities/speed-test-job-config.entity"
import { Auth, Permission, AuthWorker } from "@netapp-cloud-datamigrate/auth-lib";
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigService } from './jobconfig.service';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigCutoverBulk, JobConfigDiscoverBulk, JobConfigPrecheck, MigrateConfig} from './dto/jobdicoverybulk.dto';
import { JobConfigSpeedTest, SpeedTestResult } from './dto/jobspeedTest.dto'
import { JobConfigBulkCutoverRes, JobConfigBulkMigrateFinalResponse, JobConfigBulkMigrateRes, JobConfigPrecheckRes, SpeedTestEntry, SpeedTestJobRun } from './jobconfig.types';
import { BulkMigrateJobConfig } from './dto/bulkMigrateJob.dto';
import { Response } from 'express';
import { TemplateType } from 'src/constants/enums';
import { PreCheckService } from './precheck.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@ApiTags('jobs')
@Controller('jobs')
export class JobConfigController {
  private readonly logger: LoggerService;

  constructor(
    private readonly jobConfigService: JobConfigService,
    private readonly preCheckService: PreCheckService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(JobConfigController.name);
  }

  @ApiOperation({ summary: 'Create a new discovery job' })
  @ApiResponse({ status: 201, description: 'Discovery job has been successfully created.' })
  @Auth(Permission.ManageJob) 
  @ApiBearerAuth()
  @Post('/bulk-discovery')
  async createBulkDiscovery(@Body() bulkDiscovery: JobConfigDiscoverBulk): Promise<JobConfigEntity[]> {
    if (!bulkDiscovery.sourcePathIds || bulkDiscovery.sourcePathIds.length === 0) {
      throw new BadRequestException('Source path IDs cannot be empty.');
    }
    const jobConfig = await this.jobConfigService.createBulkDiscovery(bulkDiscovery);
    return jobConfig;
  }

  @ApiOperation({ summary: 'Create a new Speed Test job' })
  @ApiResponse({ status: 201, description: 'Speed Test job has been successfully created.' })
  @Auth(Permission.ManageJob) 
  @ApiBearerAuth()
  @Post('/speed-test')
  async createSpeedTest(@Body() speedTest: JobConfigSpeedTest): Promise<SpeedTestConfigEntity[]> {
    if (!speedTest.speedTests || speedTest.speedTests.length === 0) {
      throw new BadRequestException('Source path IDs cannot be empty.');
    }
    const jobConfig = await this.jobConfigService.createSpeedTest(speedTest);
    return jobConfig;
  }


  @ApiOperation({ summary: 'Get all Speed test jobs' })
  @ApiResponse({ status: 200, description: 'Returns a list of all Speed jobs Runs.' })
  @ApiBearerAuth()
  @Get('/speed-test')
  async getAllSpeedTestJobConfig(): Promise<SpeedTestJobRun[]> {
    return await this.jobConfigService.getAllSpeedTestJobRuns();
  }

  @ApiOperation({ summary: 'Store Speed test Result' })
  @ApiResponse({ status: 200, description: 'Speed test Result has been successfully Stored.' })
  @AuthWorker()
  @ApiBearerAuth()
  @Post('/speed-test/store-result')
  async storeSpeedTestResult(@Body() speedTestResult: SpeedTestResult): Promise<any>{
    return this.jobConfigService.storeSpeedTestResult(speedTestResult);
  }

  @ApiOperation({ summary: 'Get speedtest by ID' })
  @ApiResponse({ status: 200, description: 'Returns a job by its ID.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @ApiBearerAuth()
  @Get('/speed-test/:id')
  async getSpeedTestById(@Param('id') id: string): Promise<SpeedTestEntry> {
    return await this.jobConfigService.getSpeedTestById(id);
  }

  @ApiOperation({ summary: 'Create a new migrate job' })
  @ApiResponse({ status: 201, description: 'Migrate job has been successfully created.' })
  @ApiResponse({ status: 500, description: 'Internal Server Error - Unexpected error occurred.' })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input data.' })
  @ApiBearerAuth()
  @Auth(Permission.ManageJob)
  @Post('/bulk-migrate')
  async createBulkMigrate(@Body() bulkMigrate: BulkMigrateJobConfig): Promise<JobConfigBulkMigrateFinalResponse> {
    return await this.jobConfigService.createBulkMigrate(bulkMigrate);
  }

  @ApiOperation({ summary: 'Create a new cutover job' })
  @ApiResponse({ status: 201, description: 'Cutover job has been successfully created.' })
  @ApiResponse({ status: 500, description: 'Internal Server Error - Unexpected error occurred.' })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input data.' })
  @ApiBearerAuth()
  @Auth(Permission.ManageJob)
  @Post('/bulk-cutover')
  async createBulkCutover(@Body() bulkCutover: JobConfigCutoverBulk): Promise<JobConfigBulkCutoverRes[]> {
    return await this.jobConfigService.createBulkCutover(bulkCutover);
  }

  @ApiOperation({ summary: 'precheck for migration job' })
  @ApiResponse({ status: 200, description: 'Precheck is passed' })
  @ApiResponse({ status: 500, description: 'Internal Server Error - Unexpected error occurred.' })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input data.' })
  @ApiBearerAuth()
  @Auth(Permission.ManageJob)
  @Post('/precheck')
  async precheck(@Body() precheckData: JobConfigPrecheck) { 
    return  await this.preCheckService.initiatePreCheck(precheckData);
  }

  @ApiOperation({ summary: 'Get all jobs' })
  @ApiResponse({ status: 200, description: 'Returns a list of all jobs.' })
  @ApiQuery({name:'projectId',required:true,description:'Project Id',type:String})
  @ApiBearerAuth()
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
  @ApiBearerAuth()
  async getJobConfigById(@Param('id') id: string): Promise<any> {
    return await this.jobConfigService.getJobConfigById(id);
  }


  @ApiOperation({ summary: 'Download Mapping template' })
  @ApiBearerAuth()
  @Auth(Permission.ManageJob)
  @Get("download-template/:type")
  async downloadTemplate(
    @Res() res: Response,
    @Param('type') type: TemplateType
  ) {
    if (!type) {
      throw new BadRequestException("Either sid, gid, or uid type is required");
    }

    if (!Object.values(TemplateType).includes(type)) {
      throw new BadRequestException("Invalid type");
    }

    const filename = this.jobConfigService.getTemplateFilename(type);
    this.jobConfigService.sendCsvFile(filename, res);
  }

  @ApiOperation({ summary: 'Get Configs and Volumes by project ID' })
  @ApiResponse({ status: 200, description: 'Configuration Found' })
  @ApiResponse({ status: 404, description: 'Configuration Not Found' })
  @ApiBearerAuth()
  @Get('project/:projectId')
  async getConfigurationsByProjectId(@Param('projectId') projectId: string) {
      return await this.jobConfigService.getConfigsByProjectId(projectId);
  }

  @ApiOperation({ summary: 'Get notice board details by project ID' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved notice board details' })
  @ApiResponse({ status: 400, description: 'Invalid project ID' })
  @ApiResponse({ status: 404, description: 'Notice board not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiBearerAuth()
  @Auth(Permission.Reports)
  @Get('notice-board/:projectId')
  async getNoticeBoardDetailsByProjectId(@Param('projectId') projectId: string) {
    return await this.jobConfigService.getNoticeBoardDetailsByProjectId(projectId);
  }

  @Auth(Permission.ManageConfig)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a job by ID' })
  @ApiResponse({ status: 200, description: 'The job has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @ApiBearerAuth()
  @Auth(Permission.ManageConfig)
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
  @ApiBearerAuth()
  @Auth(Permission.ManageConfig)
  @Delete(':id')
  async deleteJobConfig(@Param('id') id: string): Promise<{ message: string }> {
    return await this.jobConfigService.deleteJobConfig(id);
  }
}

