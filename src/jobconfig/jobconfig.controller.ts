import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JobConfigEntity, SpeedTestConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigDto } from './dto/jobconfig.dto';
import { JobConfigService } from './jobconfig.service';
import { JobListingDTO } from './dto/joblisting.dto';
import { JobConfigCutoverBulk, JobConfigDiscoverBulk, JobConfigPrecheck, MigrateConfig, JobConfigSpeedTest, SpeedTestResult } from './dto/jobdicoverybulk.dto';
import { JobConfigBulkCutoverRes, JobConfigBulkMigrateRes, JobConfigPrecheckRes } from './jobconfig.types';
import { BulkMigrateJobConfig } from './dto/bulkMigrateJob.dto';
import { Response } from 'express';
import { TemplateType } from 'src/constants/enums';

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

  @ApiOperation({ summary: 'Create a new Speed Test job' })
  @ApiResponse({ status: 201, description: 'Speed Test job has been successfully created.' })
  @Post('/speed-test')
  async createSpeedTest(@Body() speedTest: JobConfigSpeedTest): Promise<SpeedTestConfigEntity[]> {
    if (!speedTest.speedTests || speedTest.speedTests.length === 0) {
      throw new BadRequestException('Source path IDs cannot be empty.');
    }
    const jobConfig = await this.jobConfigService.createSpeedTest(speedTest);
    return jobConfig;
  }

  @ApiOperation({ summary: 'Store Speed test Result' })
  @ApiResponse({ status: 201, description: 'Speed test Result has been successfully Stored.' })
  @Post('/store-speed-test-result')
  async storeSpeedTestResult(@Body() speedTestResult: SpeedTestResult){
    this.jobConfigService.storeSpeedTestResult(speedTestResult);
  }

  @ApiOperation({ summary: 'Get speedtest by ID' })
  @ApiResponse({ status: 200, description: 'Returns a job by its ID.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  @Get('/speedtest/:id')
  async getSpeedTestById(@Param('id') id: string): Promise<any> {
    return await this.jobConfigService.getSpeedTestById(id);
  }

  @ApiOperation({ summary: 'Create a new migrate job' })
  @ApiResponse({ status: 201, description: 'Migrate job has been successfully created.' })
  @ApiResponse({ status: 500, description: 'Internal Server Error - Unexpected error occurred.' })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input data.' })
  @Post('/bulk-migrate')
  async createBulkMigrate(@Body() bulkMigrate: BulkMigrateJobConfig): Promise<JobConfigBulkMigrateRes[]> {
    return await this.jobConfigService.createBulkMigrate(bulkMigrate);
  }

  @ApiOperation({ summary: 'Create a new cutover job' })
  @ApiResponse({ status: 201, description: 'Cutover job has been successfully created.' })
  @ApiResponse({ status: 500, description: 'Internal Server Error - Unexpected error occurred.' })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input data.' })
  @Post('/bulk-cutover')
  async createBulkCutover(@Body() bulkCutover: JobConfigCutoverBulk): Promise<JobConfigBulkCutoverRes[]> {
    return await this.jobConfigService.createBulkCutover(bulkCutover);
  }

  @ApiOperation({ summary: 'precheck for migration job' })
  @ApiResponse({ status: 200, description: 'Precheck is passed' })
  @ApiResponse({ status: 500, description: 'Internal Server Error - Unexpected error occurred.' })
  @ApiResponse({ status: 400, description: 'Bad Request - Invalid input data.' })
  @Post('/precheck')
  async precheck(@Body() precheckData: JobConfigPrecheck) { 
     return  await this.jobConfigService.precheck(precheckData);
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

  @ApiOperation({ summary: 'Get Cutover details' })
  @ApiResponse({ status: 200, description: 'Cutover details Found' })
  @ApiResponse({ status: 404, description: 'Cutover details Not Found' })
  @Get('cutover/:fileServerId')
  async getCutoverDetailsByFileServerId(@Param('fileServerId') fileServerId: string) {
      return await this.jobConfigService.getCutoverDetailsByFileServerId(fileServerId);
  }

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

  @ApiOperation({ summary: 'Precheck Validation' })
  @Post('precheck/validate')
  async checkCommonWorkersAndValidatePaths(@Body() precheckData: MigrateConfig[]) {
    return await this.jobConfigService.precheckValidation(precheckData);
  }

}
