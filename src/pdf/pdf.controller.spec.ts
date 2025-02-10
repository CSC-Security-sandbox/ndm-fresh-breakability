import { Test, TestingModule } from '@nestjs/testing';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { Response } from 'express';
import { ReportType } from 'src/constants/enums';

describe('PdfController', () => {
  let controller: PdfController;
  let service: PdfService;

  const mockPdfService = {
    generatePdf: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PdfController],
      providers: [{
        provide: PdfService,
        useValue: mockPdfService
      }],
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


      expect(service.generatePdf).toHaveBeenCalledWith(jobRunId, reportType);
      expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename=report.pdf');
      expect(responseMock.setHeader).toHaveBeenCalledWith('Content-Length', pdfData.length);
      expect(responseMock.send).toHaveBeenCalledWith(pdfData);
      expect(responseMock.status).not.toHaveBeenCalled();
    });
  });
});