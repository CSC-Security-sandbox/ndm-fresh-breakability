import {
  Injectable,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { PdfGenerationOptions } from './pdf-generator.options';
import { GeneratePDFInput, PDFTemplate } from './pdf-generator.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { buildDiscoveryPdfDefinition } from './pdf-documents/discovery-pdf.document';
import { buildJobsReportPdfDefinition } from './pdf-documents/jobs-report-pdf.document';

@Injectable()
export class PDFGeneratorService {
  private readonly printer: InstanceType<any>;
  private readonly logger: LoggerService;

  constructor(@Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PdfPrinter = require('pdfmake');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getReportPdfFonts } = require('./pdf-fonts');
    this.printer = new PdfPrinter(getReportPdfFonts());
    if (loggerFactory) {
      this.logger = loggerFactory.create(PDFGeneratorService.name);
    } else {
      this.logger = new Logger('PDFGeneratorService') as unknown as LoggerService;
    }
  }

  async generatePDF({
    data,
    template,
    pdfOptions,
    context,
  }: GeneratePDFInput): Promise<Buffer> {
    const projectId = context?.projectId;
    const jobRunId = context?.jobRunId;
    this.logger.log(
      `${projectId ? `projectId: ${projectId} ` : ''}${
        jobRunId ? `jobRunId: ${jobRunId} ` : ''
      }Starting PDF generation for template: ${template}`,
    );
    const startTime = Date.now();
    try {
      const docDefinition = this.buildDocumentDefinition(
        template,
        data as Record<string, unknown>,
        pdfOptions,
      );
      const buffer = await this.renderToBuffer(docDefinition);
      const duration = Date.now() - startTime;
      this.logger.log(
        `${projectId ? `projectId: ${projectId} ` : ''}${
          jobRunId ? `jobRunId: ${jobRunId} ` : ''
        }PDF generation completed for template: ${template} in ${duration}ms, bytes: ${buffer.length}`,
      );
      return buffer;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `${projectId ? `projectId: ${projectId} ` : ''}${
          jobRunId ? `jobRunId: ${jobRunId} ` : ''
        }PDF generation failed for template: ${template} after ${duration}ms`,
        error,
      );
      throw error;
    }
  }

  private buildDocumentDefinition(
    template: PDFTemplate,
    data: Record<string, unknown>,
    pdfOptions?: PdfGenerationOptions,
  ): TDocumentDefinitions {
    switch (template) {
      case PDFTemplate.DISCOVERY_REPORT:
        return buildDiscoveryPdfDefinition(
          data as Record<string, unknown[]>,
          pdfOptions,
        );
      case PDFTemplate.JOBS_REPORT:
        return buildJobsReportPdfDefinition(data, pdfOptions);
      default:
        throw new Error(`Unsupported PDF template: ${template}`);
    }
  }

  private renderToBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const pdfDoc = this.printer.createPdfKitDocument(docDefinition);
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);
        pdfDoc.end();
      } catch (e) {
        reject(e);
      }
    });
  }
}
