import { PDFOptions } from "puppeteer";

export enum PDFTemplate {
    DISCOVERY_REPORT = "discovery_pdf_report"
}

export const PDF_TEMPLATE_PATHS: Record<PDFTemplate, string> = {
    [PDFTemplate.DISCOVERY_REPORT]: require('path').join(__dirname, '../../templates/views/discovery_pdf_report.hbs')
};


export interface GeneratePDFInput {
    data: any;
    template: PDFTemplate;
    pdfOptions?: PDFOptions
}