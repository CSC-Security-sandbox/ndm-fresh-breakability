import { Controller, BadRequestException, Get, Post, Body, StreamableFile, Logger, Inject, Optional, Param, NotFoundException, Res } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { SkipResponseTransform } from '../decorators/skip-response-transform.decorator';
import { TemporalClientService } from 'src/temporal/temporal-client.service';
import { ConsolidatedReportService } from 'src/activities/consolidated-report/consolidated-report.service';

// Workflow names constant for maintainability
const WORKFLOWS = {
  CONSOLIDATED_REPORT: 'GenerateConsolidatedReportWorkflow',
} as const;


@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  private readonly logger: LoggerService;
  constructor(
    private readonly temporalClientService: TemporalClientService,
    private readonly consolidatedReportService: ConsolidatedReportService,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(ReportsController.name);
    } else {
      this.logger = new Logger(ReportsController.name) as any;
    }
  }

  @Auth(Permission.Reports)
  @ApiBearerAuth()
  @Post('/consolidated/start')
  @ApiOperation({ summary: 'Start generating consolidated discovery report for file server (async workflow)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        fileServerId: {
          type: 'string',
          description: 'ID of the file server'
        },
        configName: {
          type: 'string',
          description: 'Name of the file server config (for filename)'
        },
        format: {
          type: 'string',
          enum: ['pdf', 'csv'],
          description: 'Report format: pdf or csv (default pdf)'
        },
      },
      required: ['fileServerId', 'configName'],
    },
  })
  @ApiResponse({ status: 200, description: 'Consolidated report workflow started successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request: Invalid fileServerId' })
  async startConsolidatedDiscoveryReport(
    @Body('fileServerId') fileServerId: string,
    @Body('configName') configName: string,
    @Body('format') format?: 'pdf' | 'csv',
  ): Promise<{ workflowId: string; message: string }> {
    if (!fileServerId) {
      throw new BadRequestException('fileServerId is required');
    }
    if (!configName) {
      throw new BadRequestException('configName is required');
    }

    const reportFormat = format === 'csv' ? 'csv' : 'pdf';
    this.logger.log(`Starting consolidated report workflow for fileServerId: ${fileServerId}, format: ${reportFormat}`);

    const workflowId = `consolidated-report-${fileServerId}-${Date.now()}`;
    
    try {
      await this.temporalClientService.startWorkflow({
        workflowName: WORKFLOWS.CONSOLIDATED_REPORT,
        workflowId,
        args: [{ fileServerId, configName, format: reportFormat }],
      });
      await this.consolidatedReportService.initializeStatus(fileServerId, workflowId, configName);
    } catch (error) {
      this.logger.error(`Failed to start consolidated report workflow: ${error.message}`);
      throw error;
    }

    return {
      workflowId,
      message: 'Consolidated report generation started. Poll the status endpoint for progress.',
    };
  }

  @Auth(Permission.Reports)
  @ApiBearerAuth()
  @Get('/consolidated/status/fileserver/:fileServerId')
  @ApiOperation({ summary: 'Get status of consolidated report generation by file server ID' })
  @ApiParam({ name: 'fileServerId', description: 'ID of the file server to check status' })
  @ApiResponse({ status: 200, description: 'Report status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'No report status found for this file server' })
  async getConsolidatedReportStatusByFileServer(
    @Param('fileServerId') fileServerId: string,
  ): Promise<{ status: string; workflowId?: string; reportPath?: string; updatedAt?: Date }> {
    if (!fileServerId) {
      throw new BadRequestException('fileServerId is required');
    }

    this.logger.log(`Checking status for fileServerId: ${fileServerId}`);

    const statusRecord = await this.consolidatedReportService.getConsolidatedReportStatus(fileServerId);
    
    if (!statusRecord || !statusRecord.status) {
      return {
        status: 'NOT_FOUND',
      };
    }

    return {
      status: statusRecord.status,
      workflowId: statusRecord.workflowId,
      reportPath: statusRecord.reportPath,
      updatedAt: statusRecord.updatedAt,
    };
  }

  @Auth(Permission.Reports)
  @ApiBearerAuth()
  @Get('/consolidated/status/:workflowId')
  @ApiOperation({ summary: 'Get status of consolidated report generation workflow' })
  @ApiParam({ name: 'workflowId', description: 'ID of the workflow to check status' })
  @ApiResponse({ status: 200, description: 'Workflow status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Workflow not found' })
  async getConsolidatedReportStatus(
    @Param('workflowId') workflowId: string,
  ): Promise<{ status: string; result?: any; error?: string }> {
    if (!workflowId) {
      throw new BadRequestException('workflowId is required');
    }

    this.logger.log(`Checking status for workflow: ${workflowId}`);

    try {
      const status = await this.temporalClientService.getWorkflowStatus(workflowId);
      return status;
    } catch (error) {
      this.logger.error(`Error getting workflow status: ${error.message}`);
      throw new NotFoundException(`Workflow ${workflowId} not found or has expired`);
    }
  }

  @Auth(Permission.Reports)
  @ApiBearerAuth()
  @Get('/consolidated/download/:fileServerId')
  @SkipResponseTransform()
  @ApiOperation({ summary: 'Download consolidated discovery report for file server' })
  @ApiParam({ name: 'fileServerId', description: 'ID of the file server' })
  @ApiResponse({ status: 200, description: 'Consolidated report downloaded successfully' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async downloadConsolidatedReport(
    @Param('fileServerId') fileServerId: string,
    @Res() res: import('express').Response,
  ): Promise<void> {
    if (!fileServerId) {
      throw new BadRequestException('fileServerId is required');
    }

    this.logger.log(`Downloading consolidated report for fileServerId: ${fileServerId}`);

    try {
      const reportPath = await this.consolidatedReportService.getReportFilePath(fileServerId);
      
      if (!reportPath) {
        throw new NotFoundException(`Consolidated report not found for file server ${fileServerId}`);
      }

      const ext = path.extname(reportPath).toLowerCase();
      const isCsv = ext === '.csv';
      const contentType = isCsv ? 'text/csv' : 'application/pdf';
      const extension = isCsv ? '.csv' : '.pdf';

      const stat = await fs.promises.stat(reportPath);
      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="consolidated-discovery-report-${fileServerId}${extension}"`,
        'Content-Length': stat.size.toString(),
      });

      const stream = fs.createReadStream(reportPath);
      stream.pipe(res);

      res.on('finish', () => {
        this.consolidatedReportService.clearStatus(fileServerId).catch((err) => {
          this.logger.error(`Failed to clear status after download: ${err.message}`);
        });
      });

      stream.on('error', (err) => {
        this.logger.error(`Stream error during consolidated report download: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).end('Download failed');
        }
      });
    } catch (error) {
      this.logger.error(`Error downloading consolidated report: ${error.message}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Consolidated report not found for file server ${fileServerId}`);
    }
  }
}
