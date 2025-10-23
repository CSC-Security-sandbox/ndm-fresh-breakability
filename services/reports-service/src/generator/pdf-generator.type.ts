import { PDFOptions } from "puppeteer";

export enum PDFTemplate {
    DISCOVERY_REPORT = "discovery_pdf_report",
    JOBS_REPORT = "jobs_report"
}

export const PDF_TEMPLATE_PATHS: Record<PDFTemplate, string> = {
    [PDFTemplate.DISCOVERY_REPORT]: require('path').join(__dirname, '../../templates/views/discovery_pdf_report.hbs'),
    [PDFTemplate.JOBS_REPORT]: require('path').join(__dirname, '../../templates/views/jobs_report.hbs')
};


export interface GeneratePDFInput {
    data: any;
    template: PDFTemplate;
    pdfOptions?: PDFOptions;
    context?: {
        jobRunId?: string;
        projectId?: string;
    };
}