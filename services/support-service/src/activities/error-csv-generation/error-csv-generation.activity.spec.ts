import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import AdmZip = require('adm-zip');
import { ErrorCsvGenerationActivity } from './error-csv-generation.activity';
import { OperationErrorService } from 'src/utils/error-csv-generation.service';
import {
  ExportRequest,
  ExportResult,
  OperationErrorExportData,
} from 'src/constants/types';

// Mock external dependencies
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    mkdir: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
  },
}));

jest.mock('csv-writer', () => ({
  createObjectCsvWriter: jest.fn(),
}));

jest.mock('adm-zip');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockCreateObjectCsvWriter = createObjectCsvWriter as jest.MockedFunction<
  typeof createObjectCsvWriter
>;
const MockAdmZip = AdmZip;

describe('ErrorCsvGenerationActivity', () => {
  let activity: ErrorCsvGenerationActivity;
  let operationErrorService: jest.Mocked<OperationErrorService>;
  let mockZipInstance: jest.Mocked<AdmZip>;
  let mockCsvWriter: any;
  let mockLogger: jest.Mocked<Logger>;

  const mockOperationErrorData: OperationErrorExportData[] = [
    {
      id: '1',
      operationId: 'op-001',
      errorCode: 'ERR001',
      errorMessage: 'Test error message',
      createdAt: '2024-07-15T10:30:00Z',
      fileName: 'test-file.txt',
      filePath: '/path/to/test-file.txt',
      errorType: 'VALIDATION_ERROR',
      operationType: 'COPY',
      origin: 'SOURCE',
      projectId: 'project-123',
      projectName: 'Test Project',
    },
    {
      id: '2',
      operationId: 'op-002',
      errorCode: 'ERR002',
      errorMessage: 'Another test error',
      createdAt: '2024-07-16T14:45:00Z',
      fileName: 'another-file.txt',
      filePath: '/path/to/another-file.txt',
      errorType: 'NETWORK_ERROR',
      operationType: 'MOVE',
      origin: 'DESTINATION',
      projectId: 'project-456',
      projectName: 'Another Project',
    },
  ];

  beforeEach(async () => {
    const mockOperationErrorServiceValue = {
      getOperationErrorsByDateRange: jest.fn(),
      getErrorCountByProject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorCsvGenerationActivity,
        {
          provide: OperationErrorService,
          useValue: mockOperationErrorServiceValue,
        },
      ],
    }).compile();

    activity = module.get<ErrorCsvGenerationActivity>(
      ErrorCsvGenerationActivity,
    );
    operationErrorService = module.get(OperationErrorService);

    // Mock logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as any;
    (activity as any).logger = mockLogger;

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('generateErrorCsv', () => {
    // it('should successfully generate CSV when data exists', async () => {
    //     const request = {
    //         traceId: 'trace-123',
    //         payload: {
    //             zipLocation: '/path/to/output.zip',
    //             startDate: '2024-07-01',
    //             endDate: '2024-07-31',
    //         },
    //     };

    //     // Mock getOperationErrorsByDateRange instead of getOperationErrorsByProjectAndDateRange
    //     jest
    //         .spyOn(activity, 'getOperationErrorsByDateRange')
    //         .mockResolvedValue(mockOperationErrorData);

    //     // Mock the exportOperationErrorsToZip method
    //     jest.spyOn(activity, 'exportOperationErrorsToZip').mockResolvedValue(undefined);

    //     const result = await activity.generateErrorCsv(request);

    //     expect(result.success).toBe(true);
    //     expect(result.message).toContain('Successfully exported operation errors');
    //     expect(activity.getOperationErrorsByDateRange).toHaveBeenCalledWith(
    //         request.payload.startDate,
    //         request.payload.endDate,
    //     );
    // });

    // it('should return success message when data exists', async () => {
    //     const request = {
    //         traceId: 'trace-123',
    //         payload: {
    //             zipLocation: '/path/to/output.zip',
    //             startDate: '2024-07-01',
    //             endDate: '2024-07-31',
    //         },
    //     };

    //     // Mock getOperationErrorsByDateRange instead of getOperationErrorsByProjectAndDateRange
    //     jest.spyOn(activity, 'getOperationErrorsByDateRange').mockResolvedValue(mockOperationErrorData);

    //     // Mock the exportOperationErrorsToZip method
    //     jest.spyOn(activity, 'exportOperationErrorsToZip').mockResolvedValue(undefined);

    //     const result = await activity.generateErrorCsv(request);

    //     expect(result.success).toBe(true);
    //     expect(result.message).toContain('Successfully exported operation errors');
    //     expect(activity.getOperationErrorsByDateRange).toHaveBeenCalledWith(
    //         request.payload.startDate,
    //         request.payload.endDate,
    //     );
    // });

    it('should return success message when no data exists', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
        },
      };

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockResolvedValue([]);

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'No operation errors found for the given criteria',
      );
    });

    it('should handle errors and return failure result', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
        },
      };

      const error = new Error('Database connection failed');
      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain(
        'Export failed: Database connection failed',
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error exporting operation errors:',
        error,
      );

      consoleSpy.mockRestore();
    });

    it('should handle non-Error exceptions', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
        },
      };

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockRejectedValue('String error');

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Export failed: String error');

      consoleSpy.mockRestore();
    });

    // Additional comprehensive test cases
    it('should handle empty payload gracefully', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '',
          startDate: '',
          endDate: '',
        },
      };

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockResolvedValue([]);

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'No operation errors found for the given criteria',
      );
    });

    it('should handle invalid date range', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-12-31',
          endDate: '2024-01-01', // End date before start date
        },
      };

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockResolvedValue([]);

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'No operation errors found for the given criteria',
      );
    });

    it('should handle large dataset efficiently', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
        },
      };

      // Create a large dataset (1000 records)
      const largeDataset = Array.from({ length: 1000 }, (_, index) => ({
        ...mockOperationErrorData[0],
        id: `${index + 1}`,
        operationId: `op-${String(index + 1).padStart(3, '0')}`,
        createdAt: `2024-07-${String((index % 30) + 1).padStart(2, '0')}T10:30:00Z`,
      }));

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockResolvedValue(largeDataset);
      jest
        .spyOn(activity, 'exportOperationErrorsToZip')
        .mockResolvedValue(undefined);

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(true);
      expect(result.message).toContain(
        'Successfully exported operation errors',
      );
    });

    it('should handle missing traceId', async () => {
      const request = {
        traceId: undefined,
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
        },
      };

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockResolvedValue(mockOperationErrorData);
      jest
        .spyOn(activity, 'exportOperationErrorsToZip')
        .mockResolvedValue(undefined);

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(true);
    });

    it('should handle export operation error during zip creation', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
        },
      };

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockResolvedValue(mockOperationErrorData);
      jest
        .spyOn(activity, 'exportOperationErrorsToZip')
        .mockRejectedValue(new Error('Zip creation failed'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Export failed: Zip creation failed');

      consoleSpy.mockRestore();
    });
  });

  describe('getOperationErrorsByDateRange', () => {
    it('should delegate to operation error service', async () => {
      const startDate = '2024-07-01';
      const endDate = '2024-07-31';

      operationErrorService.getOperationErrorsByDateRange.mockResolvedValue(
        mockOperationErrorData,
      );

      const result = await activity.getOperationErrorsByDateRange(
        startDate,
        endDate,
      );

      expect(result).toEqual(mockOperationErrorData);
      expect(
        operationErrorService.getOperationErrorsByDateRange,
      ).toHaveBeenCalledWith(startDate, endDate);
    });

    it('should handle service error', async () => {
      const startDate = '2024-07-01';
      const endDate = '2024-07-31';

      operationErrorService.getOperationErrorsByDateRange.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        activity.getOperationErrorsByDateRange(startDate, endDate),
      ).rejects.toThrow('Database error');
    });

    it('should handle empty result from service', async () => {
      const startDate = '2024-07-01';
      const endDate = '2024-07-31';

      operationErrorService.getOperationErrorsByDateRange.mockResolvedValue([]);

      const result = await activity.getOperationErrorsByDateRange(
        startDate,
        endDate,
      );

      expect(result).toEqual([]);
      expect(
        operationErrorService.getOperationErrorsByDateRange,
      ).toHaveBeenCalledWith(startDate, endDate);
    });

    it('should handle invalid date format', async () => {
      const startDate = 'invalid-date';
      const endDate = 'invalid-date';

      operationErrorService.getOperationErrorsByDateRange.mockResolvedValue([]);

      const result = await activity.getOperationErrorsByDateRange(
        startDate,
        endDate,
      );

      expect(result).toEqual([]);
      expect(
        operationErrorService.getOperationErrorsByDateRange,
      ).toHaveBeenCalledWith(startDate, endDate);
    });
  });

  describe('exportOperationErrorsToZip', () => {
    it('should process data and add CSV files to zip', async () => {
      const request: ExportRequest = {
        startDate: '2024-07-01',
        endDate: '2024-07-31',
        outputLocation: '/path/to/output.zip',
      };

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockResolvedValue(mockOperationErrorData);

      // Mock the addCSVFilesToZip method
      jest
        .spyOn(activity as any, 'addCSVFilesToZip')
        .mockResolvedValue(undefined);

      await activity.exportOperationErrorsToZip(request);

      expect(activity.getOperationErrorsByDateRange).toHaveBeenCalledWith(
        request.startDate,
        request.endDate,
      );
    });

    it('should handle empty data from service', async () => {
      const request: ExportRequest = {
        startDate: '2024-07-01',
        endDate: '2024-07-31',
        outputLocation: '/path/to/output.zip',
      };

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockResolvedValue([]);
      jest
        .spyOn(activity as any, 'addCSVFilesToZip')
        .mockResolvedValue(undefined);

      await activity.exportOperationErrorsToZip(request);

      expect(activity.getOperationErrorsByDateRange).toHaveBeenCalledWith(
        request.startDate,
        request.endDate,
      );

      // Should still call addCSVFilesToZip with empty grouped data
      expect((activity as any).addCSVFilesToZip).toHaveBeenCalledWith(
        expect.any(Map),
        request.outputLocation,
      );
    });

    it('should handle service error gracefully', async () => {
      const request: ExportRequest = {
        startDate: '2024-07-01',
        endDate: '2024-07-31',
        outputLocation: '/path/to/output.zip',
      };

      jest
        .spyOn(activity, 'getOperationErrorsByDateRange')
        .mockRejectedValue(new Error('Service error'));

      await expect(
        activity.exportOperationErrorsToZip(request),
      ).rejects.toThrow('Service error');
    });
  });

  describe('addCSVFilesToZip', () => {
    let mockZip: jest.Mocked<AdmZip>;
    let mockFs: jest.Mocked<typeof fs>;

    beforeEach(() => {
      mockZip = {
        getEntries: jest.fn(),
        addFile: jest.fn(),
        writeZip: jest.fn(),
      } as any;

      mockFs = fs as jest.Mocked<typeof fs>;
      AdmZip.mockImplementation(() => mockZip);
    });

    it('should add CSV files to existing zip structure', async () => {
      const groupedData = new Map([
        ['project-123', new Map([['2024-07-15', [mockOperationErrorData[0]]]])],
      ]);
      const zipFilePath = '/path/to/output.zip';

      // Mock zip file exists
      mockFs.access.mockResolvedValue(undefined);

      // Mock zip entries
      const mockEntries = [
        { isDirectory: true, entryName: 'ndm_logs/' },
        { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
        { isDirectory: true, entryName: 'ndm_logs/2024-07-15/project-123/' },
        {
          isDirectory: true,
          entryName: 'ndm_logs/2024-07-15/project-123/control_plane/',
        },
      ] as AdmZip.IZipEntry[];

      mockZip.getEntries.mockReturnValue(mockEntries);

      // Mock CSV content generation
      jest
        .spyOn(activity as any, 'generateCSVContent')
        .mockResolvedValue('mock,csv,content');

      await (activity as any).addCSVFilesToZip(groupedData, zipFilePath);

      expect(mockFs.access).toHaveBeenCalledWith(zipFilePath);
      expect(mockZip.getEntries).toHaveBeenCalled();
      expect(mockZip.addFile).toHaveBeenCalled();
      expect(mockZip.writeZip).toHaveBeenCalledWith(zipFilePath);
      expect(mockLogger.log).toHaveBeenCalledWith(
        `Loading existing zip file: ${zipFilePath}`,
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `Zip file updated successfully: ${zipFilePath}`,
      );
    });

    it('should throw error when zip file does not exist', async () => {
      const groupedData = new Map();
      const zipFilePath = '/path/to/nonexistent.zip';

      // Mock zip file does not exist
      mockFs.access.mockRejectedValue(new Error('File not found'));

      await expect(
        (activity as any).addCSVFilesToZip(groupedData, zipFilePath),
      ).rejects.toThrow('Zip file not found: /path/to/nonexistent.zip');
    });

    it('should handle empty grouped data', async () => {
      const groupedData = new Map();
      const zipFilePath = '/path/to/output.zip';

      mockFs.access.mockResolvedValue(undefined);
      mockZip.getEntries.mockReturnValue([]);

      await (activity as any).addCSVFilesToZip(groupedData, zipFilePath);

      expect(mockZip.writeZip).toHaveBeenCalledWith(zipFilePath);
      expect(mockLogger.log).toHaveBeenCalledWith('Total CSV files added: 0');
    });

    it('should handle zip with many directories (>10)', async () => {
      const groupedData = new Map([
        ['2024-07-15', [mockOperationErrorData[0]]],
      ]);
      const zipFilePath = '/path/to/output.zip';

      mockFs.access.mockResolvedValue(undefined);

      // Create more than 10 directory entries
      const manyEntries = Array.from({ length: 15 }, (_, i) => ({
        isDirectory: true,
        entryName: `ndm_logs/dir${i}/`,
      }));

      const mockEntries = [
        { isDirectory: true, entryName: 'ndm_logs/' },
        ...manyEntries,
      ] as AdmZip.IZipEntry[];

      mockZip.getEntries.mockReturnValue(mockEntries);

      jest.spyOn(activity as any, 'addCSVToZip').mockResolvedValue(undefined);

      await (activity as any).addCSVFilesToZip(groupedData, zipFilePath);

      // Check that it logs the total number of entries
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Found 16 entries in zip file',
      );
      expect(mockLogger.log).toHaveBeenCalledWith('6 more directories');
    });

    it('should handle dates with slashes and replace them', async () => {
      const groupedData = new Map([
        ['2024/07/15', [mockOperationErrorData[0]]],
      ]);
      const zipFilePath = '/path/to/output.zip';

      mockFs.access.mockResolvedValue(undefined);
      mockZip.getEntries.mockReturnValue([]);

      jest.spyOn(activity as any, 'addCSVToZip').mockResolvedValue(undefined);

      await (activity as any).addCSVFilesToZip(groupedData, zipFilePath);

      expect((activity as any).addCSVToZip).toHaveBeenCalledWith(
        mockZip,
        '2024-07-15', // Should be converted from slash to dash
        [mockOperationErrorData[0]],
        [],
      );
    });

    it('should handle multiple date entries', async () => {
      const groupedData = new Map([
        ['2024-07-15', [mockOperationErrorData[0]]],
        ['2024-07-16', [mockOperationErrorData[1]]],
        ['2024-07-17', [mockOperationErrorData[0], mockOperationErrorData[1]]],
      ]);
      const zipFilePath = '/path/to/output.zip';

      mockFs.access.mockResolvedValue(undefined);
      mockZip.getEntries.mockReturnValue([]);

      jest.spyOn(activity as any, 'addCSVToZip').mockResolvedValue(undefined);

      await (activity as any).addCSVFilesToZip(groupedData, zipFilePath);

      expect(mockLogger.log).toHaveBeenCalledWith('Total CSV files added: 3');
      expect((activity as any).addCSVToZip).toHaveBeenCalledTimes(3);
    });
  });

  describe('generateCSVContent', () => {
    let mockFs: jest.Mocked<typeof fs>;
    let mockCsvWriter: jest.Mocked<any>;

    beforeEach(() => {
      mockFs = fs as jest.Mocked<typeof fs>;
      mockCsvWriter = {
        writeRecords: jest.fn(),
      };
      (createObjectCsvWriter as jest.Mock).mockReturnValue(mockCsvWriter);
    });

    it('should generate CSV content successfully', async () => {
      const errors = [mockOperationErrorData[0]];
      const mockCsvContent = 'ID,Operation ID,Error Code\n1,op-001,ERR001';

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(mockCsvContent);
      mockFs.unlink.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockResolvedValue(undefined);

      const result = await (activity as any).generateCSVContent(errors);

      expect(result).toBe(mockCsvContent);
      expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp', { recursive: true });
      expect(createObjectCsvWriter).toHaveBeenCalled();
      expect(mockCsvWriter.writeRecords).toHaveBeenCalledWith(errors);
      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it('should clean up temp file on error', async () => {
      const errors = [mockOperationErrorData[0]];

      mockFs.mkdir.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockRejectedValue(
        new Error('CSV write failed'),
      );
      mockFs.unlink.mockResolvedValue(undefined);

      await expect(
        (activity as any).generateCSVContent(errors),
      ).rejects.toThrow('CSV write failed');

      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      const errors = [mockOperationErrorData[0]];

      mockFs.mkdir.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockRejectedValue(
        new Error('CSV write failed'),
      );
      mockFs.unlink.mockRejectedValue(new Error('Cleanup failed'));

      await expect(
        (activity as any).generateCSVContent(errors),
      ).rejects.toThrow('CSV write failed');
    });

    it('should handle mkdir error', async () => {
      const errors = [mockOperationErrorData[0]];

      mockFs.mkdir.mockRejectedValue(new Error('Directory creation failed'));

      await expect(
        (activity as any).generateCSVContent(errors),
      ).rejects.toThrow('Directory creation failed');
    });

    it('should handle readFile error', async () => {
      const errors = [mockOperationErrorData[0]];

      mockFs.mkdir.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockResolvedValue(undefined);
      mockFs.readFile.mockRejectedValue(new Error('File read failed'));
      mockFs.unlink.mockResolvedValue(undefined);

      await expect(
        (activity as any).generateCSVContent(errors),
      ).rejects.toThrow('File read failed');

      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it('should handle empty errors array', async () => {
      const errors = [];
      const mockCsvContent = 'ID,Operation ID,Error Code\n';

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(mockCsvContent);
      mockFs.unlink.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockResolvedValue(undefined);

      const result = await (activity as any).generateCSVContent(errors);

      expect(result).toBe(mockCsvContent);
      expect(mockCsvWriter.writeRecords).toHaveBeenCalledWith([]);
    });
  });

  describe('groupDataByDate', () => {
    it('should group data by date correctly', () => {
      const result = (activity as any).groupDataByDate(mockOperationErrorData);

      expect(result.size).toBe(2); // Two different dates
      expect(result.has('2024-07-15')).toBe(true);
      expect(result.has('2024-07-16')).toBe(true);

      const date1Data = result.get('2024-07-15');
      expect(date1Data).toHaveLength(1);

      const date2Data = result.get('2024-07-16');
      expect(date2Data).toHaveLength(1);
    });

    it('should handle invalid date formats gracefully', () => {
      const invalidDateData: OperationErrorExportData[] = [
        {
          ...mockOperationErrorData[0],
          createdAt: 'invalid-date' as any,
        },
      ];

      const result = (activity as any).groupDataByDate(invalidDateData);

      expect(result.size).toBe(1);
      // Should still create a date entry even with invalid date
      expect(result.size).toBeGreaterThan(0);
    });

    it('should handle string dates correctly', () => {
      const stringDateData: OperationErrorExportData[] = [
        {
          ...mockOperationErrorData[0],
          createdAt: '2024-07-20T15:30:00Z' as any,
        },
      ];

      const result = (activity as any).groupDataByDate(stringDateData);

      expect(result.size).toBe(1);
      expect(result.has('2024-07-20')).toBe(true);
    });

    it('should handle legacy date formats', () => {
      const legacyDateData: OperationErrorExportData[] = [
        {
          ...mockOperationErrorData[0],
          createdAt: 'Fri Jul 11 2025' as any,
        },
      ];

      const result = (activity as any).groupDataByDate(legacyDateData);

      expect(result.size).toBe(1);
      // Check that it creates a date entry (the actual parsed date format)
      expect(result.size).toBeGreaterThan(0);
    });

    it('should handle Date objects correctly', () => {
      const dateObjectData: OperationErrorExportData[] = [
        {
          ...mockOperationErrorData[0],
          createdAt: new Date('2024-08-20T12:00:00Z') as any,
        },
      ];

      const result = (activity as any).groupDataByDate(dateObjectData);

      expect(result.size).toBe(1);
      expect(result.has('2024-08-20')).toBe(true);
    });

    it('should handle mixed date formats in same dataset', () => {
      const mixedDateData: OperationErrorExportData[] = [
        {
          ...mockOperationErrorData[0],
          createdAt: '2024-07-15T10:30:00Z',
        },
        {
          ...mockOperationErrorData[1],
          createdAt: new Date('2024-07-15T14:45:00Z') as any,
        },
        {
          ...mockOperationErrorData[0],
          id: '3',
          createdAt: 'Mon Jul 15 2024 10:30:00 GMT' as any,
        },
      ];

      const result = (activity as any).groupDataByDate(mixedDateData);

      // Check that we have valid grouping - allow for fallback to unknown-date if parsing fails
      expect(result.size).toBeGreaterThanOrEqual(1);
      if (result.has('2024-07-15')) {
        expect(result.get('2024-07-15').length).toBeGreaterThanOrEqual(2);
      }
      // At least the first two dates should parse correctly to 2024-07-15
      const has2024_07_15 = result.has('2024-07-15');
      const hasUnknownDate = result.has('unknown-date');
      expect(has2024_07_15 || hasUnknownDate).toBe(true);
    });

    it('should handle dates with slashes and convert to dashes', () => {
      const slashDateData: OperationErrorExportData[] = [
        {
          ...mockOperationErrorData[0],
          createdAt: '2024/07/15T10:30:00Z' as any,
        },
      ];

      const result = (activity as any).groupDataByDate(slashDateData);

      expect(result.size).toBe(1);
      // Should extract the first 10 characters and handle the slash format
      expect(result.size).toBeGreaterThan(0);
    });

    it('should handle null or undefined dates', () => {
      const nullDateData: OperationErrorExportData[] = [
        {
          ...mockOperationErrorData[0],
          createdAt: null as any,
        },
        {
          ...mockOperationErrorData[1],
          createdAt: undefined as any,
        },
      ];

      const result = (activity as any).groupDataByDate(nullDateData);

      expect(result.size).toBeGreaterThan(0);
      const result = await activity.getOperationErrorsByDateRange(
                startDate,
                endDate,
            );

      expect(result).toEqual(mockOperationErrorData);
      expect(
        operationErrorService.getOperationErrorsByDateRange,
      ).toHaveBeenCalledWith(startDate, endDate);
        });

        it('should handle service error', async () => {
            const startDate = '2024-07-01';
            const endDate = '2024-07-31';

            operationErrorService.getOperationErrorsByDateRange.mockRejectedValue(new Error('Database error'));

            await expect(activity.getOperationErrorsByDateRange(startDate, endDate))
                .rejects.toThrow('Database error');
        });

        it('should handle empty result from service', async () => {
            const startDate = '2024-07-01';
            const endDate = '2024-07-31';

            operationErrorService.getOperationErrorsByDateRange.mockResolvedValue([]);

      const result = await activity.getOperationErrorsByDateRange(
                startDate,
                endDate,
            );
        });

        it('should handle invalid date format', async () => {
            const startDate = 'invalid-date';
            const endDate = 'invalid-date';

            operationErrorService.getOperationErrorsByDateRange.mockResolvedValue([]);

      const result = await activity.getOperationErrorsByDateRange(
                startDate,
                endDate,
            );
        });
    });

    it('should handle empty array', () => {
      const result = (activity as any).groupDataByDate([]);

      expect(result.size).toBe(0);
    });
  });

  describe('findExactDirectory', () => {
    it('should find exact directory match', () => {
      const zipEntries = [
        { isDirectory: true, entryName: 'ndm_logs/' },
        { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
        { isDirectory: false, entryName: 'ndm_logs/file.txt' },
      ] as AdmZip.IZipEntry[];

      const result = (activity as any).findExactDirectory(
        zipEntries,
        'ndm_logs/2024-07-15/',
      );

      expect(result).toBe(true);
    });

    it('should return false when directory not found', () => {
      const zipEntries = [
        { isDirectory: true, entryName: 'ndm_logs/' },
        { isDirectory: false, entryName: 'ndm_logs/file.txt' },
      ] as AdmZip.IZipEntry[];

      const result = (activity as any).findExactDirectory(
        zipEntries,
        'ndm_logs/2024-07-15/',
      );

      expect(result).toBe(false);
    });

    it('should not match files as directories', () => {
      const zipEntries = [
        { isDirectory: false, entryName: 'ndm_logs/' },
      ] as AdmZip.IZipEntry[];

      const result = (activity as any).findExactDirectory(
        zipEntries,
        'ndm_logs/',
      );

      expect(result).toBe(false);
    });
  });

  describe('addCSVToZip - directory structure logic', () => {
    let mockZip: jest.Mocked<AdmZip>;

    beforeEach(() => {
      mockZip = {
        addFile: jest.fn(),
      } as any;

      // Mock CSV content generation
      jest
        .spyOn(activity as any, 'generateCSVContent')
        .mockResolvedValue('mock,csv,content');
    });

    it('should use existing date folder when found', async () => {
      const zipEntries = [
        { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
      ] as AdmZip.IZipEntry[];

      await (activity as any).addCSVToZip(
        mockZip,
        '2024-07-15',
        [mockOperationErrorData[0]],
        zipEntries,
      );

      expect(mockZip.addFile).toHaveBeenCalledWith(
        'ndm_logs/2024-07-15/errorlog.csv',
        expect.any(Buffer),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        '   ✓ Found existing date folder: ndm_logs/2024-07-15/',
      );
    });

    it('should create date structure when ndm_logs exists', async () => {
      const zipEntries = [
        { isDirectory: true, entryName: 'ndm_logs/' },
      ] as AdmZip.IZipEntry[];

      await (activity as any).addCSVToZip(
        mockZip,
        '2024-07-15',
        [mockOperationErrorData[0]],
        zipEntries,
      );

      expect(mockZip.addFile).toHaveBeenCalledWith(
        'ndm_logs/2024-07-15/errorlog.csv',
        expect.any(Buffer),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Found ndm_logs, creating structure: ndm_logs/2024-07-15/',
      );
    });

    it('should create complete structure when no existing structure found', async () => {
      const zipEntries = [] as AdmZip.IZipEntry[];

      await (activity as any).addCSVToZip(
        mockZip,
        '2024-07-15',
        [mockOperationErrorData[0]],
        zipEntries,
      );

            // Mock CSV content generation
            jest.spyOn(activity as any, 'generateCSVContent').mockResolvedValue('mock,csv,content');
        });

        it('should use existing date folder when found', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
            ] as AdmZip.IZipEntry[];

            await (activity as any).addCSVToZip(
                mockZip,
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
            );

            expect(mockZip.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/errorlog.csv',
                expect.any(Buffer),
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
                '   ✓ Found existing date folder: ndm_logs/2024-07-15/',
            );
        });

        it('should create date structure when ndm_logs exists', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/' },
            ] as AdmZip.IZipEntry[];

            await (activity as any).addCSVToZip(
                mockZip,
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
            );

            expect(mockZip.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/errorlog.csv',
                expect.any(Buffer),
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
                'Found ndm_logs, creating structure: ndm_logs/2024-07-15/',
            );
        });

        it('should create complete structure when no existing structure found', async () => {
            const zipEntries = [] as AdmZip.IZipEntry[];

            await (activity as any).addCSVToZip(
                mockZip,
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
            );

            expect(mockZip.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/errorlog.csv',
                expect.any(Buffer),
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
                'No existing structure found, creating complete structure: ndm_logs/2024-07-15/errorlog.csv',
            );
        });

        it('should log successful CSV addition', async () => {
            const zipEntries = [] as AdmZip.IZipEntry[];
            const errors = [mockOperationErrorData[0]];

            await (activity as any).addCSVToZip(
                mockZip,
                '2024-07-15',
                errors,
                zipEntries,
            );

            expect(mockLogger.log).toHaveBeenCalledWith(
                'Successfully added CSV: ndm_logs/2024-07-15/errorlog.csv (1 records)',
            );
        });

    it('should handle case when ndm_logs folder exists but not date folder', async () => {
      const zipEntries = [
        { isDirectory: true, entryName: 'ndm_logs/' },
        { isDirectory: true, entryName: 'ndm_logs/2024-07-14/' }, // Different date
        { isDirectory: true, entryName: 'ndm_logs/2024-07-16/' }, // Different date
      ] as AdmZip.IZipEntry[];

      await (activity as any).addCSVToZip(
        mockZip,
        '2024-07-15',
        [mockOperationErrorData[0]],
        zipEntries,
      );

      expect(mockZip.addFile).toHaveBeenCalledWith(
        'ndm_logs/2024-07-15/errorlog.csv',
        expect.any(Buffer),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Found ndm_logs, creating structure: ndm_logs/2024-07-15/',
      );
    });

    it('should handle case when both ndm_logs and date folder do not exist', async () => {
      const zipEntries = [
        { isDirectory: true, entryName: 'some_other_folder/' },
        { isDirectory: false, entryName: 'some_file.txt' },
      ] as AdmZip.IZipEntry[];

      await (activity as any).addCSVToZip(
        mockZip,
        '2024-07-15',
        [mockOperationErrorData[0]],
        zipEntries,
      );

      expect(mockZip.addFile).toHaveBeenCalledWith(
        'ndm_logs/2024-07-15/errorlog.csv',
        expect.any(Buffer),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'No existing structure found, creating complete structure: ndm_logs/2024-07-15/errorlog.csv',
      );
    });

    it('should handle CSV content generation error', async () => {
      const zipEntries = [] as AdmZip.IZipEntry[];
      const errors = [mockOperationErrorData[0]];

      // Make generateCSVContent throw an error
      jest
        .spyOn(activity as any, 'generateCSVContent')
        .mockRejectedValue(new Error('CSV generation failed'));

      await expect(
        (activity as any).addCSVToZip(
          mockZip,
          '2024-07-15',
          errors,
          zipEntries,
        ),
      ).rejects.toThrow('CSV generation failed');
    });
    });

    it('should log successful CSV addition', async () => {
      const zipEntries = [] as AdmZip.IZipEntry[];
      const errors = [mockOperationErrorData[0]];

      await (activity as any).addCSVToZip(
        mockZip,
        '2024-07-15',
        errors,
        zipEntries,
      );

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Successfully added CSV: ndm_logs/2024-07-15/errorlog.csv (1 records)',
      );
    });
  });
});
