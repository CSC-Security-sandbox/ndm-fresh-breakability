import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import puppeteer, { PDFOptions, Browser, Page } from "puppeteer";
import * as fs from "fs";
import * as hbs from "hbs";
import { GeneratePDFInput, PDF_TEMPLATE_PATHS } from "./pdf-generator.type";

@Injectable()
export class PDFGeneratorService implements OnApplicationShutdown {
  private browser: Browser | null = null;
  private readonly defaultPdfOptions: PDFOptions = {
    format: "A3",
    printBackground: true,
  };

  // Initialize Puppeteer browser if not already started
  async initBrowser(): Promise<void> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        browser: 'firefox',
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
        ],
        protocolTimeout: 60000,
      });
    }
  }

  // Get the Puppeteer browser instance
  private getBrowser(): Browser {
    if (!this.browser) {
      throw new Error("Puppeteer browser is not initialized yet.");
    }
    return this.browser;
  }

  // Create a new page in the browser
  private async getNewPage(): Promise<Page> {
    return this.getBrowser().newPage();
  }

  // Compile Handlebars template with provided data
  private async compileTemplate(template: keyof typeof PDF_TEMPLATE_PATHS, data: any): Promise<string> {
    const templatePath = PDF_TEMPLATE_PATHS[template];
    const templateSource = await fs.promises.readFile(templatePath, "utf8");
    const compiler = hbs.compile(templateSource);
    return compiler(data);
  }

  // Main method to generate PDF buffer
  async generatePDF({ data, template, pdfOptions }: GeneratePDFInput): Promise<Buffer> {
    await this.initBrowser();
    let page: Page | null = null;
    try {
      const html = await this.compileTemplate(template, data);
      page = await this.getNewPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const options = { ...this.defaultPdfOptions, ...pdfOptions };
      const pdfBuffer = await page.pdf(options);
      return Buffer.from(pdfBuffer);
    } finally {
      if (page && !page.isClosed()) {
        await page.close();
      }
    }
  }

  // Gracefully close the browser on application shutdown
  async onApplicationShutdown(): Promise<void> {
    if (this.browser && this.browser.connected) {
      await this.browser.close();
      this.browser == null;
    }
  }
}