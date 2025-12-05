import { Test, TestingModule } from '@nestjs/testing';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { Response } from 'express';
import { ReportType } from 'src/constants/enums';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

describe('PdfController', () => {
  let controller: PdfController;
  let service: PdfService;
  let mockLogger: any;

  const mockPdfService = {
    generatePdf: jest.fn(),
  };

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ["permission1", "permission2"],
            projects: ["project1"],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  beforeEach(async () => {
    mockLogger = {
      debug: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      verbose: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PdfController],
      providers: [{
        provide: PdfService,
        useValue: mockPdfService
      },
      {
        provide: JwtService,
        useValue: mockJwtService,
      },
      {
        provide: LoggerFactory,
        useValue: {
          create: jest.fn().mockReturnValue(mockLogger),
        },
      },
    ],
    }).compile();

    controller = module.get<PdfController>(PdfController);
    service = module.get<PdfService>(PdfService);
  });

  describe('generatePdf', () => {
    it('should generate a PDF and set the appropriate response headers', async () => {
      const jobRunId = '123';
      const reportType = ReportType.DISCOVERY;
      const pdfData = Buffer.from('mocked-pdf-data');
      const responseMock = {
        setHeader: jest.fn(),
        send: jest.fn(),
        status: jest.fn(),
      } as unknown as Response;
      jest.spyOn(service, 'generatePdf').mockResolvedValue(pdfData);

      await controller.generatePdf(responseMock, jobRunId, reportType);

      expect(mockLogger.log).toHaveBeenCalledWith(`Received PDF generation request for jobRunId: ${jobRunId}, reportType: ${reportType}`);
      expect(service.generatePdf).toHaveBeenCalledWith(jobRunId, reportType);
      expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename=report.pdf');
      expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Length', pdfData.length);
      expect(responseMock.send).toHaveBeenCalledWith(pdfData);
      expect(mockLogger.log).toHaveBeenCalledWith(`Successfully generated PDF for jobRunId: ${jobRunId}, reportType: ${reportType}`);
      expect(responseMock.status).not.toHaveBeenCalled();
    });

    it('should handle errors and return sanitized error response', async () => {
      const jobRunId = '123';
      const reportType = ReportType.DISCOVERY;
      const error = new Error('PDF generation failed');
      const responseMock = {
        setHeader: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as Response;
      
      jest.spyOn(service, 'generatePdf').mockRejectedValue(error);

      await controller.generatePdf(responseMock, jobRunId, reportType);

      expect(mockLogger.log).toHaveBeenCalledWith(`Received PDF generation request for jobRunId: ${jobRunId}, reportType: ${reportType}`);
      expect(service.generatePdf).toHaveBeenCalledWith(jobRunId, reportType);
      expect(mockLogger.error).toHaveBeenCalledWith(`PDF generation failed for jobRunId: ${jobRunId}, reportType: ${reportType}`, error);
      expect(responseMock.status).toHaveBeenCalledWith(500);
      expect(responseMock.send).toHaveBeenCalled();
    });

    it('should work with different report types', async () => {
      const jobRunId = '456';
      const reportType = ReportType.COC;
      const pdfData = Buffer.from('coc-pdf-data');
      const responseMock = {
        setHeader: jest.fn(),
        send: jest.fn(),
        status: jest.fn(),
      } as unknown as Response;
      
      jest.spyOn(service, 'generatePdf').mockResolvedValue(pdfData);

      await controller.generatePdf(responseMock, jobRunId, reportType);

      expect(mockLogger.log).toHaveBeenCalledWith(`Received PDF generation request for jobRunId: ${jobRunId}, reportType: ${reportType}`);
      expect(service.generatePdf).toHaveBeenCalledWith(jobRunId, reportType);
      expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename=report.pdf');
      expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Length', pdfData.length);
      expect(responseMock.send).toHaveBeenCalledWith(pdfData);
      expect(mockLogger.log).toHaveBeenCalledWith(`Successfully generated PDF for jobRunId: ${jobRunId}, reportType: ${reportType}`);
    });

    it('should handle service errors with custom status codes', async () => {
      const jobRunId = '789';
      const reportType = ReportType.DISCOVERY;
      const customError = { 
        message: 'Not Found', 
        status: 404,
        statusCode: 404 
      };
      const responseMock = {
        setHeader: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as Response;
      
      jest.spyOn(service, 'generatePdf').mockRejectedValue(customError);

      await controller.generatePdf(responseMock, jobRunId, reportType);

      expect(mockLogger.error).toHaveBeenCalledWith(`PDF generation failed for jobRunId: ${jobRunId}, reportType: ${reportType}`, customError);
      expect(responseMock.status).toHaveBeenCalledWith(404);
      expect(responseMock.send).toHaveBeenCalled();
    });
  });

  describe('constructor', () => {
    it('should create controller with LoggerFactory', () => {
      expect(controller).toBeDefined();
      expect(mockLogger.debug).toBeDefined();
      expect(mockLogger.log).toBeDefined();
      expect(mockLogger.error).toBeDefined();
    });

    it('should fallback to NestJS Logger when LoggerFactory is not provided', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [PdfController],
        providers: [{
          provide: PdfService,
          useValue: mockPdfService
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        }],
      }).compile();

      const controllerWithoutLoggerFactory = module.get<PdfController>(PdfController);
      expect(controllerWithoutLoggerFactory).toBeDefined();
    });
  });
});