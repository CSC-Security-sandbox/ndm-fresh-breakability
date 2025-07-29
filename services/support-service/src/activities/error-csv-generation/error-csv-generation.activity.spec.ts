import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import AdmZip = require('adm-zip');
import { ErrorCsvGenerationActivity } from './error-csv-generation.activity';
import { OperationErrorService } from 'src/utils/error-csv-generation.service';
import { ExportRequest, ExportResult, OperationErrorExportData } from 'src/constants/types';

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

describe('ErrorCsvGenerationActivity', () => {
    let activity: ErrorCsvGenerationActivity;
    let operationErrorService: jest.Mocked<OperationErrorService>;
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

        // Reset all mocks
        jest.clearAllMocks();
    });

    describe('generateErrorCsv', () => {
        it('should successfully generate CSV when data exists', async () => {
            const request = {
                traceId: 'trace-123',
                payload: {
                    zipLocation: '/path/to/output.zip',
                    startDate: '2024-07-01',
                    endDate: '2024-07-31',
                },
                projectIds: ['project-123', 'project-456'],
            };

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(mockOperationErrorData);

            // Mock the exportOperationErrorsToZip method
            jest.spyOn(activity, 'exportOperationErrorsToZip').mockResolvedValue(undefined);

            const result = await activity.generateErrorCsv(request);

            expect(result.success).toBe(true);
            expect(result.filesCreated).toBeGreaterThan(0);
            expect(result.message).toContain('Successfully exported operation errors');
            expect(operationErrorService.getOperationErrorsByProjectAndDateRange).toHaveBeenCalledWith(
                request.projectIds,
                request.payload.startDate,
                request.payload.endDate,
            );
        });

        it('should return success message when no data exists', async () => {
            const request = {
                traceId: 'trace-123',
                payload: {
                    zipLocation: '/path/to/output.zip',
                    startDate: '2024-07-01',
                    endDate: '2024-07-31',
                },
                projectIds: ['project-123'],
            };

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue([]);

            const result = await activity.generateErrorCsv(request);

            expect(result.success).toBe(true);
            expect(result.filesCreated).toBe(0);
            expect(result.message).toBe('No operation errors found for the given criteria');
        });

        it('should handle errors and return failure result', async () => {
            const request = {
                traceId: 'trace-123',
                payload: {
                    zipLocation: '/path/to/output.zip',
                    startDate: '2024-07-01',
                    endDate: '2024-07-31',
                },
                projectIds: ['project-123'],
            };

            const error = new Error('Database connection failed');
            operationErrorService.getOperationErrorsByProjectAndDateRange.mockRejectedValue(error);

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            const result = await activity.generateErrorCsv(request);

            expect(result.success).toBe(false);
            expect(result.filesCreated).toBe(0);
            expect(result.message).toContain('Export failed: Database connection failed');
            expect(consoleSpy).toHaveBeenCalledWith('Error exporting operation errors:', error);

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
                projectIds: ['project-123'],
            };

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockRejectedValue('String error');

            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            const result = await activity.generateErrorCsv(request);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Export failed: String error');

            consoleSpy.mockRestore();
        });
    });

    describe('getOperationErrorsByProjectAndDateRange', () => {
        it('should delegate to operation error service', async () => {
            const projectIds = ['project-123', 'project-456'];
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
    });

    describe('exportOperationErrorsToZip', () => {
        it('should process data and add CSV files to zip', async () => {
            const request: ExportRequest = {
                projectIds: ['project-123'],
                startDate: '2024-07-01',
                endDate: '2024-07-31',
                outputLocation: '/path/to/output.zip',
            };

            operationErrorService.getOperationErrorsByProjectAndDateRange.mockResolvedValue(mockOperationErrorData);

            // Mock the addCSVFilesToZip method
            jest.spyOn(activity as any, 'addCSVFilesToZip').mockResolvedValue(undefined);

            await activity.exportOperationErrorsToZip(request);

            expect(operationErrorService.getOperationErrorsByProjectAndDateRange).toHaveBeenCalledWith(
                request.projectIds,
                request.startDate,
                request.endDate,
            );
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
            (AdmZip as jest.MockedClass<typeof AdmZip>).mockImplementation(() => mockZip);
        });

        it('should add CSV files to existing zip structure', async () => {
            const groupedData = new Map([
                ['project-123', new Map([
                    ['2024-07-15', [mockOperationErrorData[0]]],
                ])],
            ]);
            const zipFilePath = '/path/to/output.zip';

            // Mock zip file exists
            mockFs.access.mockResolvedValue(undefined);

            // Mock zip entries
            const mockEntries = [
                { isDirectory: true, entryName: 'ndm_logs/' },
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/project-123/' },
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/project-123/control_plane/' },
            ] as AdmZip.IZipEntry[];

            mockZip.getEntries.mockReturnValue(mockEntries);

            // Mock CSV content generation
            jest.spyOn(activity as any, 'generateCSVContent').mockResolvedValue('mock,csv,content');

            await (activity as any).addCSVFilesToZip(groupedData, zipFilePath);

            expect(mockFs.access).toHaveBeenCalledWith(zipFilePath);
            expect(mockZip.getEntries).toHaveBeenCalled();
            expect(mockZip.addFile).toHaveBeenCalled();
            expect(mockZip.writeZip).toHaveBeenCalledWith(zipFilePath);
            expect(mockLogger.log).toHaveBeenCalledWith(`Loading existing zip file: ${zipFilePath}`);
            expect(mockLogger.log).toHaveBeenCalledWith(`Zip file updated successfully: ${zipFilePath}`);
        });

        it('should throw error when zip file does not exist', async () => {
            const groupedData = new Map();
            const zipFilePath = '/path/to/nonexistent.zip';

            // Mock zip file does not exist
            mockFs.access.mockRejectedValue(new Error('File not found'));

            await expect((activity as any).addCSVFilesToZip(groupedData, zipFilePath))
                .rejects.toThrow('Zip file not found: /path/to/nonexistent.zip');
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
            mockCsvWriter.writeRecords.mockRejectedValue(new Error('CSV write failed'));
            mockFs.unlink.mockResolvedValue(undefined);

            await expect((activity as any).generateCSVContent(errors))
                .rejects.toThrow('CSV write failed');

            expect(mockFs.unlink).toHaveBeenCalled();
        });

        it('should handle cleanup errors gracefully', async () => {
            const errors = [mockOperationErrorData[0]];

            mockFs.mkdir.mockResolvedValue(undefined);
            mockCsvWriter.writeRecords.mockRejectedValue(new Error('CSV write failed'));
            mockFs.unlink.mockRejectedValue(new Error('Cleanup failed'));

            await expect((activity as any).generateCSVContent(errors))
                .rejects.toThrow('CSV write failed');
        });
    });

    describe('groupDataByProjectAndDate', () => {
        it('should group data by project ID and date correctly', () => {
            const result = (activity as any).groupDataByProjectAndDate(mockOperationErrorData);

            expect(result.size).toBe(2); // Two different projects
            expect(result.has('project-123')).toBe(true);
            expect(result.has('project-456')).toBe(true);

            const project123Data = result.get('project-123');
            expect(project123Data.has('2024-07-15')).toBe(true);
            expect(project123Data.get('2024-07-15')).toHaveLength(1);

            const project456Data = result.get('project-456');
            expect(project456Data.has('2024-07-16')).toBe(true);
            expect(project456Data.get('2024-07-16')).toHaveLength(1);
        });

        it('should handle invalid date formats gracefully', () => {
            const invalidDateData: OperationErrorExportData[] = [
                {
                    ...mockOperationErrorData[0],
                    createdAt: 'invalid-date' as any,
                },
            ];

            const result = (activity as any).groupDataByProjectAndDate(invalidDateData);

            expect(result.size).toBe(1);
            expect(result.has('project-123')).toBe(true);
        });

        it('should handle string dates correctly', () => {
            const stringDateData: OperationErrorExportData[] = [
                {
                    ...mockOperationErrorData[0],
                    createdAt: '2024-07-20T15:30:00Z' as any,
                },
            ];

            const result = (activity as any).groupDataByProjectAndDate(stringDateData);

            expect(result.size).toBe(1);
            const projectData = result.get('project-123');
            expect(projectData.has('2024-07-20')).toBe(true);
        });

        it('should handle legacy date formats', () => {
            const legacyDateData: OperationErrorExportData[] = [
                {
                    ...mockOperationErrorData[0],
                    createdAt: 'Fri Jul 11 2025' as any,
                },
            ];

            const result = (activity as any).groupDataByProjectAndDate(legacyDateData);

            expect(result.size).toBe(1);
            const projectData = result.get('project-123');
            expect(projectData.size).toBe(1);
        });
    });

    describe('findExactDirectory', () => {
        it('should find exact directory match', () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/' },
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
                { isDirectory: false, entryName: 'ndm_logs/file.txt' },
            ] as AdmZip.IZipEntry[];

            const result = (activity as any).findExactDirectory(zipEntries, 'ndm_logs/2024-07-15/');

            expect(result).toBe(true);
        });

        it('should return false when directory not found', () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/' },
                { isDirectory: false, entryName: 'ndm_logs/file.txt' },
            ] as AdmZip.IZipEntry[];

            const result = (activity as any).findExactDirectory(zipEntries, 'ndm_logs/2024-07-15/');

            expect(result).toBe(false);
        });

        it('should not match files as directories', () => {
            const zipEntries = [
                { isDirectory: false, entryName: 'ndm_logs/' },
            ] as AdmZip.IZipEntry[];

            const result = (activity as any).findExactDirectory(zipEntries, 'ndm_logs/');

            expect(result).toBe(false);
        });
    });

    describe('getErrorCountByProject', () => {
        it('should delegate to operation error service for error counts', async () => {
            const projectIds = ['project-123', 'project-456'];
            const startDate = '2024-07-01';
            const endDate = '2024-07-31';
            const mockErrorCounts = [
                { projectId: 'project-123', projectName: 'Test Project', errorCount: 5 },
                { projectId: 'project-456', projectName: 'Another Project', errorCount: 3 },
            ];

            operationErrorService.getErrorCountByProject.mockResolvedValue(mockErrorCounts);

            const result = await activity.getErrorCountByProject(projectIds, startDate, endDate);

            expect(result).toEqual(mockErrorCounts);
            expect(operationErrorService.getErrorCountByProject).toHaveBeenCalledWith(
                projectIds,
                startDate,
                endDate,
            );
        });
    });

    describe('addCSVToZip - directory structure logic', () => {
        let mockZip: jest.Mocked<AdmZip>;

        beforeEach(() => {
            mockZip = {
                addFile: jest.fn(),
            } as any;

            // Mock CSV content generation
            jest.spyOn(activity as any, 'generateCSVContent').mockResolvedValue('mock,csv,content');
        });

        it('should use existing control_plane folder when found', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/project-123/control_plane/' },
            ] as AdmZip.IZipEntry[];

            await (activity as any).addCSVToZip(
                mockZip,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
            );

            expect(mockZip.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/project-123/control_plane/errorlog.csv',
                expect.any(Buffer),
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
                '   ✓ Found existing control_plane: ndm_logs/2024-07-15/project-123/control_plane/',
            );
        });

        it('should create control_plane when project folder exists', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/project-123/' },
            ] as AdmZip.IZipEntry[];

            await (activity as any).addCSVToZip(
                mockZip,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
            );

            expect(mockZip.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/project-123/control_plane/errorlog.csv',
                expect.any(Buffer),
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
                'Found existing project folder: ndm_logs/2024-07-15/project-123/',
            );
        });

        it('should create project structure when date folder exists', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/2024-07-15/' },
            ] as AdmZip.IZipEntry[];

            await (activity as any).addCSVToZip(
                mockZip,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
            );

            expect(mockZip.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/project-123/control_plane/errorlog.csv',
                expect.any(Buffer),
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
                'Found existing date folder: ndm_logs/2024-07-15/',
            );
        });

        it('should create complete structure when only ndm_logs exists', async () => {
            const zipEntries = [
                { isDirectory: true, entryName: 'ndm_logs/' },
            ] as AdmZip.IZipEntry[];

            await (activity as any).addCSVToZip(
                mockZip,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
            );

            expect(mockZip.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/project-123/control_plane/errorlog.csv',
                expect.any(Buffer),
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
                'Found ndm_logs, creating structure: ndm_logs/2024-07-15/project-123/control_plane/',
            );
        });

        it('should create complete structure when no existing structure found', async () => {
            const zipEntries = [] as AdmZip.IZipEntry[];

            await (activity as any).addCSVToZip(
                mockZip,
                'project-123',
                '2024-07-15',
                [mockOperationErrorData[0]],
                zipEntries,
            );

            expect(mockZip.addFile).toHaveBeenCalledWith(
                'ndm_logs/2024-07-15/project-123/control_plane/errorlog.csv',
                expect.any(Buffer),
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
                'No existing structure found, creating complete structure: ndm_logs/2024-07-15/project-123/control_plane/errorlog.csv',
            );
        });

        it('should log successful CSV addition', async () => {
            const zipEntries = [] as AdmZip.IZipEntry[];
            const errors = [mockOperationErrorData[0]];

            await (activity as any).addCSVToZip(
                mockZip,
                'project-123',
                '2024-07-15',
                errors,
                zipEntries,
            );

            expect(mockLogger.log).toHaveBeenCalledWith(
                'Successfully added CSV: ndm_logs/2024-07-15/project-123/control_plane/errorlog.csv (1 records)',
            );
        });
    });
});
