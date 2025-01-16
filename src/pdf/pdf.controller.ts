import { Controller, Get, Res, HttpException, HttpStatus, Body } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { Response } from 'express';

@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}
    @Get('generate')
    async generatePdf(@Res() res: Response, @Body('jobRunId') jobRunId: string,
    @Body('report-type') reportType: string) {
      try {
        const pdf = await this.pdfService.generatePdf(jobRunId, reportType);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=report.pdf');
        res.setHeader('Content-Length', pdf.length);  
        res.send(pdf);
      } catch (error) {
        console.error(error);
        res.status(500).send(error);
      } 
    } 
  
}
