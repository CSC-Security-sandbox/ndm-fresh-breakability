import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryService } from './discovery.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { ReportsEntity } from '../entities/reports.entity';
import * as fs from 'fs';
import * as path from 'path';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';

describe('DiscoveryService', () => {
  let service: DiscoveryService;
  let mockInventoryRepo;
  let mockReportsRepo;

  const mockInventoryData = [
    {
      fileServerPathId: 'server1',
      path: '/root/path1',
      parentPath: '/root',
      name: 'path1'
    }
  ];

  const mockReportData = [
    {
      jobRunId: 'job123',
      reportType: 'discovery',
      reportData: JSON.stringify([
        {
          category: 'Category1',
          sub_category: 'SubCat1',
          count_or_space: '100'
        }
      ]),
      createdAt: new Date()
    }
  ];

  beforeEach(async () => {
    mockInventoryRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      query: jest.fn()
    };

    mockReportsRepo = {
      find: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepo
        },
        {
          provide: getRepositoryToken(ReportsEntity),
          useValue: mockReportsRepo
        }
      ],
    }).compile();

    service = module.get<DiscoveryService>(DiscoveryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createReportFile', () => {
    beforeEach(() => {
      jest.spyOn(fs, 'existsSync').mockImplementation(() => true);
      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should create report file successfully', async () => {
      mockInventoryRepo.query.mockResolvedValue([]);
      mockReportsRepo.find.mockResolvedValue(mockReportData);

      const result = await service.createReportFile('job123', 'discovery');

      expect(result).toEqual({ message: 'Report generated successfully' });
      expect(mockInventoryRepo.query).toHaveBeenCalled();
      expect(mockReportsRepo.find).toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException when report generation fails', async () => {
      mockInventoryRepo.query.mockRejectedValue(new Error('Database error'));

      await expect(service.createReportFile('job123', 'discovery')).rejects.toThrow(
        InternalServerErrorException
      );
    });

    it('should create directory if it does not exist', async () => {
      jest.spyOn(fs, 'existsSync').mockImplementationOnce(() => false);
      mockInventoryRepo.query.mockResolvedValue([]);
      mockReportsRepo.find.mockResolvedValue(mockReportData);

      await service.createReportFile('job123', 'discovery');

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });

    it('should not create directory if it already exists', async () => {
      jest.spyOn(fs, 'existsSync').mockImplementationOnce(() => true);
      mockInventoryRepo.query.mockResolvedValue([]);
      mockReportsRepo.find.mockResolvedValue(mockReportData);

      await service.createReportFile('job123', 'discovery');

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should handle case when no report data is found', async () => {
      mockInventoryRepo.query.mockResolvedValue([]);
      mockReportsRepo.find.mockResolvedValue([]);

      const result = await service.createReportFile('job123', 'DISCOVERY');

      expect(result).toEqual({ message: 'Report generated successfully' });
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('getReportsAsZip', () => {
    beforeEach(() => {
      jest.spyOn(fs, 'existsSync').mockImplementation(() => true);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should throw NotFoundException when no files exist', async () => {
      jest.spyOn(fs, 'existsSync')
        .mockImplementationOnce(() => true)
        .mockImplementation(() => false);

      await expect(
        service.getReportsAsZip(['job123'], 'discovery')
      ).rejects.toThrow(NotFoundException);
    });

    it('should successfully create zip with multiple files', async () => {
      const mockZipBuffer = Buffer.from('mock zip content');
      jest.spyOn(service, 'createZipArchive').mockResolvedValue(mockZipBuffer);

      const result = await service.getReportsAsZip(['job123', 'job456'], 'discovery');

      expect(result).toEqual(mockZipBuffer);
      expect(service.createZipArchive).toHaveBeenCalled();
    });

    it('should throw NotFoundException when reports directory does not exist', async () => {
      jest.spyOn(fs, 'existsSync').mockImplementation(() => false);

      await expect(
        service.getReportsAsZip(['job123'], 'discovery')
      ).rejects.toThrow('Reports directory does not exist');
    });

    it('should log warning when specific file is not found', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      jest.spyOn(fs, 'existsSync')
        .mockImplementationOnce(() => true)
        .mockImplementationOnce(() => false);

      await expect(
        service.getReportsAsZip(['job123'], 'discovery')
      ).rejects.toThrow(NotFoundException);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getDiscoveryByFileServerId', () => {
    it('should return formatted discovery data', async () => {
      mockInventoryRepo.findOne.mockResolvedValue(mockInventoryData[0]);
      mockInventoryRepo.find.mockResolvedValue(mockInventoryData);

      const result = await service.getDiscoveryByFileServerId('server1');

      expect(result).toEqual([
        {
          root: path.basename(mockInventoryData[0].path),
          childs: mockInventoryData.map(item => ({ ...item, childs: [] }))
        }
      ]);
    });
  });

  describe('getDiscoveryByFileServerIdAndParentPath', () => {
    it('should return discovery data with empty childs', async () => {
      mockInventoryRepo.find.mockResolvedValue(mockInventoryData);

      const result = await service.getDiscoveryByFileServerIdAndParentPath(
        'server1',
        '/root'
      );

      expect(result).toEqual(
        mockInventoryData.map(item => ({ ...item, childs: [] }))
      );
    });
  });

  describe('createZipArchive', () => {
    it('should create zip archive successfully', async () => {
      const mockFilePaths = ['path1', 'path2'];
      const result = await service.createZipArchive(mockFilePaths);
      
      expect(result).toBeInstanceOf(Buffer);
    });

  });

  describe('formatAndWriteToFile', () => {
    it('should format and write data correctly', () => {
      const mockData = [
        {
          category: 'Category1',
          sub_category: 'SubCat1',
          count_or_space: '100'
        },
        {
          category: 'Category1',
          sub_category: 'SubCat2',
          count_or_space: '200'
        }
      ];
      const mockFilePath = 'test.txt';
      const writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      service.formatAndWriteToFile(mockData, mockFilePath);

      expect(writeFileSpy).toHaveBeenCalled();

      writeFileSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('getDataFromParentPath', () => {
    it('should return data for given fileServerId and parentPath', async () => {
      mockInventoryRepo.find.mockResolvedValue(mockInventoryData);

      const result = await service.getDataFromParentPath('server1', '/root');

      expect(result).toEqual(mockInventoryData);
      expect(mockInventoryRepo.find).toHaveBeenCalledWith({
        where: { fileServerPathId: 'server1', parentPath: '/root' }
      });
    });
  });

  describe('getReportsDirectory', () => {
    it('should return custom directory from environment variable', () => {
      process.env.REPORT_DOWNLOAD_LOCATION = '/custom/path';
      expect(service.getReportsDirectory).toBe('/custom/path');
    });

    it('should return default directory when environment variable is not set', () => {
      delete process.env.REPORT_DOWNLOAD_LOCATION;
      expect(service.getReportsDirectory).toBe('./reports');
    });
  });
});
