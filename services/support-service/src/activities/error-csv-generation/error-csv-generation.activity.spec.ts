import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import AdmZip = require('adm-zip');
import { ErrorCsvGenerationActivity } from './error-csv-generation.activity';
import { OperationErrorService } from 'src/utils/error-csv-generation.service';
import { ExportRequest, ExportResult, OperationErrorExportData } from 'src/constants/types';
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
const mockCreateObjectCsvWriter = createObjectCsvWriter as jest.MockedFunction<typeof createObjectCsvWriter>;
const MockAdmZip = AdmZip as jest.MockedClass<typeof AdmZip>;
const mockErrorCsvGenerationUtil = errorCsvGenerationUtil as jest.Mocked<typeof errorCsvGenerationUtil>;

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
            getOperationErrorsByProjectAndDateRange: jest.fn(),
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

        activity = module.get<ErrorCsvGenerationActivity>(ErrorCsvGenerationActivity);
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
        mockErrorCsvGenerationUtil.getProjectIds.mockReturnValue(['project-123', 'project-456']);
        mockErrorCsvGenerationUtil.formatDateTime.mockImplementation((date) => '2024-07-15 10:30:00');
        mockErrorCsvGenerationUtil.groupDataByProjectAndDate.mockReturnValue(
            new Map([
                ['project-123', new Map([
                    ['2024-07-15', [mockOperationErrorData[0]]],
                ])],
                ['project-456', new Map([
                    ['2024-07-16', [mockOperationErrorData[1]]],
                ])],
            ])
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

            await expect(activity.generateErrorCsv(request)).rejects.toThrow('zipLocation is required for error CSV generation');
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
            expect(result.message).toBe('No valid project IDs found for CSV generation');
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

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue([]);

            const result = await activity.generateErrorCsv(request);

            expect(result.success).toBe(true);
            expect(result.message).toBe('No operation errors found for the given date range and projects');
            expect(result.filesCreated).toBe(0);
        });

        it('should successfully generate CSV when data exists', async () => {
            const request = {
                traceId: 'trace-123',
                payload: {
                    zipLocation: '/path/to/output.zip',
                    startDate: '2024-07-01',
                    endDate: '2024-07-31',
                    projectWorkerMap: [{ projectId: 'project-123' }],
                },
            };

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(mockOperationErrorData);

            // Mock the exportOperationErrorsToZip method
            jest.spyOn(activity, 'exportOperationErrorsToZip').mockResolvedValue(undefined);

            const result = await activity.generateErrorCsv(request);

            expect(result.success).toBe(true);
            expect(result.message).toContain('Successfully exported operation errors');
            expect(result.filesCreated).toBe(2); // 2 files created based on grouped data
            expect(activity.exportOperationErrorsToZip).toHaveBeenCalledWith(
                {
                    projectIds: ['project-123', 'project-456'],
                    startDate: request.payload.startDate,
                    endDate: request.payload.endDate,
                    outputLocation: request.payload.zipLocation,
                },
                request.traceId
            );
        });

        it('should handle errors and return failure result', async () => {
            const request = {
                traceId: 'trace-123',
                payload: {
                    zipLocation: '/path/to/output.zip',
                    startDate: '2024-07-01',
                    endDate: '2024-07-31',
                    projectWorkerMap: [{ projectId: 'project-123' }],
                },
            };

            const error = new Error('Database connection failed');
            operationErrorService.getOperationErrorsByProjectAndDateRange.mockRejectedValue(error);

            const result = await activity.generateErrorCsv(request);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Export failed: Failed to fetch operation errors from database: Database connection failed');
            expect(result.filesCreated).toBe(0);
            expect(mockLogger.error).toHaveBeenCalledWith(
                `[${request.traceId}] Error exporting operation errors:`,
                expect.objectContaining({
                    message: 'Failed to fetch operation errors from database: Database connection failed'
                })
            );
        });

        it('should handle non-Error exceptions', async () => {
            const request = {
                traceId: 'trace-123',
                payload: {
                    zipLocation: '/path/to/output.zip',
                    startDate: '2024-07-01',
                    endDate: '2024-07-31',
                    projectWorkerMap: [{ projectId: 'project-123' }],
                },
            };

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockRejectedValue('String error');

            const result = await activity.generateErrorCsv(request);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Export failed: Failed to fetch operation errors from database: String error');
        });

        it('should handle missing traceId', async () => {
            const request = {
                traceId: undefined,
                payload: {
                    zipLocation: '/path/to/output.zip',
                    startDate: '2024-07-01',
                    endDate: '2024-07-31',
                    projectWorkerMap: [{ projectId: 'project-123' }],
                },
            };

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(mockOperationErrorData);
            jest.spyOn(activity, 'exportOperationErrorsToZip').mockResolvedValue(undefined);

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
                    projectWorkerMap: [{ projectId: 'project-123' }],
                },
            };

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(mockOperationErrorData);
            jest.spyOn(activity, 'exportOperationErrorsToZip').mockRejectedValue(new Error('Zip creation failed'));

            const result = await activity.generateErrorCsv(request);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Export failed: Zip creation failed');
        });
    });

    describe('getOperationErrorsByProjectAndDateRange', () => {
        it('should delegate to operation error service', async () => {
            const projectIds = ['project-123'];
            const startDate = '2024-07-01';
            const endDate = '2024-07-31';

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(mockOperationErrorData);

            const result = await activity.getOperationErrorsByProjectAndDateRange(projectIds, startDate, endDate);

            expect(result).toEqual(mockOperationErrorData);
            expect(operationErrorService.getOperationErrorsByProjectAndDateRange).toHaveBeenCalledWith(
                projectIds,
                startDate,
                endDate,
            );
        });

        it('should handle service error', async () => {
            const projectIds = ['project-123'];
            const startDate = '2024-07-01';
            const endDate = '2024-07-31';

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockRejectedValue(new Error('Database error'));

            await expect(activity.getOperationErrorsByProjectAndDateRange(projectIds, startDate, endDate))
                .rejects.toThrow('Failed to fetch operation errors from database: Database error');
        });

        it('should handle empty result from service', async () => {
            const projectIds = ['project-123'];
            const startDate = '2024-07-01';
            const endDate = '2024-07-31';

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue([]);

            const result = await activity.getOperationErrorsByProjectAndDateRange(projectIds, startDate, endDate);

            expect(result).toEqual([]);
        });

        it('should throw error when no project IDs provided', async () => {
            const projectIds = [];
            const startDate = '2024-07-01';
            const endDate = '2024-07-31';

            await expect(activity.getOperationErrorsByProjectAndDateRange(projectIds, startDate, endDate))
                .rejects.toThrow('No project IDs found for error CSV generation');
        });

        it('should handle null project IDs', async () => {
            const projectIds = null as any;
            const startDate = '2024-07-01';
            const endDate = '2024-07-31';

            await expect(activity.getOperationErrorsByProjectAndDateRange(projectIds, startDate, endDate))
                .rejects.toThrow('No project IDs found for error CSV generation');
        });
    });

    describe('exportOperationErrorsToZip', () => {
        it('should process data and add CSV files to zip', async () => {
            const request: ExportRequest = {
                projectIds: ['project-123'],
                startDate: '2024-07-01',
                endDate: '2024-07-31',
                outputLocation: '/path/to/output.zip',
            };
            const traceId = 'trace-123';

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(mockOperationErrorData);

            // Mock the addCSVFilesToZip method
            jest.spyOn(activity as any, 'addCSVFilesToZip').mockResolvedValue(undefined);

            await activity.exportOperationErrorsToZip(request, traceId);

            expect(operationErrorService.getOperationErrorsByProjectAndDateRange).toHaveBeenCalledWith(
                request.projectIds,
                request.startDate,
                request.endDate,
            );
            expect((activity as any).addCSVFilesToZip).toHaveBeenCalledWith(
                expect.any(Map),
                request.outputLocation,
                traceId
            );
        });

        it('should handle empty data from service', async () => {
            const request: ExportRequest = {
                projectIds: ['project-123'],
                startDate: '2024-07-01',
                endDate: '2024-07-31',
                outputLocation: '/path/to/output.zip',
            };
            const traceId = 'trace-123';

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue([]);

            await activity.exportOperationErrorsToZip(request, traceId);

            expect(mockLogger.warn).toHaveBeenCalledWith(`[${traceId}] No operation errors found for export criteria`);
        });

        it('should handle service error gracefully', async () => {
            const request: ExportRequest = {
                projectIds: ['project-123'],
                startDate: '2024-07-01',
                endDate: '2024-07-31',
                outputLocation: '/path/to/output.zip',
            };
            const traceId = 'trace-123';

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockRejectedValue(new Error('Service error'));

            await expect(activity.exportOperationErrorsToZip(request, traceId))
                .rejects.toThrow('Failed to export errors to zip: Failed to fetch operation errors from database: Service error');
        });

        it('should handle empty grouped data after processing', async () => {
            const request: ExportRequest = {
                projectIds: ['project-123'],
                startDate: '2024-07-01',
                endDate: '2024-07-31',
                outputLocation: '/path/to/output.zip',
            };
            const traceId = 'trace-123';

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(mockOperationErrorData);
            mockErrorCsvGenerationUtil.groupDataByProjectAndDate.mockReturnValue(new Map());

            await activity.exportOperationErrorsToZip(request, traceId);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                `[${traceId}] No grouped data by project ID and date available after processing ${mockOperationErrorData.length} records for error CSV generation`
            );
        });
    });

    describe('addCSVFilesToZip', () => {
        beforeEach(() => {
            MockAdmZip.mockImplementation(() => mockZipInstance);
        });

        it('should add CSV files to existing zip structure', async () => {
            const groupedData = new Map([
                ['project-123', new Map([
                    ['2024-07-15', [mockOperationErrorData[0]]],
                ])],
            ]);
            const zipFilePath = '/path/to/output.zip';
            const traceId = 'trace-123';

            // Mock zip file exists
            mockFs.access.mockResolvedValue(undefined);

            // Mock zip entries
            const mockEntries = [
                { isDirectory: true, entryName: 'ndm_logs/' },
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/project-123/' },
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/project-123/control_plane/' },
            ] as AdmZip.IZipEntry[];

            mockZipInstance.getEntries.mockReturnValue(mockEntries);

            // Mock CSV content generation
            jest.spyOn(activity as any, 'generateCSVContent').mockResolvedValue('mock,csv,content');
            jest.spyOn(activity as any, 'addCSVToZip').mockResolvedValue(true);

            await (activity as any).addCSVFilesToZip(groupedData, zipFilePath, traceId);

            expect(mockFs.access).toHaveBeenCalledWith(zipFilePath);
            expect(mockZipInstance.getEntries).toHaveBeenCalled();
            expect(mockZipInstance.writeZip).toHaveBeenCalledWith(zipFilePath);
            expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Loading existing zip file: ${zipFilePath}`);
            expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Zip file updated successfully: ${zipFilePath}`);
        });

        it('should throw error when zip file does not exist', async () => {
            const groupedData = new Map();
            const zipFilePath = '/path/to/nonexistent.zip';
            const traceId = 'trace-123';

            // Mock zip file does not exist
            mockFs.access.mockRejectedValue(new Error('File not found'));

            await expect((activity as any).addCSVFilesToZip(groupedData, zipFilePath, traceId))
                .rejects.toThrow('Zip file not found: /path/to/nonexistent.zip');
        });

        it('should handle empty grouped data', async () => {
            const groupedData = new Map();
            const zipFilePath = '/path/to/output.zip';
            const traceId = 'trace-123';

            mockFs.access.mockResolvedValue(undefined);
            mockZipInstance.getEntries.mockReturnValue([]);

            await (activity as any).addCSVFilesToZip(groupedData, zipFilePath, traceId);

            expect(mockZipInstance.writeZip).toHaveBeenCalledWith(zipFilePath);
            expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Total CSV files added: 0`);
        });

        it('should handle zip loading error', async () => {
            const groupedData = new Map();
            const zipFilePath = '/path/to/output.zip';
            const traceId = 'trace-123';

            mockFs.access.mockResolvedValue(undefined);
            MockAdmZip.mockImplementation(() => {
                throw new Error('Failed to load zip');
            });

            await expect((activity as any).addCSVFilesToZip(groupedData, zipFilePath, traceId))
                .rejects.toThrow('Failed to load existing zip file: Failed to load zip');
        });

        it('should handle dates with slashes and replace them', async () => {
            const groupedData = new Map([
                ['project-123', new Map([
                    ['2024/07/15', [mockOperationErrorData[0]]],
                ])],
            ]);
            const zipFilePath = '/path/to/output.zip';
            const traceId = 'trace-123';

            mockFs.access.mockResolvedValue(undefined);
            mockZipInstance.getEntries.mockReturnValue([]);

            jest.spyOn(activity as any, 'addCSVToZip').mockResolvedValue(true);

            await (activity as any).addCSVFilesToZip(groupedData, zipFilePath, traceId);

            expect((activity as any).addCSVToZip).toHaveBeenCalledWith(
                mockZipInstance,
                'project-123',
                '2024-07-15', // Should be converted from slash to dash
                [mockOperationErrorData[0]],
                [],
                traceId
            );
        });
    });

    describe('addCSVToZip', () => {
        beforeEach(() => {
            // Mock CSV content generation
            jest.spyOn(activity as any, 'generateCSVContent').mockResolvedValue('mock,csv,content');
        });

        it('should add CSV to zip with existing control_plane structure', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/project-123/control_plane/' },
            ] as AdmZip.IZipEntry[];

            const result = await (activity as any).addCSVToZip(
                mockZipInstance,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
                'trace-123'
            );

            expect(result).toBe(true);
            expect(mockZipInstance.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/project-123/control_plane/error-report.csv',
                expect.any(Buffer)
            );
        });

        it('should create control_plane structure when project folder exists', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/project-123/' },
            ] as AdmZip.IZipEntry[];

            const result = await (activity as any).addCSVToZip(
                mockZipInstance,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
                'trace-123'
            );

            expect(result).toBe(true);
            expect(mockZipInstance.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/project-123/control_plane/error-report.csv',
                expect.any(Buffer)
            );
        });

        it('should create project structure when date folder exists', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
            ] as AdmZip.IZipEntry[];

            const result = await (activity as any).addCSVToZip(
                mockZipInstance,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
                'trace-123'
            );

            expect(result).toBe(true);
            expect(mockZipInstance.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/project-123/control_plane/error-report.csv',
                expect.any(Buffer)
            );
        });

        it('should return false when no suitable location found', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'other_logs/' },
            ] as AdmZip.IZipEntry[];

            const result = await (activity as any).addCSVToZip(
                mockZipInstance,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
                'trace-123'
            );

            expect(result).toBe(false);
            expect(mockZipInstance.addFile).not.toHaveBeenCalled();
        });

        it('should handle CSV content generation error', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
            ] as AdmZip.IZipEntry[];

            jest.spyOn(activity as any, 'generateCSVContent').mockRejectedValue(new Error('CSV generation failed'));

            const result = await (activity as any).addCSVToZip(
                mockZipInstance,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
                'trace-123'
            );

            expect(result).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                '[trace-123] Failed to generate CSV content for project \'project-123\' date \'2024-07-15\':',
                expect.any(Error)
            );
        });

        it('should handle zip addFile error', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
            ] as AdmZip.IZipEntry[];

            mockZipInstance.addFile.mockImplementation(() => {
                throw new Error('Add file failed');
            });

            const result = await (activity as any).addCSVToZip(
                mockZipInstance,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
                'trace-123'
            );

            expect(result).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                '[trace-123] Failed to add CSV file to zip:',
                expect.any(Error)
            );
        });
    });

    describe('generateCSVContent', () => {
        beforeEach(() => {
            mockCsvWriter.writeRecords.mockResolvedValue(undefined);
        });

        it('should generate CSV content successfully', async () => {
            const errors = [mockOperationErrorData[0]];
            const mockCsvContent = 'ID,Operation ID,Error Code\n1,op-001,ERR001';
            const traceId = 'trace-123';

            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.readFile.mockResolvedValue(mockCsvContent);
            mockFs.unlink.mockResolvedValue(undefined);

            const result = await (activity as any).generateCSVContent(errors, traceId);

            expect(result).toBe(mockCsvContent);
            expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp', { recursive: true });
            expect(mockCreateObjectCsvWriter).toHaveBeenCalled();
            expect(mockCsvWriter.writeRecords).toHaveBeenCalledWith([{
                ...errors[0],
                createdAt: '2024-07-15 10:30:00' // Formatted by mock
            }]);
            expect(mockFs.unlink).toHaveBeenCalled();
        });

        it('should clean up temp file on CSV writer error', async () => {
            const errors = [mockOperationErrorData[0]];
            const traceId = 'trace-123';

            mockFs.mkdir.mockResolvedValue(undefined);
            mockCsvWriter.writeRecords.mockRejectedValue(new Error('CSV write failed'));
            mockFs.unlink.mockResolvedValue(undefined);

            await expect((activity as any).generateCSVContent(errors, traceId))
                .rejects.toThrow('CSV content generation failed: Failed to write CSV records: CSV write failed');

            expect(mockFs.unlink).toHaveBeenCalled();
        });

        it('should handle cleanup errors gracefully', async () => {
            const errors = [mockOperationErrorData[0]];
            const traceId = 'trace-123';

            mockFs.mkdir.mockResolvedValue(undefined);
            mockCsvWriter.writeRecords.mockRejectedValue(new Error('CSV write failed'));
            mockFs.unlink.mockRejectedValue(new Error('Cleanup failed'));

            await expect((activity as any).generateCSVContent(errors, traceId))
                .rejects.toThrow('CSV content generation failed: Failed to write CSV records: CSV write failed');

            expect(mockLogger.warn).toHaveBeenCalledWith(
                `[${traceId}] Failed to cleanup temp file during error handling:`,
                expect.any(Error)
            );
        });

        it('should handle mkdir error', async () => {
            const errors = [mockOperationErrorData[0]];
            const traceId = 'trace-123';

            mockFs.mkdir.mockRejectedValue(new Error('Directory creation failed'));

            await expect((activity as any).generateCSVContent(errors, traceId))
                .rejects.toThrow('CSV content generation failed: Failed to create temp directory /tmp: Directory creation failed');
        });

        it('should handle readFile error', async () => {
            const errors = [mockOperationErrorData[0]];
            const traceId = 'trace-123';

            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.readFile.mockRejectedValue(new Error('File read failed'));
            mockFs.unlink.mockResolvedValue(undefined);

            await expect((activity as any).generateCSVContent(errors, traceId))
                .rejects.toThrow('CSV content generation failed: Failed to read CSV file: File read failed');

            expect(mockFs.unlink).toHaveBeenCalled();
        });

        it('should handle empty errors array', async () => {
            const errors = [];
            const mockCsvContent = 'ID,Operation ID,Error Code\n';
            const traceId = 'trace-123';

            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.readFile.mockResolvedValue(mockCsvContent);
            mockFs.unlink.mockResolvedValue(undefined);

            const result = await (activity as any).generateCSVContent(errors, traceId);

            expect(result).toBe(mockCsvContent);
            expect(mockCsvWriter.writeRecords).toHaveBeenCalledWith([]);
        });

        it('should handle createObjectCsvWriter error', async () => {
            const errors = [mockOperationErrorData[0]];
            const traceId = 'trace-123';

            mockFs.mkdir.mockResolvedValue(undefined);
            mockCreateObjectCsvWriter.mockImplementation(() => {
                throw new Error('CSV writer creation failed');
            });

            await expect((activity as any).generateCSVContent(errors, traceId))
                .rejects.toThrow('CSV content generation failed: Failed to create CSV writer: CSV writer creation failed');
        });
    });
});
