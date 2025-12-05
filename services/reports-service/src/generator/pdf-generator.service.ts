import {
  Injectable,
  OnApplicationShutdown,
  Inject,
  Optional,
  Logger,
} from "@nestjs/common";
import puppeteer, { PDFOptions, Browser, Page } from "puppeteer";
import * as fs from "fs";
import * as hbs from "hbs";
import { GeneratePDFInput, PDF_TEMPLATE_PATHS } from "./pdf-generator.type";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class PDFGeneratorService implements OnApplicationShutdown {
  private browser: Browser | null = null;
  private readonly logger: LoggerService;
  private readonly defaultPdfOptions: PDFOptions = {
    format: "A3", // use only format for natural scaling
    printBackground: true,
    margin: { top: "3mm", right: "3mm", bottom: "3mm", left: "3mm" }, // optional
    width: "297mm", // A3 width
    height: "420mm", // A3 height
    scale: 0.6, // Adjust scale for better fit
  };

  constructor(@Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(PDFGeneratorService.name);
    } else {
      // Fallback to basic NestJS Logger
      this.logger = new Logger('PDFGeneratorService') as any;
    }
  }

  async initBrowser(): Promise<void> {
    if (!this.browser) {
      this.logger.debug('Initializing Puppeteer browser for PDF generation');
      try {
        this.browser = await puppeteer.launch({
          headless: true,
          browser: 'firefox',
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
          ],
          protocolTimeout: 60000,
        });
        this.logger.log('Puppeteer browser initialized successfully during application startup');
      } catch (error) {
        this.logger.error('Failed to initialize Puppeteer browser', error);
        throw error;
      }
    }
  }

  private getBrowser(): Browser {
    if (!this.browser) {
      this.logger.error('Attempted to get browser before initialization');
      throw new Error("Puppeteer browser is not initialized yet.");
    }
    return this.browser;
  }

  private async getNewPage(): Promise<Page> {
    return this.getBrowser().newPage();
  }

  private async compileTemplate(template: keyof typeof PDF_TEMPLATE_PATHS, data: any, context?: { projectId?: string; jobRunId?: string }): Promise<string> {
    try {
      const projectId = context?.projectId;
      const templatePath = PDF_TEMPLATE_PATHS[template];
      this.logger.log(`${projectId ? `projectId: ${projectId} ` : ''}Compiling PDF template: ${template} from path: ${templatePath}`);
      
      const templateSource = await fs.promises.readFile(templatePath, "utf8");
      const compiler = hbs.compile(templateSource);
      const compiledHtml = compiler(data);
      
      this.logger.log(`${projectId ? `projectId: ${projectId} ` : ''}Template compilation successful for: ${template}`);
      return compiledHtml;
    } catch (error) {
      const projectId = context?.projectId;
      this.logger.error(`${projectId ? `projectId: ${projectId} ` : ''}Failed to compile template: ${template}`, error);
      throw error;
    }
  }

  async generatePDF({ data, template, pdfOptions, context }: GeneratePDFInput): Promise<Buffer> {
    const projectId = context?.projectId;
    const jobRunId = context?.jobRunId;
    
    this.logger.log(`${projectId ? `projectId: ${projectId} ` : ''}${jobRunId ? `jobRunId: ${jobRunId} ` : ''}Starting PDF generation for template: ${template}`);
    const startTime = Date.now();
    
    await this.initBrowser();
    let page: Page | null = null;
    try {
      const html = await this.compileTemplate(template, data, context);
      page = await this.getNewPage();

      this.logger.log(`${projectId ? `projectId: ${projectId} ` : ''}Setting page viewport and content for PDF generation`);
      // Set viewport to match A3 at 150 DPI: width = 1754px, height = 2480px
      await page.setViewport({ width: 0, height: 0, deviceScaleFactor: 1, isMobile: false });

      await page.setContent(html, { waitUntil: 'load' });
      const options = { ...this.defaultPdfOptions, ...pdfOptions };
      
      this.logger.log(`${projectId ? `projectId: ${projectId} ` : ''}Generating PDF with options:`, JSON.stringify(options));
      const pdfBuffer = await page.pdf(options);
      
      const duration = Date.now() - startTime;
      this.logger.log(`${projectId ? `projectId: ${projectId} ` : ''}${jobRunId ? `jobRunId: ${jobRunId} ` : ''}PDF generation completed successfully for template: ${template} in ${duration}ms`);
      
      return Buffer.from(pdfBuffer);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`${projectId ? `projectId: ${projectId} ` : ''}${jobRunId ? `jobRunId: ${jobRunId} ` : ''}PDF generation failed for template: ${template} after ${duration}ms`, error);
      throw error;
    } finally {
      if (page && !page.isClosed()) {
        this.logger.log(`${projectId ? `projectId: ${projectId} ` : ''}Closing page after PDF generation`);
        await page.close();
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.browser && this.browser.connected) {
      this.logger.log('Shutting down Puppeteer browser');
      try {
        await this.browser.close();
        this.browser = null;
        this.logger.log('Puppeteer browser shutdown completed successfully');
      } catch (error) {
        this.logger.error('Error during Puppeteer browser shutdown', error);
        throw error;
      }
    } else {
      this.logger.log('No active browser to shutdown');
    }
  }
}