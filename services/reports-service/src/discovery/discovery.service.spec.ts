// discovery.service.spec.ts

// Properly mock puppeteer for both ES default and CJS
const launchMock = jest.fn().mockResolvedValue({
  newPage: jest.fn().mockResolvedValue({
    setContent: jest.fn().mockResolvedValue(null),
    pdf: jest.fn().mockResolvedValue(Buffer.from('mock pdf')),
  }),
  close: jest.fn().mockResolvedValue(null),
});

jest.mock('puppeteer', () => ({
  __esModule: true,
  default: { launch: launchMock },
  launch: launchMock,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryService } from './discovery.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { ReportsEntity } from '../entities/reports.entity';
import * as fs from 'fs';
import * as path from 'path';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as validation from 'src/utils/utils';

describe('DiscoveryService', () => {
  let service: DiscoveryService;
  let mockInventoryRepo;
  let mockReportsRepo;

  const dummyRecord = {
    fileServerPathId: 'server1',
    path: '/root/path1',
    parentPath: '/root',
    name: 'path1',
  };

  const reportEntries = [
    { category: 'Cat1', sub_category: 'Sub1', value: '10' },
    { category: 'Cat1', sub_category: 'Sub2', value: '20' },
  ];

  beforeEach(async () => {
    mockInventoryRepo = { findOne: jest.fn(), find: jest.fn(), query: jest.fn() };
    mockReportsRepo = { find: jest.fn(), save: jest.fn() };

    const mockSanitizeHtml = jest.fn((str: string) => str);
    const mockEscapeHtml = jest.fn((str: string) => str);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepo,
        },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: mockReportsRepo,
        },
        {
          provide: 'SANITIZE_HTML',
          useValue: mockSanitizeHtml,
        },
        {
          provide: 'ESCAPE_HTML',
          useValue: mockEscapeHtml,
        },
        { provide: getRepositoryToken(InventoryEntity), useValue: mockInventoryRepo },
        { provide: getRepositoryToken(ReportsEntity), useValue: mockReportsRepo },
      ],
    }).compile();

    service = module.get<DiscoveryService>(DiscoveryService);

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
  });

  afterEach(() => jest.resetAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createReportFile', () => {
    const jobRunId = 'job123';
    const reportType = 'DISCOVERY';

    beforeEach(() => {
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      mockInventoryRepo.query.mockResolvedValue([]);
      mockReportsRepo.find.mockResolvedValue([
        { reportData: JSON.stringify(reportEntries), jobRunId, reportType, createdAt: new Date() },
      ]);
    });

    it('writes CSV and PDF and returns success message', async () => {
      jest.spyOn(service, 'generatePdfFromData').mockResolvedValue(Buffer.from('pdf'));
      const res = await service.createReportFile(jobRunId, reportType);
      expect(res).toEqual({ message: 'Report generated successfully' });
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
    });

    it('creates directory if missing', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false).mockReturnValueOnce(true);
      jest.spyOn(service, 'generatePdfFromData').mockResolvedValue(Buffer.from('pdf'));
      await service.createReportFile(jobRunId, reportType);
      expect(fs.mkdirSync).toHaveBeenCalledWith(service.getReportsDirectory, { recursive: true });
    });

    it('throws InternalServerErrorException on proc failure', async () => {
      mockInventoryRepo.query.mockRejectedValue(new Error('fail'));
      await expect(service.createReportFile(jobRunId, reportType)).rejects.toThrow(InternalServerErrorException);
    });

    it('throws if no report data', async () => {
      mockReportsRepo.find.mockResolvedValue([]);
      await expect(service.createReportFile(jobRunId, reportType)).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('generateHtmlTable', () => {
    it('builds correct HTML', () => {
      const html = service.generateHtmlTable(reportEntries);
      expect(html).toContain('<table>');
      expect(html).toContain('Cat1');
      expect(html).toContain('Sub2');
    });

    it('handles empty data', () => {
      expect(service.generateHtmlTable([])).toContain('Data Summary');
    });
  });

  describe('generatePdfFromData', () => {

    it('throws if launch fails', async () => {
      launchMock.mockRejectedValueOnce(new Error('bad'));
      await expect(service.generatePdfFromData(reportEntries)).rejects.toThrow('bad');
    });
  });

  describe('formatAndWriteToFile', () => {
    it('writes CSV with values', () => {
      const filePath = 'test.csv';
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      service.formatAndWriteToFile(reportEntries, filePath);
      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('10,20'));
    });

    it('throws on invalid path', () => {
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(false);
      expect(() => service.formatAndWriteToFile(reportEntries, 'bad')).toThrow();
    });
  });

  describe('createJobsPDFReportData', () => {
    it('executes repo.query and returns success', async () => {
      mockInventoryRepo.query.mockResolvedValue([]);
      const res = await service.createJobsPDFReportData('j1');
      expect(res).toEqual({ message: expect.stringContaining('jobs report') });
    });

    it('throws on failure', async () => {
      mockInventoryRepo.query.mockRejectedValue(new Error());
      await expect(service.createJobsPDFReportData('j1')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getDiscovery methods', () => {
    it('getDiscoveryByFileServerId returns nested structure', async () => {
      mockInventoryRepo.findOne.mockResolvedValue(dummyRecord);
      mockInventoryRepo.find.mockResolvedValue([dummyRecord]);
      const res = await service.getDiscoveryByFileServerId('server1');
      expect(res[0].root).toBe('path1');
    });

    it('getDiscoveryByFileServerIdAndParentPath returns childs array', async () => {
      mockInventoryRepo.find.mockResolvedValue([dummyRecord]);
      const res = await service.getDiscoveryByFileServerIdAndParentPath('server1','/root');
      expect(res[0].childs).toEqual([]);
    });

    it('getDataFromParentPath calls repo.find', async () => {
      mockInventoryRepo.find.mockResolvedValue([dummyRecord]);
      const res = await service.getDataFromParentPath('server1','/root');
      expect(res).toEqual([dummyRecord]);
    });
  });

  describe('getReportsAsZip', () => {
    const reportType = 'discovery';
    it('throws if directory missing', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
      await expect(service.getReportsAsZip(['j'], reportType)).rejects.toThrow(NotFoundException);
    });

    it('throws if no files found', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValueOnce(true).mockReturnValueOnce(false);
      await expect(service.getReportsAsZip(['j'], reportType)).rejects.toThrow(NotFoundException);
    });

    it('returns buffer when files exist', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(service, 'createZipArchive').mockResolvedValue(Buffer.from('z'));
      const buf = await service.getReportsAsZip(['j'], reportType);
      expect(buf.toString()).toBe('z');
    });
  });

  describe('generatePdfFromData', () => {
    it('should sanitize and escape HTML in report data', async () => {
      const maliciousData = [
        {
          category: '<script>alert("xss")</script>',
          sub_category: 'Total <b>Files</b>',
          value: '<img src=x onerror=alert(1)>'
        }
      ];

      const mockPdfBuffer = Buffer.from('mock pdf');
      const mockSetContent = jest.fn().mockResolvedValue(undefined);
      const mockPdf = jest.fn().mockResolvedValue(mockPdfBuffer);
      const mockNewPage = jest.fn().mockResolvedValue({
        setContent: mockSetContent,
        pdf: mockPdf,
      });
      const mockClose = jest.fn().mockResolvedValue(undefined);
      (puppeteer.launch as jest.Mock).mockResolvedValue({
        newPage: mockNewPage,
        close: mockClose,
      });

      await service.generatePdfFromData(maliciousData);

      const htmlArg = mockSetContent.mock.calls[0][0];
      expect(htmlArg).not.toContain('<script>');
      expect(htmlArg).not.toContain('<img');
    });
  });
});
