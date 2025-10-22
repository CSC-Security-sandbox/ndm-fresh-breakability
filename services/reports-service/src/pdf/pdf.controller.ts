import { Controller, Res, Body, Post, Logger, Optional, Inject } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { Response } from 'express';
import { ApiBody, ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportType } from 'src/constants/enums';
import { sanitisedeErrorResponse } from 'src/utils/sanitised-error-response';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { SkipResponseTransform } from '../decorators/skip-response-transform.decorator';

@ApiTags('Generate PDF')
@Controller('pdf')
export class PdfController {
  private readonly logger: Logger | LoggerService;
  
  constructor(
    private readonly pdfService: PdfService,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(PdfController.name);
    } else {
      // Fallback to basic NestJS Logger
      this.logger = new Logger(PdfController.name) as any;
    }
  }
  
    @ApiOperation({ summary: 'Generate PDF report' })
    @Auth(Permission.Reports)
    @ApiBearerAuth()
    @SkipResponseTransform() // Skip response transformation for binary downloads
    @Post('generate')
    @ApiBody({
      schema: {
        type: 'object',
        properties: {
          jobRunId: {
            type: 'string',
            description: 'jobRunId of the report to download',
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
    async generatePdf(@Res() res: Response, @Body('jobRunId') jobRunId: string,
    @Body('report-type') reportType: ReportType) {
      this.logger.log(`Received PDF generation request for jobRunId: ${jobRunId}, reportType: ${reportType}`);
      
      try {
        const pdf = await this.pdfService.generatePdf(jobRunId, reportType);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=report.pdf');
        res.setHeader('Content-Length', pdf.length);  
        res.send(pdf);
        
        this.logger.log(`Successfully generated PDF for jobRunId: ${jobRunId}, reportType: ${reportType}`);
      } catch (error) {
        this.logger.error(`PDF generation failed for jobRunId: ${jobRunId}, reportType: ${reportType}`, error);
        
        const sanitizedError = sanitisedeErrorResponse(error);
        res.status(sanitizedError.status).send(sanitizedError);
      } 
    } 
  
}
