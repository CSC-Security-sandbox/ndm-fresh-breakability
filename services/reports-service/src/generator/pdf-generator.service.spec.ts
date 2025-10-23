// ---- MOCKS MUST BE FIRST ----
const mockLaunch = jest.fn();
jest.mock("puppeteer", () => ({
  __esModule: true,
  default: { launch: mockLaunch },
  launch: mockLaunch,
}));

jest.mock("fs", () => ({
  promises: { readFile: jest.fn() },
}));

jest.mock("hbs", () => ({
  compile: jest.fn(),
}));

// ---- THEN IMPORTS ----
import { Test, TestingModule } from "@nestjs/testing";
import { PDFGeneratorService } from "./pdf-generator.service";
import { GeneratePDFInput, PDF_TEMPLATE_PATHS } from "./pdf-generator.type";
import * as fs from "fs"; 
import * as hbs from "hbs";
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

describe("PDFGeneratorService", () => {
  let service: PDFGeneratorService;
  let mockBrowser: any;
  let mockPage: any;
  let mockLogger: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPage = {
      setContent: jest.fn(),
      setViewport: jest.fn(),
      pdf: jest.fn().mockResolvedValue(Buffer.from("pdf-content")),
      close: jest.fn(),
      isClosed: jest.fn().mockReturnValue(false),
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn(),
      connected: true,
    };

    mockLaunch.mockResolvedValue(mockBrowser);

    mockLogger = {
      debug: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      verbose: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PDFGeneratorService,
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLogger),
          },
        },
      ],
    }).compile();

    service = module.get<PDFGeneratorService>(PDFGeneratorService);
  });

  describe("initBrowser", () => {
    it("should initialize browser when not already initialized", async () => {
      await service.initBrowser();
      expect(mockLaunch).toHaveBeenCalled();
    });

    it("should not reinitialize browser if already initialized", async () => {
      await service.initBrowser();
      mockLaunch.mockClear();
      await service.initBrowser();
      expect(mockLaunch).not.toHaveBeenCalled();
    });
  });

  describe("generatePDF", () => {
    const mockInput: GeneratePDFInput = {
      data: { title: "Test Report" },
      template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
      pdfOptions: { format: "Letter" as const },
    };

    beforeEach(() => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue("<html>{{title}}</html>");
      (hbs.compile as jest.Mock).mockReturnValue(() => "<html>Test Report</html>");
    });

    it("should generate PDF successfully", async () => {
      const result = await service.generatePDF(mockInput);
      expect(fs.promises.readFile).toHaveBeenCalled();
      expect(hbs.compile).toHaveBeenCalled();
      expect(mockPage.setContent).toHaveBeenCalledWith(
        "<html>Test Report</html>",
        { waitUntil: "load" }
      );
      expect(mockPage.pdf).toHaveBeenCalledWith({
        format: "Letter",
        printBackground: true,
        margin: { top: "3mm", right: "3mm", bottom: "3mm", left: "3mm" },
        width: "297mm",
        height: "420mm",
        scale: 0.6,
      });
      expect(result).toEqual(Buffer.from("pdf-content"));
      expect(mockPage.close).toHaveBeenCalled();
    });

    it("should use default PDF options when not provided", async () => {
      const inputWithoutOptions: GeneratePDFInput = {
        data: { title: "Test" },
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
      };
      await service.generatePDF(inputWithoutOptions);
      expect(mockPage.pdf).toHaveBeenCalledWith({
        format: "A3",
        printBackground: true,
        margin: { top: "3mm", right: "3mm", bottom: "3mm", left: "3mm" },
        width: "297mm",
        height: "420mm",
        scale: 0.6,
      });
    });

    it("should close page even if PDF generation fails", async () => {
      mockPage.pdf.mockRejectedValue(new Error("PDF generation failed"));
      await expect(service.generatePDF(mockInput)).rejects.toThrow("PDF generation failed");
      expect(mockPage.close).toHaveBeenCalled();
    });

    it("should not attempt to close page if already closed", async () => {
      mockPage.isClosed.mockReturnValue(true);
      await service.generatePDF(mockInput);
      expect(mockPage.close).not.toHaveBeenCalled();
    });

    it("should handle template compilation errors", async () => {
      (hbs.compile as jest.Mock).mockImplementation(() => {
        throw new Error("Template compilation failed");
      });
      await expect(service.generatePDF(mockInput)).rejects.toThrow("Template compilation failed");
    });

    it("should handle file read errors", async () => {
      (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error("File not found"));
      await expect(service.generatePDF(mockInput)).rejects.toThrow("File not found");
    });
  });

  describe("onApplicationShutdown", () => {
    it("should close browser if connected", async () => {
      await service.initBrowser();
      await service.onApplicationShutdown();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should not close browser if not connected", async () => {
      await service.initBrowser();
      mockBrowser.connected = false;
      await service.onApplicationShutdown();
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });

    it("should not throw error if browser is null", async () => {
      await expect(service.onApplicationShutdown()).resolves.not.toThrow();
    });

    it("should handle browser close errors gracefully", async () => {
      await service.initBrowser();
      mockBrowser.close.mockRejectedValue(new Error("Close failed"));
      await expect(service.onApplicationShutdown()).rejects.toThrow("Close failed");
    });
  });

  describe("edge cases", () => {

    it("should handle setContent failure", async () => {
      mockPage.setContent.mockRejectedValue(new Error("Failed to set content"));
      (fs.promises.readFile as jest.Mock).mockResolvedValue("<html></html>");
      (hbs.compile as jest.Mock).mockReturnValue(() => "<html></html>");
      await expect(service.generatePDF({
        data: {},
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
      })).rejects.toThrow("Failed to set content");
      expect(mockPage.close).toHaveBeenCalled();
    });

    it("should handle null page scenario in finally block", async () => {
      mockBrowser.newPage.mockResolvedValue(null);
      await expect(service.generatePDF({
        data: {},
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
      })).rejects.toThrow();
    });


    it("should correctly merge PDF options", async () => {
      const customOptions: GeneratePDFInput = {
        data: { title: "Test" },
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
        pdfOptions: {
          format: "A3" as const,
          margin: { top: "1cm", bottom: "1cm" },
          landscape: true,
        },
      };
      await service.generatePDF(customOptions);
      expect(mockPage.pdf).toHaveBeenCalledWith({
        format: "A3",
        printBackground: true,
        margin: { top: "1cm", bottom: "1cm" },
        width: "297mm",
        height: "420mm",
        scale: 0.6,
        landscape: true,
      });
    });
  });

  describe("browser lifecycle", () => {
    it("should handle browser launch timeout", async () => {
      mockLaunch.mockRejectedValueOnce(new Error("Timeout during launch"));
      await expect(service.initBrowser()).rejects.toThrow("Timeout during launch");
    });

    it("should maintain browser instance across multiple PDF generations", async () => {
      await service.generatePDF({
        data: { title: "First" },
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
      });
      mockLaunch.mockClear();
      await service.generatePDF({
        data: { title: "Second" },
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
      });
      expect(mockLaunch).not.toHaveBeenCalled();
      expect(mockBrowser.newPage).toHaveBeenCalledTimes(2);
    });
  });

  describe("context-aware logging", () => {
    it("should generate PDF with projectId context", async () => {
      const inputWithContext: GeneratePDFInput = {
        data: { title: "Test Report" },
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
        context: { projectId: "proj-123" },
      };
      
      (fs.promises.readFile as jest.Mock).mockResolvedValue("<html>{{title}}</html>");
      (hbs.compile as jest.Mock).mockReturnValue(() => "<html>Test Report</html>");
      
      await service.generatePDF(inputWithContext);
      
      // Verify context is passed through to compileTemplate and logging
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('projectId: proj-123')
      );
    });

    it("should generate PDF with both projectId and jobRunId context", async () => {
      const inputWithFullContext: GeneratePDFInput = {
        data: { title: "Test Report" },
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
        context: { projectId: "proj-123", jobRunId: "job-456" },
      };
      
      (fs.promises.readFile as jest.Mock).mockResolvedValue("<html>{{title}}</html>");
      (hbs.compile as jest.Mock).mockReturnValue(() => "<html>Test Report</html>");
      
      await service.generatePDF(inputWithFullContext);
      
      // Verify both context values are logged
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('projectId: proj-123')
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('jobRunId: job-456')
      );
    });

    it("should handle template compilation error with projectId context", async () => {
      const inputWithContext: GeneratePDFInput = {
        data: { title: "Test Report" },
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
        context: { projectId: "proj-123" },
      };
      
      (fs.promises.readFile as jest.Mock).mockResolvedValue("<html>{{title}}</html>");
      (hbs.compile as jest.Mock).mockImplementation(() => {
        throw new Error("Template compilation failed");
      });
      
      await expect(service.generatePDF(inputWithContext)).rejects.toThrow("Template compilation failed");
      
      // Verify error is logged with project context
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('projectId: proj-123'),
        expect.any(Error)
      );
    });

    it("should handle PDF generation error with full context", async () => {
      const inputWithContext: GeneratePDFInput = {
        data: { title: "Test Report" },
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
        context: { projectId: "proj-123", jobRunId: "job-456" },
      };
      
      (fs.promises.readFile as jest.Mock).mockResolvedValue("<html>{{title}}</html>");
      (hbs.compile as jest.Mock).mockReturnValue(() => "<html>Test Report</html>");
      mockPage.pdf.mockRejectedValue(new Error("PDF generation failed"));
      
      await expect(service.generatePDF(inputWithContext)).rejects.toThrow("PDF generation failed");
      
      // Verify error is logged with full context
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('projectId: proj-123'),
        expect.any(Error)
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('jobRunId: job-456'),
        expect.any(Error)
      );
    });
  });

  describe("constructor without LoggerFactory", () => {
    it("should use fallback NestJS Logger when LoggerFactory is not provided", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [PDFGeneratorService], // No LoggerFactory provided
      }).compile();

      const serviceWithFallback = module.get<PDFGeneratorService>(PDFGeneratorService);
      
      // This test ensures the fallback logger branch is covered
      await serviceWithFallback.initBrowser();
      
      // The service should still work with fallback logger
      expect(mockLaunch).toHaveBeenCalled();
    });
  });

  describe("getBrowser error conditions", () => {
    it("should throw error when trying to get browser before initialization", async () => {
      // Create a fresh service without the initialized browser
      const freshService = new PDFGeneratorService();
      
      // Mock the private getBrowser method to be accessed indirectly through generatePDF
      // but make sure initBrowser fails to leave browser as null
      mockLaunch.mockRejectedValueOnce(new Error("Browser launch failed"));
      
      const input: GeneratePDFInput = {
        data: { title: "Test" },
        template: "reportTemplate" as keyof typeof PDF_TEMPLATE_PATHS,
      };
      
      (fs.promises.readFile as jest.Mock).mockResolvedValue("<html>{{title}}</html>");
      (hbs.compile as jest.Mock).mockReturnValue(() => "<html>Test Report</html>");
      
      // This should fail because initBrowser will fail, preventing browser initialization
      await expect(freshService.generatePDF(input)).rejects.toThrow(
        "Browser launch failed"
      );
    });
  });
});