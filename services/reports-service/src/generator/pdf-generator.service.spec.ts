jest.mock("./pdf-fonts", () => ({
  getReportPdfFonts: () => ({
    Roboto: {
      normal: Buffer.from("0"),
      bold: Buffer.from("0"),
      italics: Buffer.from("0"),
      bolditalics: Buffer.from("0"),
    },
  }),
}));

jest.mock("pdfmake", () => {
  function PdfPrinter() {}
  PdfPrinter.prototype.createPdfKitDocument = function () {
    let dataCb: (b: Buffer) => void;
    let endCb: () => void;
    return {
      on(ev: string, fn: any) {
        if (ev === "data") dataCb = fn;
        if (ev === "end") endCb = fn;
      },
      end() {
        dataCb(Buffer.from("%PDF-1"));
        endCb();
      },
    };
  };
  return PdfPrinter;
}, { virtual: true });

import { Test, TestingModule } from "@nestjs/testing";
import { PDFGeneratorService } from "./pdf-generator.service";
import { GeneratePDFInput, PDFTemplate } from "./pdf-generator.type";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";

describe("PDFGeneratorService", () => {
  let service: PDFGeneratorService;
  let mockLogger: { log: jest.Mock; error: jest.Mock; warn: jest.Mock };

  beforeEach(async () => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
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

  describe("generatePDF", () => {
    it("should produce a discovery PDF buffer starting with %PDF", async () => {
      const input: GeneratePDFInput = {
        data: {
          CategoryA: [{ sub_category: "Row1", value: "v1" }],
        },
        template: PDFTemplate.DISCOVERY_REPORT,
        pdfOptions: { pageSize: "A4", pageOrientation: "portrait" },
      };
      const result = await service.generatePDF(input);
      expect(result.subarray(0, 4).toString()).toBe("%PDF");
      expect(result.length).toBeGreaterThan(4);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining("Starting PDF generation"),
      );
    });

    it("should produce a jobs report PDF", async () => {
      const input: GeneratePDFInput = {
        data: {
          title: "T",
          summary: [
            {
              source: {
                file_server: "s",
                path: "/p",
                protocol: "nfs",
                protocol_version: "3",
                job_type: "DISCOVER",
              },
              target: {
                file_server: "t",
                path: "/tp",
                capacity: "1",
              },
              details: {
                files: 1,
                directories: 0,
                capacity: "1",
                job_run_id: "id",
                created_at: "now",
                duration: 0,
                errors: 0,
                status: "OK",
              },
              coc_report: { filePath: "", size: "", status: "" },
            },
          ],
          last_iteration: {
            summary: {},
            job_run_id: "",
            duration: "",
            delta_operations: "",
            capacity_copied: "",
            capacity_deleted: "",
          },
          last_errors: {},
          cutovers: [],
          customerInfo: { projectName: "P", reportDate: "d" },
        },
        template: PDFTemplate.JOBS_REPORT,
        pdfOptions: {
          pageSize: "A0",
          pageOrientation: "landscape",
        },
      };
      const result = await service.generatePDF(input);
      expect(result.subarray(0, 4).toString()).toBe("%PDF");
      expect(result.length).toBeGreaterThan(4);
    });

    it("should reject unsupported template", async () => {
      await expect(
        service.generatePDF({
          data: {},
          template: "unknown_template" as PDFTemplate,
        }),
      ).rejects.toThrow("Unsupported PDF template");
    });

    it("should log context when projectId and jobRunId provided", async () => {
      await service.generatePDF({
        data: { X: [{ sub_category: "a", value: "1" }] },
        template: PDFTemplate.DISCOVERY_REPORT,
        context: { projectId: "proj-1", jobRunId: "job-2" },
      });
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringMatching(/projectId: proj-1/),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringMatching(/jobRunId: job-2/),
      );
    });
  });

  describe("constructor without LoggerFactory", () => {
    it("should construct with Nest fallback logger", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [PDFGeneratorService],
      }).compile();
      const svc = module.get<PDFGeneratorService>(PDFGeneratorService);
      const buf = await svc.generatePDF({
        data: { C: [{ sub_category: "s", value: "v" }] },
        template: PDFTemplate.DISCOVERY_REPORT,
      });
      expect(buf.length).toBeGreaterThan(4);
    });
  });
});
