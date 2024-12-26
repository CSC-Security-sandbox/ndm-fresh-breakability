import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryService } from './discovery.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import * as fs from 'fs';
import { NotFoundException } from '@nestjs/common';

describe('DiscoveryService', () => {
  let discoveryService: DiscoveryService;
  let inventoryRepo: Repository<InventoryEntity>;
  let reportsRepo: Repository<ReportsEntity>;

  const mockInventoryRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    query: jest.fn(),
  };

  const mockReportsRepo = {
    find: jest.fn(),
  };

  jest.mock('archiver', () => ({
    zip: jest.fn(() => {
      const archive = {
        file: jest.fn(),
        on: jest.fn(),
        finalize: jest.fn(),
      };
      return archive;
    }),
  }));

  beforeEach(async () => {
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
      ],
    }).compile();

    discoveryService = module.get<DiscoveryService>(DiscoveryService);
    inventoryRepo = module.get<Repository<InventoryEntity>>(getRepositoryToken(InventoryEntity));
    reportsRepo = module.get<Repository<ReportsEntity>>(getRepositoryToken(ReportsEntity));
  });

  it('should be defined', () => {
    expect(discoveryService).toBeDefined();
  });

  describe('createReportFile', () => {
    it('should create a report file successfully', async () => {
      const mockJobRunId = '123';
      const mockReportType = 'discovery';
      const mockReportData = JSON.stringify([
        { category: 'Number of Files', sub_category: '<8KiB', count_or_space: 132 },
      ]);

      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'mkdirSync').mockImplementation();
      jest.spyOn(fs, 'writeFileSync').mockImplementation();
      jest.spyOn(inventoryRepo, 'query').mockResolvedValue([]);
      jest.spyOn(reportsRepo, 'find').mockResolvedValue([
        {
          id: '',
          createdAt: 'string',
          reportData: mockReportData,
        },
      ]);

      const result = await discoveryService.createReportFile(mockJobRunId, mockReportType);

      expect(result).toEqual({ message: 'Report generated successfully' });
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining(`${mockJobRunId}-${mockReportType.toLowerCase()}-report.txt`),
        expect.stringContaining('== Number of Files ==')
      );
    });

    it('should throw an error if report generation fails', async () => {
      jest.spyOn(inventoryRepo, 'query').mockRejectedValue(new Error('Database error'));

      await expect(discoveryService.createReportFile('123', 'discovery')).rejects.toThrow(
        'Failed to generate report for jobRunId: 123 and reportType: discovery'
      );
    });
  });

  describe('getReportsAsZip', () => {
    const mockReportsDirectory = './mockReports';
    const mockJobRunIds = ['123', '456'];
    const mockReportType = 'discovery';

    beforeEach(() => {
      jest.spyOn(discoveryService as any, 'getReportsDirectory', 'get').mockReturnValue(mockReportsDirectory);
    });

    it('should throw NotFoundException if the reports directory does not exist', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      await expect(discoveryService.getReportsAsZip(mockJobRunIds, mockReportType)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw NotFoundException if no files exist', async () => {
      jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => filePath === mockReportsDirectory);

      await expect(discoveryService.getReportsAsZip(mockJobRunIds, mockReportType)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  

  describe('getDiscoveryByFileServerId', () => {
    it('should return transformed data based on the file server ID', async () => {
      const mockData = { path: '/test/mount', file_server: 'server1' };
      mockInventoryRepo.findOne.mockResolvedValue(mockData);
      mockInventoryRepo.find.mockResolvedValue([{ fileName: 'file1' }]);

      const result = await discoveryService.getDiscoveryByFileServerId('server1');
      expect(result).toEqual([{ root: 'mount', childs: [{ fileName: 'file1', childs: [] }] }]);
      expect(mockInventoryRepo.findOne).toHaveBeenCalledWith({ where: { fileServerPathId: 'server1' } });
      expect(mockInventoryRepo.find).toHaveBeenCalledWith({ where: { fileServerPathId: 'server1', parentPath: '/test/mount' } });
    });
  });

  describe('getDiscoveryByFileServerIdAndParentPath', () => {
    it('should return data for the given fileServerId and parentPath', async () => {
      const mockData = [{ fileName: 'file1' }];
      mockInventoryRepo.find.mockResolvedValue(mockData);

      const result = await discoveryService.getDiscoveryByFileServerIdAndParentPath('server1', '/test/path');
      expect(result).toEqual([{ fileName: 'file1', childs: [] }]);
      expect(mockInventoryRepo.find).toHaveBeenCalledWith({ where: { fileServerPathId: 'server1', parentPath: '/test/path' } });
    });
  });

  describe('getDataFromParentPath', () => {
    it('should call find on the inventoryRepo with correct parameters', async () => {
      const mockData = [{ fileName: 'file1' }];
      mockInventoryRepo.find.mockResolvedValue(mockData);

      const result = await discoveryService.getDataFromParentPath('server1', '/test/path');
      expect(result).toEqual(mockData);
      expect(mockInventoryRepo.find).toHaveBeenCalledWith({ where: { fileServerPathId: 'server1', parentPath: '/test/path' } });
    });
  });
});
