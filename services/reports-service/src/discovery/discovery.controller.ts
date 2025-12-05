import { Controller, Query, BadRequestException, Get, Post, Body, Header, StreamableFile,Logger, Inject, Optional } from '@nestjs/common';
import { ApiQuery, ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { DiscoveryService } from './discovery.service';
import {
  Ctx,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import { DiscoveryCompletedPayload } from 'src/discovery/discovery.interface';
import { Pattern, ReportType } from 'src/discovery/pattern.enum';
import { Auth, AuthWorker, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { SkipResponseTransform } from '../decorators/skip-response-transform.decorator';


@ApiTags('Get discovery inventory')
@Controller('inventory')
export class DiscoveryController {
  private readonly logger : LoggerService;
  constructor(
    private readonly discoveryService: DiscoveryService,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
    ) {
        if (loggerFactory) {
            this.logger = loggerFactory.create(DiscoveryController.name);
        } else {
            // Fallback to basic NestJS Logger
            this.logger = new Logger(DiscoveryController.name) as any;
        }
    }


  @Auth(Permission.Reports)
  @ApiBearerAuth()
  @Get('/')
  @ApiOperation({ summary: 'Discover file server' })
  @ApiQuery({
    name: 'fileServerId',
    type: String,
    required: true,
    description: 'ID of the file server to be discovered',
  })
  @ApiResponse({ status: 200, description: 'Discovery inventory completed successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request: Missing fileServerId' })
  async discoverFileServerDefault(@Query('fileServerId') fileServerId: string): Promise<any> {
    if (!fileServerId) {
      throw new BadRequestException('fileServerId query parameter is required');
    }
    return await this.discoveryService.getDiscoveryByFileServerId(fileServerId);
  }

  @Auth(Permission.Reports)
  @ApiBearerAuth()
  @Get('/with-path')
  @ApiOperation({ summary: 'Discover inventory of file server' })
  @ApiQuery({
    name: 'fileServerId',
    type: String,
    required: true,
    description: 'ID of the file server to be discovered',
  })
  @ApiQuery({
    name: 'parentPath',
    type: String,
    required: true,
    description: 'Path of the folder to be discovered',
  })
  @ApiResponse({ status: 200, description: 'Discovery completed successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request: Missing fileServerId' })
  async discoverFileServerWithPath(
    @Query('fileServerId') fileServerId: string,
    @Query('parentPath') parentPath: string,
  ): Promise<any> {
    if (!fileServerId) {
      throw new BadRequestException('fileServerId query parameter is required');
    }

    return await this.discoveryService.getDiscoveryByFileServerIdAndParentPath(fileServerId, parentPath);
  }

  @Auth(Permission.Reports)
  @ApiBearerAuth()
  @SkipResponseTransform() // Skip response transformation for binary downloads
  @Post('/download')
  @ApiOperation({ summary: 'Download reports based on jobRunId and report type' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        jobRunId: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of jobRunIds',
        },
        'report-type': {
          type: 'string',
          enum: Object.values(ReportType),
          description: 'Type of the report to download',
        },
      },
      required: ['jobRunId', 'report-type'],
    },
  })

  @ApiResponse({ status: 200, description: 'Files downloaded successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request: Invalid input' })
  @Header('Content-Type', 'application/zip') 
  @Header('Content-Disposition', 'attachment; filename=reports.zip') 
  async downloadReports(
    @Body('jobRunId') jobRunIds: string[],
    @Body('report-type') reportType: ReportType,
  ): Promise<StreamableFile> {
    if (!jobRunIds || jobRunIds.length === 0) {
      throw new BadRequestException('jobRunId array must not be empty');
    }

    if (!Object.values(ReportType).includes(reportType)) {
      throw new BadRequestException('Invalid report type. Allowed values are COC or discovery');
    }

    const zipBuffer = await this.discoveryService.getReportsAsZip(jobRunIds, reportType);

    const stream = new StreamableFile(zipBuffer);

    return stream;
  }

  @ApiBearerAuth()
  @AuthWorker()
  @Post('/generate-report')
  @ApiOperation({ summary: 'Generate a blank report for a job run' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        jobRunId: { type: 'string', description: 'The ID of the job run' },
        'report-type': { 
          type: 'string', 
          enum: Object.values(ReportType), 
          description: 'The type of the report to generate' 
        },
      },
      required: ['jobRunId', 'report-type'],
    },
  })
  @ApiResponse({ status: 200, description: 'Report generated successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request: Missing jobRunId or report-type' })
  @Header('Content-Type', 'text/plain')
  @Header('Content-Disposition', 'attachment; filename=generated-report.txt')
  async generateReport(
    @Body('jobRunId') jobRunId: string,
    @Body('report-type') reportType: ReportType
  ): Promise<string> {
    this.logger.log("reached here in controller");
    this.logger.debug(`Generating report for jobRunId: ${jobRunId}, reportType: ${reportType}`);
    if (!jobRunId) {
      throw new BadRequestException('jobRunId is required');
    }
    if (!reportType || !Object.values(ReportType).includes(reportType)) {
      throw new BadRequestException('Invalid report type. Allowed values are COC or DISCOVERY');
    }
    this.discoveryService.createReportFile(jobRunId, reportType);
    return "OK"
  }


  @AuthWorker()
  @ApiBearerAuth()
  @Post('/generate-jobs-report')
  @ApiOperation({ summary: 'Generate jobs report' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        jobRunId: { type: 'string', description: 'The ID of the job run' },
      },
      required: ['jobRunId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Report generated successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request: Missing jobRunId' })
  @Header('Content-Type', 'text/plain')
  @Header('Content-Disposition', 'attachment; filename=generated-report.txt')
  async generateJobsReport(
    @Body('jobRunId') jobRunId: string,
  ): Promise<string> {
    this.discoveryService.createJobsPDFReportData(jobRunId);
    return "OK"
  }


  @MessagePattern(Pattern.DISCOVERY_COMPLETED)
  async generateDiscoveryReport(@Payload() payload: DiscoveryCompletedPayload, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      this.logger.log(
        `Received discovery completed message: ${JSON.stringify(payload)}`
      );
      this.discoveryService.createReportFile(payload.jobRunId, 'DISCOVERY');
      channel.ack(originalMsg);
    } catch (err) {
      this.logger.error(`Error processing inventory message: ${err.message}`);
      channel.nack(originalMsg);
    }
  }

}

