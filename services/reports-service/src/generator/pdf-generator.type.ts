import type { PdfGenerationOptions } from './pdf-generator.options';

export enum PDFTemplate {
  DISCOVERY_REPORT = 'discovery_pdf_report',
  JOBS_REPORT = 'jobs_report',
}

export interface GeneratePDFInput {
  data: unknown;
  template: PDFTemplate;
  pdfOptions?: PdfGenerationOptions;
  context?: {
    jobRunId?: string;
    projectId?: string;
  };
}
