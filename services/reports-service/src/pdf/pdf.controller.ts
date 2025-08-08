import { Controller, Res, Body, Post, Inject } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { Response } from 'express';
import { ApiBody, ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportType } from 'src/constants/enums';
import { sanitisedeErrorResponse } from 'src/utils/sanitised-error-response';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@ApiTags('Generate PDF')
@Controller('pdf')
export class PdfController {
  private logger: LoggerService;
  constructor(private readonly pdfService: PdfService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(PdfController.name);
  }

  @ApiOperation({ summary: 'Generate PDF report' })
  @Auth(Permission.Reports)
  @ApiBearerAuth()
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
    try {
      const pdf = await this.pdfService.generatePdf(jobRunId, reportType);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=report.pdf');
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    } catch (error) {
      const sanitizedError = sanitisedeErrorResponse(error);
      res.status(sanitizedError.status).send(sanitizedError);
    }
  }

}
