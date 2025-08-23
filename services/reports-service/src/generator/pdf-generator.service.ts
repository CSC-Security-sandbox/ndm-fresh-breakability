import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import puppeteer, { PDFOptions, Browser, Page } from "puppeteer";
import * as fs from "fs";
import * as hbs from "hbs";
import { GeneratePDFInput, PDF_TEMPLATE_PATHS } from "./pdf-generator.type";

@Injectable()
export class PDFGeneratorService implements OnApplicationShutdown {
  private browser: Browser | null = null;
  private readonly defaultPdfOptions: PDFOptions = {
    format: "A3", // use only format for natural scaling
    printBackground: true,
    margin: { top: "3mm", right: "3mm", bottom: "3mm", left: "3mm" }, // optional
    width: "297mm", // A3 width
    height: "420mm", // A3 height
    scale: 0.6, // Adjust scale for better fit
  };

  async initBrowser(): Promise<void> {
    if (!this.browser) {
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
    }
  }

  private getBrowser(): Browser {
    if (!this.browser) {
      throw new Error("Puppeteer browser is not initialized yet.");
    }
    return this.browser;
  }

  private async getNewPage(): Promise<Page> {
    return this.getBrowser().newPage();
  }

  private async compileTemplate(template: keyof typeof PDF_TEMPLATE_PATHS, data: any): Promise<string> {
    const templatePath = PDF_TEMPLATE_PATHS[template];
    const templateSource = await fs.promises.readFile(templatePath, "utf8");
    const compiler = hbs.compile(templateSource);
    return compiler(data);
  }

  async generatePDF({ data, template, pdfOptions }: GeneratePDFInput): Promise<Buffer> {
    await this.initBrowser();
    let page: Page | null = null;
    try {
      const html = await this.compileTemplate(template, data);
      page = await this.getNewPage();

      // Set viewport to match A3 at 150 DPI: width = 1754px, height = 2480px
      await page.setViewport({ width: 0, height: 0, deviceScaleFactor: 1, isMobile: false });

      await page.setContent(html, { waitUntil: 'load' });
      const options = { ...this.defaultPdfOptions, ...pdfOptions };
      const pdfBuffer = await page.pdf(options);
      return Buffer.from(pdfBuffer);
    } finally {
      if (page && !page.isClosed()) {
        await page.close();
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.browser && this.browser.connected) {
      await this.browser.close();
      this.browser = null;
    }
  }
}