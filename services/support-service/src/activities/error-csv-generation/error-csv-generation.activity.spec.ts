import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import * as AdmZip from 'adm-zip';
import { ErrorCsvGenerationActivity } from './error-csv-generation.activity';
import { OperationErrorService } from 'src/utils/error-csv-generation.service';
import { ExportRequest, OperationErrorExportData } from 'src/constants/types';
import * as errorCsvGenerationUtil from 'src/utils/error-csv-generation.util';

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

jest.mock('src/utils/error-csv-generation.util', () => ({
  getProjectIds: jest.fn(),
  groupDataByProjectAndDate: jest.fn(),
  formatDateTime: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockCreateObjectCsvWriter = createObjectCsvWriter as jest.MockedFunction<
  typeof createObjectCsvWriter
>;
const MockAdmZip = AdmZip as jest.MockedClass<typeof AdmZip>;
const mockErrorCsvGenerationUtil = errorCsvGenerationUtil as jest.Mocked<
  typeof errorCsvGenerationUtil
>;

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
      errorType: 'NETWORK_ERROR',
      operationType: 'MOVE',
      origin: 'DESTINATION',
      projectId: 'project-456',
      projectName: 'Another Project',
    },
  ];

  const mockOperationErrorServiceValue = {
    getOperationErrorsByProjectAndDateRange: jest.fn(),
  };

  beforeEach(async () => {
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

    // Mock zip instance
    mockZipInstance = {
      getEntries: jest.fn(),
      addFile: jest.fn(),
      writeZip: jest.fn(),
    } as any;

    // Mock CSV writer
    mockCsvWriter = {
      writeRecords: jest.fn(),
    };
    mockCreateObjectCsvWriter.mockReturnValue(mockCsvWriter);

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default util mocks
    mockErrorCsvGenerationUtil.getProjectIds.mockReturnValue([
      'project-123',
      'project-456',
    ]);
    mockErrorCsvGenerationUtil.formatDateTime.mockImplementation(
      (date) => '2024-07-15 10:30:00',
    );
    mockErrorCsvGenerationUtil.groupDataByProjectAndDate.mockReturnValue(
      new Map([
        ['project-123', new Map([['2024-07-15', [mockOperationErrorData[0]]]])],
        ['project-456', new Map([['2024-07-16', [mockOperationErrorData[1]]]])],
      ]),
    );
  });

  describe('generateErrorCsv', () => {
    it('should throw error when zipLocation is missing', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
          projectWorkerMap: [{ projectId: 'project-123' }],
        },
      };

      await expect(activity.generateErrorCsv(request)).rejects.toThrow(
        'zipLocation is required for error CSV generation',
      );
    });

    it('should return success message when no project IDs found', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
          projectWorkerMap: [],
        },
      };

      mockErrorCsvGenerationUtil.getProjectIds.mockReturnValue([]);

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'No valid project IDs found for CSV generation',
      );
      expect(result.filesCreated).toBe(0);
    });

    it('should return success message when no operation errors found', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
          projectWorkerMap: [{ projectId: 'project-123' }],
        },
      };

      operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(
        [],
      );

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'No operation errors found for the given date range and projects',
      );
      expect(result.filesCreated).toBe(0);
    });

    it('should successfully generate CSV when data is available', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
          projectWorkerMap: [{ projectId: 'project-123' }],
        },
      };

      operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(
        mockOperationErrorData,
      );
      mockFs.access.mockResolvedValue(undefined);
      MockAdmZip.mockImplementation(() => mockZipInstance);
      mockZipInstance.getEntries.mockReturnValue([
        {
          entryName: 'ndm_logs/2024-07-15/project-123/control-plane/',
          isDirectory: true,
        } as any,
      ]);

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(true);
      expect(result.message).toContain(
        'Successfully exported operation errors to',
      );
      expect(result.filesCreated).toBe(2); // Based on mock grouping
    });

    it('should handle errors gracefully and return failure result', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
          projectWorkerMap: [{ projectId: 'project-123' }],
        },
      };

      operationErrorService.getOperationErrorsByProjectAndDateRange.mockRejectedValue(
        new Error('Database error'),
      );

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain(
        'Export failed: Failed to fetch operation errors from database: Database error',
      );
      expect(result.filesCreated).toBe(0);
    });

    it('should handle getProjectIds throwing an error', async () => {
      const request = {
        traceId: 'trace-123',
        payload: {
          zipLocation: '/path/to/output.zip',
          startDate: '2024-07-01',
          endDate: '2024-07-31',
          projectWorkerMap: [{ projectId: 'project-123' }],
        },
      };

      mockErrorCsvGenerationUtil.getProjectIds.mockImplementation(() => {
        throw new Error('Invalid project map');
      });

      const result = await activity.generateErrorCsv(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain(
        'Export failed: No project IDs found for error CSV generation',
      );
      expect(result.filesCreated).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[trace-123] Failed to extract project IDs:',
        expect.any(Error),
      );
    });
  });

  describe('getOperationErrorsByProjectAndDateRange', () => {
    it('should fetch operation errors successfully', async () => {
      operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(
        mockOperationErrorData,
      );

      const result = await activity.getOperationErrorsByProjectAndDateRange(
        ['project-123'],
        '2024-07-01',
        '2024-07-31',
      );

      expect(result).toEqual(mockOperationErrorData);
      expect(
        operationErrorService.getOperationErrorsByProjectAndDateRange,
      ).toHaveBeenCalledWith(['project-123'], '2024-07-01', '2024-07-31');
    });

    it('should throw error when no project IDs provided', async () => {
      await expect(
        activity.getOperationErrorsByProjectAndDateRange(
          [],
          '2024-07-01',
          '2024-07-31',
        ),
      ).rejects.toThrow('No project IDs found for error CSV generation');
    });

    it('should throw error when project IDs is null', async () => {
      await expect(
        activity.getOperationErrorsByProjectAndDateRange(
          null as any,
          '2024-07-01',
          '2024-07-31',
        ),
      ).rejects.toThrow('No project IDs found for error CSV generation');
    });

    it('should handle database errors', async () => {
      operationErrorService.getOperationErrorsByProjectAndDateRange.mockRejectedValue(
        new Error('DB connection failed'),
      );

      await expect(
        activity.getOperationErrorsByProjectAndDateRange(
          ['project-123'],
          '2024-07-01',
          '2024-07-31',
        ),
      ).rejects.toThrow(
        'Failed to fetch operation errors from database: DB connection failed',
      );
    });
  });

  describe('exportOperationErrorsToZip', () => {
    const mockRequest: ExportRequest = {
      projectIds: ['project-123'],
      startDate: '2024-07-01',
      endDate: '2024-07-31',
      outputLocation: '/path/to/output.zip',
    };

    it('should export operation errors to zip successfully', async () => {
      operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(
        mockOperationErrorData,
      );
      mockFs.access.mockResolvedValue(undefined);
      MockAdmZip.mockImplementation(() => mockZipInstance);
      mockZipInstance.getEntries.mockReturnValue([
        {
          entryName: 'ndm_logs/2024-07-15/project-123/control-plane/',
          isDirectory: true,
        } as any,
      ]);

      await activity.exportOperationErrorsToZip(mockRequest, 'trace-123');

      expect(
        operationErrorService.getOperationErrorsByProjectAndDateRange,
      ).toHaveBeenCalledWith(['project-123'], '2024-07-01', '2024-07-31');
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[trace-123] Starting CSV export to zip for 1 projects',
      );
    });

    it('should handle case when no operation errors found', async () => {
      operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(
        [],
      );

      await activity.exportOperationErrorsToZip(mockRequest, 'trace-123');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[trace-123] No operation errors found for export criteria',
      );
    });

    it('should handle case when grouped data is empty', async () => {
      operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(
        mockOperationErrorData,
      );
      mockErrorCsvGenerationUtil.groupDataByProjectAndDate.mockReturnValue(
        new Map(),
      );

      await activity.exportOperationErrorsToZip(mockRequest, 'trace-123');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          '[trace-123] No grouped data by project ID and date available',
        ),
      );
    });

    it('should handle errors during export', async () => {
      operationErrorService.getOperationErrorsByProjectAndDateRange.mockRejectedValue(
        new Error('Export failed'),
      );

      await expect(
        activity.exportOperationErrorsToZip(mockRequest, 'trace-123'),
      ).rejects.toThrow(
        'Failed to export errors to zip: Failed to fetch operation errors from database: Export failed',
      );
    });
  });

  describe('addCSVFilesToZip', () => {
    beforeEach(() => {
      MockAdmZip.mockImplementation(() => mockZipInstance);
    });

    it('should throw error when zip file does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('File not found'));

      const groupedData = new Map();

      await expect(
        (activity as any).addCSVFilesToZip(
          groupedData,
          '/nonexistent.zip',
          'trace-123',
        ),
      ).rejects.toThrow('Zip file not found: /nonexistent.zip');
    });

    it('should throw error when zip file is corrupted', async () => {
      mockFs.access.mockResolvedValue(undefined);
      MockAdmZip.mockImplementation(() => {
        throw new Error('Invalid zip file');
      });

      const groupedData = new Map();

      await expect(
        (activity as any).addCSVFilesToZip(
          groupedData,
          '/corrupted.zip',
          'trace-123',
        ),
      ).rejects.toThrow('Failed to load existing zip file: Invalid zip file');
    });

    it('should handle empty zip file', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockZipInstance.getEntries.mockReturnValue([]);

      const groupedData = new Map([
        ['project-123', new Map([['2024-07-15', mockOperationErrorData]])],
      ]);

      await (activity as any).addCSVFilesToZip(
        groupedData,
        '/test.zip',
        'trace-123',
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[trace-123] Zip file is empty.',
      );
    });

    it('should process grouped data and add CSV files', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockZipInstance.getEntries.mockReturnValue([
        {
          entryName: 'ndm_logs/2024-07-15/project-123/control-plane/',
          isDirectory: true,
        } as any,
      ]);

      // Mock generateCSVContent and addCSVToZip
      jest
        .spyOn(activity as any, 'generateCSVContent')
        .mockResolvedValue('csv,content\ntest,data');
      jest.spyOn(activity as any, 'addCSVToZip').mockResolvedValue(true);

      const groupedData = new Map([
        ['project-123', new Map([['2024-07-15', mockOperationErrorData]])],
      ]);

      await (activity as any).addCSVFilesToZip(
        groupedData,
        '/test.zip',
        'trace-123',
      );

      expect(mockZipInstance.writeZip).toHaveBeenCalledWith('/test.zip');
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[trace-123] Total CSV files added: 1',
      );
    });
  });

  describe('addCSVToZip', () => {
    const mockZipEntries = [
      {
        entryName: 'ndm_logs/2024-07-15/project-123/control-plane/',
        isDirectory: true,
      } as any,
    ];

    it('should find control-plane location and add CSV', async () => {
      jest
        .spyOn(activity as any, 'generateCSVContent')
        .mockResolvedValue('csv,content\ntest,data');

      const result = await (activity as any).addCSVToZip(
        mockZipInstance,
        'project-123',
        '2024-07-15',
        mockOperationErrorData,
        mockZipEntries,
        'trace-123',
      );

      expect(result).toBe(true);
      expect(mockZipInstance.addFile).toHaveBeenCalledWith(
        'ndm_logs/2024-07-15/project-123/control-plane/error-report.csv',
        expect.any(Buffer),
      );
    });

    it('should handle project folder location', async () => {
      const projectEntries = [
        {
          entryName: 'ndm_logs/2024-07-15/project-123/',
          isDirectory: true,
        } as any,
      ];
      jest
        .spyOn(activity as any, 'generateCSVContent')
        .mockResolvedValue('csv,content');

      const result = await (activity as any).addCSVToZip(
        mockZipInstance,
        'project-123',
        '2024-07-15',
        mockOperationErrorData,
        projectEntries,
        'trace-123',
      );

      expect(result).toBe(true);
      expect(mockZipInstance.addFile).toHaveBeenCalledWith(
        'ndm_logs/2024-07-15/project-123/control-plane/error-report.csv',
        expect.any(Buffer),
      );
    });

    it('should handle date folder location', async () => {
      const dateEntries = [
        { entryName: 'ndm_logs/2024-07-15/', isDirectory: true } as any,
      ];
      jest
        .spyOn(activity as any, 'generateCSVContent')
        .mockResolvedValue('csv,content');

      const result = await (activity as any).addCSVToZip(
        mockZipInstance,
        'project-123',
        '2024-07-15',
        mockOperationErrorData,
        dateEntries,
        'trace-123',
      );

      expect(result).toBe(true);
      expect(mockZipInstance.addFile).toHaveBeenCalledWith(
        'ndm_logs/2024-07-15/project-123/control-plane/error-report.csv',
        expect.any(Buffer),
      );
    });

    it('should return false when no suitable location found', async () => {
      const emptyEntries: any[] = [];

      const result = await (activity as any).addCSVToZip(
        mockZipInstance,
        'project-123',
        '2024-07-15',
        mockOperationErrorData,
        emptyEntries,
        'trace-123',
      );

      expect(result).toBe(false);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('[trace-123] No suitable location found'),
      );
    });

    it('should handle date format with slashes', async () => {
      jest
        .spyOn(activity as any, 'generateCSVContent')
        .mockResolvedValue('csv,content');

      const result = await (activity as any).addCSVToZip(
        mockZipInstance,
        'project-123',
        '2024/07/15', // Date with slashes
        mockOperationErrorData,
        mockZipEntries,
        'trace-123',
      );

      expect(result).toBe(false); // Should not find match with slash date format
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(
          "[trace-123] No suitable location found for project 'project-123' and date '2024/07/15'",
        ),
      );
    });

    it('should handle errors during CSV generation', async () => {
      jest
        .spyOn(activity as any, 'generateCSVContent')
        .mockRejectedValue(new Error('CSV generation failed'));

      const result = await (activity as any).addCSVToZip(
        mockZipInstance,
        'project-123',
        '2024-07-15',
        mockOperationErrorData,
        mockZipEntries,
        'trace-123',
      );

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[trace-123] Unexpected error in addCSVToZip'),
        expect.any(Error),
      );
    });
  });

  describe('generateCSVContent', () => {
    it('should generate CSV content successfully', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('csv,content\ntest,data');
      mockFs.unlink.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockResolvedValue(undefined);

      const result = await (activity as any).generateCSVContent(
        mockOperationErrorData,
        'trace-123',
      );

      expect(result).toBe('csv,content\ntest,data');
      expect(mockCreateObjectCsvWriter).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining('temp_'),
          header: expect.arrayContaining([
            { id: 'id', title: 'ID' },
            { id: 'operationId', title: 'Operation ID' },
            { id: 'errorCode', title: 'Error Code' },
            { id: 'errorMessage', title: 'Error Message' },
            { id: 'createdAt', title: 'Created At' },
            { id: 'errorType', title: 'Error Type' },
            { id: 'operationType', title: 'Operation Type' },
            { id: 'origin', title: 'Origin' },
            { id: 'projectId', title: 'Project ID' },
            { id: 'projectName', title: 'Project Name' },
          ]),
        }),
      );
      expect(mockCsvWriter.writeRecords).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: '1',
            createdAt: '2024-07-15 10:30:00', // Formatted date
          }),
        ]),
      );
    });

    it('should handle temp directory creation failure', async () => {
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      await expect(
        (activity as any).generateCSVContent(
          mockOperationErrorData,
          'trace-123',
        ),
      ).rejects.toThrow(
        'CSV content generation failed: Failed to create temp directory /tmp: Permission denied',
      );
    });

    it('should handle CSV writing failure', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockRejectedValue(new Error('Write failed'));
      mockFs.unlink.mockResolvedValue(undefined);

      await expect(
        (activity as any).generateCSVContent(
          mockOperationErrorData,
          'trace-123',
        ),
      ).rejects.toThrow(
        'CSV content generation failed: Failed to write CSV records: Write failed',
      );
    });

    it('should handle file reading failure', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockResolvedValue(undefined);
      mockFs.readFile.mockRejectedValue(new Error('Read failed'));
      mockFs.unlink.mockResolvedValue(undefined);

      await expect(
        (activity as any).generateCSVContent(
          mockOperationErrorData,
          'trace-123',
        ),
      ).rejects.toThrow(
        'CSV content generation failed: Failed to read CSV file: Read failed',
      );
    });

    it('should clean up temp file even when file reading fails', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockResolvedValue(undefined);
      mockFs.readFile.mockRejectedValue(new Error('Read failed'));
      mockFs.unlink.mockResolvedValue(undefined);

      await expect(
        (activity as any).generateCSVContent(
          mockOperationErrorData,
          'trace-123',
        ),
      ).rejects.toThrow();

      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it('should handle cleanup failure gracefully', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('csv,content');
      mockFs.unlink.mockRejectedValue(new Error('Cleanup failed'));

      const result = await (activity as any).generateCSVContent(
        mockOperationErrorData,
        'trace-123',
      );

      expect(result).toBe('csv,content');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[trace-123] Failed to clean up temp file'),
        expect.any(Error),
      );
    });

    it('should handle cleanup failure during error handling', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockCsvWriter.writeRecords.mockRejectedValue(new Error('Write failed'));
      mockFs.unlink.mockRejectedValue(new Error('Cleanup failed'));

      await expect(
        (activity as any).generateCSVContent(
          mockOperationErrorData,
          'trace-123',
        ),
      ).rejects.toThrow(
        'CSV content generation failed: Failed to write CSV records: Write failed',
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          '[trace-123] Failed to cleanup temp file during error handling',
        ),
        expect.any(Error),
      );
    });
  });
});
