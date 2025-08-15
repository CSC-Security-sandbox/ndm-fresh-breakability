import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import puppeteer, { PDFOptions, Browser, Page } from "puppeteer";

@Injectable()
export class PDFGeneratorService implements OnApplicationShutdown {
  private browser: Browser;

  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
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

  getBrowser(): Browser {
    if (!this.browser) {
      throw new Error("Puppeteer browser is not initialized yet.");
    }
    return this.browser;
  }

  getNewPage(): Promise<Page> {
    return this.getBrowser().newPage();
  }

  async generatePDF(html: string, pdfOptions?: PDFOptions): Promise<Buffer> {
    await this.init();
    let page: Page;
    try {
      page = await this.getNewPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        ...(pdfOptions || {}),
      });
      return Buffer.from(pdfBuffer);
    } finally {
      if (page && !page.isClosed()) {
        await page.close();
      }
    }
  }

  async onApplicationShutdown() {
    if (this.browser && this.browser.connected) {
      await this.browser.close();
    }
  }
}
