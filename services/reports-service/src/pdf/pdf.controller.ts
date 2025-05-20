import { Controller, Res, Body, Post } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { Response } from 'express';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReportType } from 'src/constants/enums';


@ApiTags('Generate PDF')
@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}
  
    @ApiOperation({ summary: 'Generate PDF report' })
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
        res.status(500).send(error);
      } 
    } 
  
}
