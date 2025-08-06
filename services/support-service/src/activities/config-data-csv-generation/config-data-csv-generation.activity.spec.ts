import { ConfigurationDataCsvGenerationActivity } from './config-data-csv-generation.activity';
import { WorkerEntity } from 'src/entities/worker.entity';
import {
  ALLOWED_KEYWORDS,
  CSV_FILE_EXTENSION,
  CSV_FILE_PREFIX,
  MASK_VALUE,
  SENSITIVE_PATTERNS,
} from 'src/constants/constants';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

// Mock TypeORM decorators
jest.mock('typeorm', () => ({
  ...jest.requireActual('typeorm'),
  Entity: () => (target: any) => target,
  PrimaryGeneratedColumn: () => (target: any, key: string) => {},
  Column: () => (target: any, key: string) => {},
  ManyToOne: () => (target: any, key: string) => {},
  OneToMany: () => (target: any, key: string) => {},
  JoinColumn: () => (target: any, key: string) => {},
  CreateDateColumn: () => (target: any, key: string) => {},
  UpdateDateColumn: () => (target: any, key: string) => {},
}));

// Mock the external dependencies
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    mkdir: jest.fn(),
    access: jest.fn(),
  },
  createWriteStream: jest.fn(),
}));
jest.mock('archiver');
jest.mock('adm-zip');

describe('ConfigurationDataCsvGenerationActivity', () => {
  let service: ConfigurationDataCsvGenerationActivity;
  let mockWorkerRepo: jest.Mocked<Repository<WorkerEntity>>;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockFs: jest.Mocked<typeof fs>;
  let mockArchiver: jest.MockedFunction<typeof archiver>;
  let mockAdmZip: jest.MockedClass<typeof AdmZip>;

  const mockWorkerEntity: Partial<WorkerEntity> = {
    workerId: 'worker-1',
    projectId: 'project-1',
    envVariables: {
      DATABASE_URL: 'postgres://localhost:5432/db',
      API_KEY: 'secret-key',
      DEBUG_MODE: 'true',
      LOG_LEVEL: 'info',
    },
  };

  const mockJobConfigData = [
    {
      'Project Id': 'project-1',
      'Project Name': 'Test Project',
      'Project Description': 'Test Description',
      'Config Id': 'config-1',
      'Config Name': 'Test Config',
      'File Server Id': 'fs-1',
      'File Server Hostname': 'localhost',
      'File Server Username': 'user',
      'File Server Protocol': 'sftp',
      'File Server Type': 'linux',
      'File Server Protocol Version': '2.0',
      'Export Path Source': '/export/path',
      'Volume Path': '/volume/path',
      'JobConfig Id': 'job-1',
      'Job Type': 'migration',
      'Job Status': 'active',
      'Exclude File Patterns': '*.tmp',
    },
  ];

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Get the mocked fs module
    mockFs = fs as jest.Mocked<typeof fs>;
    mockArchiver = archiver as jest.MockedFunction<typeof archiver>;
    mockAdmZip = AdmZip as jest.MockedClass<typeof AdmZip>;

    // Create mock repository and data source
    mockWorkerRepo = {
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn(),
    } as any;

    mockDataSource = {
      query: jest.fn(),
      manager: jest.fn(),
      getRepository: jest.fn(),
    } as any;

    // Configure the fs.promises mocks with default behavior
    (mockFs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
    (mockFs.promises.access as jest.Mock).mockRejectedValue(
      new Error('File not found'),
    );

    // Setup createWriteStream mock
    const mockWriteStream = {
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(callback, 0);
        }
        return mockWriteStream;
      }),
    };
    (mockFs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);

    // Setup archiver mock
    const mockArchiverInstance = {
      on: jest.fn().mockReturnThis(),
      pipe: jest.fn().mockReturnThis(),
      append: jest.fn().mockReturnThis(),
      finalize: jest.fn().mockResolvedValue(undefined),
      pointer: jest.fn().mockReturnValue(1024),
    };
    mockArchiver.mockReturnValue(mockArchiverInstance as any);

    // Setup AdmZip mock
    const mockAdmZipInstance = {
      addFile: jest.fn(),
      writeZip: jest.fn(),
    };
    mockAdmZip.mockImplementation(() => mockAdmZipInstance as any);

    // Instantiate service after all mocks are set up
    service = new ConfigurationDataCsvGenerationActivity(
      mockWorkerRepo,
      mockDataSource,
    );
  });

  describe('generateConfigurationJobCsv', () => {
    it('should generate job config CSV when Configuration Data is in otherMetrics', async () => {
      const mockProjectDetails = [
        { project_id: 'project-1' },
        { project_id: 'project-2' },
      ];
      const payload = {
        zipLocation: '/path/to/zip',
        otherMetrics: ['Configuration Data', 'Logs'],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };
      const traceId = 'test-trace-id';

      mockDataSource.query.mockResolvedValue(mockProjectDetails);
      jest
        .spyOn(service as any, 'generateJobConfigCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationJobCsv({
        traceId,
        payload,
      });

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
      );
      expect(service['generateJobConfigCsv']).toHaveBeenCalledWith(
        ['project-1', 'project-2'],
        payload,
      );
      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
    });

    it('should not generate job config CSV when Configuration Data is not in otherMetrics', async () => {
      const mockProjectDetails = [
        { project_id: 'project-1' },
        { project_id: 'project-2' },
      ];
      const payload = {
        zipLocation: '/path/to/zip',
        otherMetrics: ['Logs', 'Metrics'], // No 'Configuration Data'
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };
      const traceId = 'test-trace-id';

      mockDataSource.query.mockResolvedValue(mockProjectDetails);
      const generateJobConfigCsvSpy = jest
        .spyOn(service as any, 'generateJobConfigCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationJobCsv({
        traceId,
        payload,
      });

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
      );
      expect(generateJobConfigCsvSpy).not.toHaveBeenCalled();
      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
    });

    it('should not generate job config CSV when no project IDs found', async () => {
      const payload = {
        zipLocation: '/path/to/zip',
        otherMetrics: ['Configuration Data'],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };
      const traceId = 'test-trace-id';

      mockDataSource.query.mockResolvedValue([]); // No projects
      const generateJobConfigCsvSpy = jest
        .spyOn(service as any, 'generateJobConfigCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationJobCsv({
        traceId,
        payload,
      });

      expect(generateJobConfigCsvSpy).not.toHaveBeenCalled();
      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
    });
  });

  describe('generateWorkerCsv', () => {
    it('should generate worker CSV successfully', async () => {
      const workerIds = ['worker-1', 'worker-2'];
      const payload = { zipLocation: '/path/to/zip' };

      mockWorkerRepo.find.mockResolvedValue([mockWorkerEntity as WorkerEntity]);
      jest
        .spyOn(service as any, 'createWorkerCsvContent')
        .mockReturnValue('csv content');
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      await service['generateWorkerCsv'](workerIds, payload);

      expect(mockWorkerRepo.find).toHaveBeenCalledWith({
        where: { workerId: expect.any(Object) }, // In matcher for workerIds
        select: ['workerId', 'projectId', 'envVariables'],
      });
      expect(service['createWorkerCsvContent']).toHaveBeenCalledWith([
        mockWorkerEntity as WorkerEntity,
      ]);
      expect(service['addCsvToZip']).toHaveBeenCalledWith(
        'csv content',
        expect.stringMatching(
          new RegExp(`^${CSV_FILE_PREFIX}\\d+${CSV_FILE_EXTENSION}$`),
        ),
        '/path/to/zip',
      );
    });
  });

  describe('generateJobConfigCsv', () => {
    it('should generate job config CSV successfully', async () => {
      const projectIds = ['project-1', 'project-2'];
      const payload = {
        zipLocation: '/path/to/zip',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };

      mockDataSource.query.mockResolvedValue(mockJobConfigData);
      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockReturnValue('csv content');
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      await service['generateJobConfigCsv'](projectIds, payload);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [payload.startDate, payload.endDate],
      );
      expect(service['createJobConfigCsvContent']).toHaveBeenCalledWith(
        mockJobConfigData,
      );
      expect(service['addCsvToZip']).toHaveBeenCalledWith(
        'csv content',
        expect.stringMatching(/^job_config_details_\d+\.csv$/),
        '/path/to/zip',
      );
    });

    it('should not create CSV when no job config data found', async () => {
      const projectIds = ['project-1'];
      const payload = { zipLocation: '/path/to/zip' };

      mockDataSource.query.mockResolvedValue([]);
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      await service['generateJobConfigCsv'](projectIds, payload);

      expect(service['addCsvToZip']).not.toHaveBeenCalled();
    });
  });

  describe('createWorkerCsvContent', () => {
    it('should create CSV content from workers', () => {
      const workers = [mockWorkerEntity as WorkerEntity];
      jest.spyOn(service as any, 'formatWorkerForCsv').mockReturnValue({
        'Project ID': 'project-1',
        ENV_VAR: 'value',
      });
      jest
        .spyOn(service as any, 'createCsvString')
        .mockReturnValue('csv content');

      const result = service['createWorkerCsvContent'](workers);

      expect(service['formatWorkerForCsv']).toHaveBeenCalledWith(
        mockWorkerEntity,
      );
      expect(service['createCsvString']).toHaveBeenCalledWith(
        ['Project ID', 'ENV_VAR'],
        [{ 'Project ID': 'project-1', ENV_VAR: 'value' }],
      );
      expect(result).toBe('csv content');
    });

    it('should return empty string for empty workers array', () => {
      const result = service['createWorkerCsvContent']([]);
      expect(result).toBe('');
    });
  });

  describe('createJobConfigCsvContent', () => {
    it('should create CSV content from job configs', () => {
      jest
        .spyOn(service as any, 'createCsvString')
        .mockReturnValue('csv content');

      const result = service['createJobConfigCsvContent'](mockJobConfigData);

      expect(service['createCsvString']).toHaveBeenCalledWith(
        Object.keys(mockJobConfigData[0]),
        mockJobConfigData,
      );
      expect(result).toBe('csv content');
    });

    it('should return empty string for empty job configs array', () => {
      const result = service['createJobConfigCsvContent']([]);
      expect(result).toBe('');
    });
  });

  describe('createCsvString', () => {
    it('should create properly formatted CSV string', () => {
      const headers = ['Name', 'Value', 'Description'];
      const data = [
        { Name: 'Test', Value: 'test-value', Description: 'A test item' },
        {
          Name: 'Item with, comma',
          Value: 'value',
          Description: 'Has "quotes"',
        },
      ];

      const result = service['createCsvString'](headers, data);

      const expectedCsv = [
        'Name,Value,Description',
        'Test,test-value,A test item',
        '"Item with, comma",value,"Has ""quotes"""',
        '',
      ].join('\n');

      expect(result).toBe(expectedCsv);
    });

    it('should handle empty values', () => {
      const headers = ['Name', 'Value'];
      const data = [
        { Name: 'Test', Value: null },
        { Name: '', Value: undefined },
      ];

      const result = service['createCsvString'](headers, data);

      const expectedCsv = ['Name,Value', 'Test,', ',', ''].join('\n');
      expect(result).toBe(expectedCsv);
    });
  });

  describe('createNewZipWithCsv', () => {
    it('should create new zip file with CSV content', async () => {
      const csvContent = 'csv content';
      const fileName = 'test.csv';
      const zipPath = '/path/to/zip.zip';

      await service['createNewZipWithCsv'](csvContent, fileName, zipPath);

      expect(mockFs.createWriteStream).toHaveBeenCalledWith(zipPath);
      expect(mockArchiver).toHaveBeenCalledWith('zip', { zlib: { level: 9 } });
    });
  });

  describe('createNewZipWithCsv - Additional Edge Cases', () => {
    it('should handle write stream creation errors', async () => {
      const csvContent = 'csv content';
      const fileName = 'test.csv';
      const zipPath = '/invalid/path/test.zip';

      mockFs.createWriteStream.mockImplementation(() => {
        throw new Error('Failed to create write stream');
      });

      await expect(
        service['createNewZipWithCsv'](csvContent, fileName, zipPath),
      ).rejects.toThrow('Failed to create write stream');
    });

    it('should resolve when archive emits close event', async () => {
      const csvContent = 'csv content';
      const fileName = 'test.csv';
      const zipPath = '/path/to/test.zip';

      const mockOutput = {
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'close') {
            // Simulate close event
            setTimeout(() => callback(), 10);
          }
        }),
      };

      const mockArchiveInstance = {
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
        on: jest.fn(),
        pointer: jest.fn().mockReturnValue(1024), // Add pointer method
      };

      mockFs.createWriteStream.mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchiveInstance as any);

      await service['createNewZipWithCsv'](csvContent, fileName, zipPath);

      expect(mockArchiveInstance.pipe).toHaveBeenCalledWith(mockOutput);
      expect(mockArchiveInstance.append).toHaveBeenCalledWith(csvContent, {
        name: `configuration data/${fileName}`,
      });
      expect(mockArchiveInstance.finalize).toHaveBeenCalled();
    });
  });

  describe('addToExistingZip', () => {
    it('should add file to existing zip using AdmZip', async () => {
      const csvContent = 'csv content';
      const fileName = 'test.csv';
      const zipPath = '/path/to/zip.zip';

      const mockZipInstance = {
        addFile: jest.fn(),
        writeZip: jest.fn(),
      };
      mockAdmZip.mockImplementation(() => mockZipInstance as any);

      await service['addToExistingZip'](csvContent, fileName, zipPath);

      expect(mockAdmZip).toHaveBeenCalledWith(zipPath);
      expect(mockZipInstance.addFile).toHaveBeenCalledWith(
        `configuration data/${fileName}`,
        Buffer.from(csvContent, 'utf8'),
      );
      expect(mockZipInstance.writeZip).toHaveBeenCalledWith(zipPath);
    });

    it('should fallback to createNewZipWithCsv when AdmZip fails', async () => {
      const csvContent = 'csv content';
      const fileName = 'test.csv';
      const zipPath = '/path/to/zip.zip';

      const mockZipInstance = {
        addFile: jest.fn().mockImplementation(() => {
          throw new Error('AdmZip error');
        }),
        writeZip: jest.fn(),
      };
      mockAdmZip.mockImplementation(() => mockZipInstance as any);

      const createNewZipSpy = jest
        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service['addToExistingZip'](csvContent, fileName, zipPath);

      expect(mockZipInstance.addFile).toHaveBeenCalled();
      expect(createNewZipSpy).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipPath,
      );
    });
  });

  describe('formatWorkerForCsv', () => {
    it('should format worker data for CSV', () => {
      jest.spyOn(service as any, 'filterEnvVariables').mockReturnValue({
        DATABASE_URL: MASK_VALUE,
        DEBUG_MODE: 'true',
      });

      const result = service['formatWorkerForCsv'](
        mockWorkerEntity as WorkerEntity,
      );

      expect(result).toEqual({
        'Project ID': 'project-1',
        DATABASE_URL: MASK_VALUE,
        DEBUG_MODE: 'true',
      });
    });

    it('should handle worker with empty project ID', () => {
      const worker = { ...mockWorkerEntity, projectId: '' };
      jest.spyOn(service as any, 'filterEnvVariables').mockReturnValue({});

      const result = service['formatWorkerForCsv'](worker as WorkerEntity);

      expect(result).toEqual({ 'Project ID': '' });
    });

    it('should handle worker with null project ID', () => {
      const worker = { ...mockWorkerEntity, projectId: null };
      jest.spyOn(service as any, 'filterEnvVariables').mockReturnValue({});

      const result = service['formatWorkerForCsv'](
        worker as unknown as WorkerEntity,
      );

      expect(result).toEqual({ 'Project ID': '' });
    });

    it('should handle worker with undefined project ID', () => {
      const worker = { ...mockWorkerEntity, projectId: undefined };
      jest.spyOn(service as any, 'filterEnvVariables').mockReturnValue({});

      const result = service['formatWorkerForCsv'](
        worker as unknown as WorkerEntity,
      );

      expect(result).toEqual({ 'Project ID': '' });
    });
  });

  describe('filterEnvVariables', () => {
    // Mock constants for testing
    const mockAllowedKeywords = ['database', 'debug', 'log'];
    const mockSensitivePatterns = ['PASSWORD', 'KEY', 'SECRET'];

    beforeEach(() => {
      (ALLOWED_KEYWORDS as any) = mockAllowedKeywords;
      (SENSITIVE_PATTERNS as any) = mockSensitivePatterns;
    });

    it('should filter and mask environment variables correctly', () => {
      const envVariables = {
        DATABASE_URL: 'postgres://localhost:5432/db',
        API_KEY: 'secret-key',
        DEBUG_MODE: 'true',
        LOG_LEVEL: 'info',
        RANDOM_CONFIG: 'value', // Should be filtered out
        lowercase_var: 'value', // Should be filtered out
      };

      jest
        .spyOn(service as any, 'isConfigurationVariable')
        .mockImplementation((key: string) =>
          ['DATABASE_URL', 'API_KEY', 'DEBUG_MODE', 'LOG_LEVEL'].includes(key),
        );
      jest
        .spyOn(service as any, 'containsSensitiveData')
        .mockImplementation((key: string) =>
          ['DATABASE_URL', 'API_KEY'].includes(key),
        );

      const result = service['filterEnvVariables'](envVariables);

      expect(result).toEqual({
        DATABASE_URL: MASK_VALUE,
        API_KEY: MASK_VALUE,
        DEBUG_MODE: 'true',
        LOG_LEVEL: 'info',
      });
    });

    it('should return empty object for null/undefined env variables', () => {
      expect(service['filterEnvVariables'](null as any)).toEqual({});
      expect(service['filterEnvVariables'](undefined as any)).toEqual({});
      expect(service['filterEnvVariables']('not an object' as any)).toEqual({});
    });
  });

  describe('isConfigurationVariable', () => {
    beforeEach(() => {
      (ALLOWED_KEYWORDS as any) = ['database', 'debug', 'log'];
    });

    it('should return true for uppercase variables containing allowed keywords', () => {
      expect(service['isConfigurationVariable']('DATABASE_URL')).toBe(true);
      expect(service['isConfigurationVariable']('DEBUG_MODE')).toBe(true);
      expect(service['isConfigurationVariable']('LOG_LEVEL')).toBe(true);
    });

    it('should return false for lowercase variables', () => {
      expect(service['isConfigurationVariable']('database_url')).toBe(false);
      expect(service['isConfigurationVariable']('Debug_Mode')).toBe(false);
    });

    it('should return false for variables not containing allowed keywords', () => {
      expect(service['isConfigurationVariable']('RANDOM_CONFIG')).toBe(false);
      expect(service['isConfigurationVariable']('API_KEY')).toBe(false);
    });
  });

  describe('containsSensitiveData', () => {
    beforeEach(() => {
      (SENSITIVE_PATTERNS as any) = ['PASSWORD', 'KEY', 'SECRET'];
    });

    it('should return true for keys containing sensitive patterns', () => {
      expect(service['containsSensitiveData']('API_KEY')).toBe(true);
      expect(service['containsSensitiveData']('DATABASE_PASSWORD')).toBe(true);
      expect(service['containsSensitiveData']('SECRET_TOKEN')).toBe(true);
    });

    it('should return false for keys not containing sensitive patterns', () => {
      expect(service['containsSensitiveData']('DATABASE_URL')).toBe(false);
      expect(service['containsSensitiveData']('DEBUG_MODE')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(service['containsSensitiveData']('api_key')).toBe(true);
      expect(service['containsSensitiveData']('Password')).toBe(true);
    });
  });

  describe('generateConfigurationDataCsv', () => {
    it('should generate CSV for worker configuration data', async () => {
      const mockWorkerDetails = [
        { worker_id: 'worker-1' },
        { worker_id: 'worker-2' },
      ];
      const payload = {
        zipLocation: '/path/to/zip',
        otherMetrics: ['Configuration Data', 'Logs'],
      };
      const traceId = 'test-trace-id';

      mockDataSource.query.mockResolvedValue(mockWorkerDetails);
      jest
        .spyOn(service as any, 'generateWorkerCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationDataCsv({
        traceId,
        payload,
      });

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
      );
      expect(service['generateWorkerCsv']).toHaveBeenCalledWith(
        ['worker-1', 'worker-2'],
        payload,
      );
      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
    });

    it('should not generate CSV when Configuration Data is not in otherMetrics', async () => {
      const mockWorkerDetails = [
        { worker_id: 'worker-1' },
        { worker_id: 'worker-2' },
      ];
      const payload = {
        zipLocation: '/path/to/zip',
        otherMetrics: ['Logs', 'Metrics'], // No 'Configuration Data'
      };
      const traceId = 'test-trace-id';

      mockDataSource.query.mockResolvedValue(mockWorkerDetails);
      const generateWorkerCsvSpy = jest
        .spyOn(service as any, 'generateWorkerCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationDataCsv({
        traceId,
        payload,
      });

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
      );
      expect(generateWorkerCsvSpy).not.toHaveBeenCalled();
      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
    });

    it('should not generate CSV when no worker IDs found', async () => {
      const payload = {
        zipLocation: '/path/to/zip',
        otherMetrics: ['Configuration Data'],
      };
      const traceId = 'test-trace-id';

      mockDataSource.query.mockResolvedValue([]); // No workers
      const generateWorkerCsvSpy = jest
        .spyOn(service as any, 'generateWorkerCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationDataCsv({
        traceId,
        payload,
      });

      expect(generateWorkerCsvSpy).not.toHaveBeenCalled();
      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
    });
  });

  describe('generateConfigurationJobCsv', () => {
    it('should not create CSV file when no data found', async () => {
      const traceId = 'test-trace-id';
      const payload = {
        zipLocation: '/path/to/zip',
        startDate: '2023-01-01',
        endDate: '2023-12-31',
        otherMetrics: ['Configuration Data'],
      };

      mockDataSource.query.mockResolvedValue([]);
      jest
        .spyOn(service as any, 'createJobConfigCsvFile')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationJobCsv({
        traceId,
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(service['createJobConfigCsvFile']).not.toHaveBeenCalled();
    });
  });

  // High coverage test cases for lines 97-98, 156-157, 228-244, 265-266, 291-295, 394, 399-427
  describe('generateWorkerCsv - Error Handling (Lines 97-98)', () => {
    it('should handle worker repository errors and throw descriptive error', async () => {
      const workerIds = ['worker-1', 'worker-2'];
      const payload = { zipLocation: '/path/to/zip' };
      const dbError = new Error('Database connection failed');

      mockWorkerRepo.find.mockRejectedValue(dbError);

      await expect(
        service['generateWorkerCsv'](workerIds, payload),
      ).rejects.toThrow(
        'Failed to generate worker CSV data: Database connection failed',
      );

      expect(mockWorkerRepo.find).toHaveBeenCalledWith({
        where: { workerId: expect.anything() },
        select: ['workerId', 'projectId', 'envVariables'],
      });
    });

    it('should handle CSV creation errors and throw descriptive error', async () => {
      const workerIds = ['worker-1'];
      const payload = { zipLocation: '/path/to/zip' };
      const workers = [
        { workerId: 'worker-1', projectId: 'project-1', envVariables: {} },
      ];

      mockWorkerRepo.find.mockResolvedValue(workers as WorkerEntity[]);
      jest
        .spyOn(service as any, 'createWorkerCsvContent')
        .mockImplementation(() => {
          throw new Error('CSV formatting failed');
        });

      await expect(
        service['generateWorkerCsv'](workerIds, payload),
      ).rejects.toThrow(
        'Failed to generate worker CSV data: CSV formatting failed',
      );
    });

    it('should handle addCsvToZip errors and throw descriptive error', async () => {
      const workerIds = ['worker-1'];
      const payload = { zipLocation: '/path/to/zip' };
      const workers = [
        { workerId: 'worker-1', projectId: 'project-1', envVariables: {} },
      ];

      mockWorkerRepo.find.mockResolvedValue(workers as WorkerEntity[]);
      jest
        .spyOn(service as any, 'createWorkerCsvContent')
        .mockReturnValue('csv,content');
      jest
        .spyOn(service as any, 'addCsvToZip')
        .mockRejectedValue(new Error('Zip operation failed'));

      await expect(
        service['generateWorkerCsv'](workerIds, payload),
      ).rejects.toThrow(
        'Failed to generate worker CSV data: Zip operation failed',
      );
    });
  });

  describe('generateJobConfigCsv - Error Handling (Lines 156-157)', () => {
    it('should handle database query errors and throw descriptive error', async () => {
      const projectIds = ['project-1', 'project-2'];
      const payload = {
        zipLocation: '/path/to/zip',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };
      const queryError = new Error('SQL syntax error');

      mockDataSource.query.mockRejectedValue(queryError);

      await expect(
        service['generateJobConfigCsv'](projectIds, payload),
      ).rejects.toThrow('Failed to fetch job config details: SQL syntax error');

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [payload.startDate, payload.endDate],
      );
    });

    it('should handle CSV content creation errors and throw descriptive error', async () => {
      const projectIds = ['project-1'];
      const payload = { zipLocation: '/path/to/zip' };
      const queryResult = [
        { 'Project Id': 'project-1', 'Project Name': 'Test' },
      ];

      mockDataSource.query.mockResolvedValue(queryResult);
      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockImplementation(() => {
          throw new Error('CSV content creation failed');
        });

      await expect(
        service['generateJobConfigCsv'](projectIds, payload),
      ).rejects.toThrow(
        'Failed to fetch job config details: CSV content creation failed',
      );
    });

    it('should handle zip file creation errors during job config CSV generation', async () => {
      const projectIds = ['project-1'];
      const payload = { zipLocation: '/path/to/zip' };
      const queryResult = [
        { 'Project Id': 'project-1', 'Project Name': 'Test' },
      ];

      mockDataSource.query.mockResolvedValue(queryResult);
      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockReturnValue('csv,content');
      jest
        .spyOn(service as any, 'addCsvToZip')
        .mockRejectedValue(new Error('Zip creation failed'));

      await expect(
        service['generateJobConfigCsv'](projectIds, payload),
      ).rejects.toThrow(
        'Failed to fetch job config details: Zip creation failed',
      );
    });
  });

  describe('addCsvToZip - Path and File Handling (Lines 228-244)', () => {
    it('should handle zip path ending with .zip extension', async () => {
      const csvContent = 'header1,header2\nvalue1,value2';
      const fileName = 'test.csv';
      const zipLocation = '/path/to/bundle.zip';

      (mockFs.promises.access as jest.Mock).mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'addToExistingZip')
        .mockResolvedValue(undefined);

      await service['addCsvToZip'](csvContent, fileName, zipLocation);

      expect(mockFs.promises.mkdir).toHaveBeenCalledWith('/path/to', {
        recursive: true,
      });
      expect(mockFs.promises.access).toHaveBeenCalledWith(
        '/path/to/bundle.zip',
      );
      expect(service['addToExistingZip']).toHaveBeenCalledWith(
        csvContent,
        fileName,
        '/path/to/bundle.zip',
      );
    });

    it('should construct zip path when location does not end with .zip', async () => {
      const csvContent = 'header1,header2\nvalue1,value2';
      const fileName = 'test.csv';
      const zipLocation = '/path/to/directory';

      (mockFs.promises.access as jest.Mock).mockRejectedValue(
        new Error('File not found'),
      );
      jest
        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service['addCsvToZip'](csvContent, fileName, zipLocation);

      const expectedZipPath = path.join(zipLocation, 'support-bundle.zip');
      expect(mockFs.promises.mkdir).toHaveBeenCalledWith('/path/to/directory', {
        recursive: true,
      });
      expect(mockFs.promises.access).toHaveBeenCalledWith(expectedZipPath);
      expect(service['createNewZipWithCsv']).toHaveBeenCalledWith(
        csvContent,
        fileName,
        expectedZipPath,
      );
    });

    it('should call addToExistingZip when zip file exists', async () => {
      const csvContent = 'test,data';
      const fileName = 'test.csv';
      const zipLocation = '/path/to/existing.zip';

      (mockFs.promises.access as jest.Mock).mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'addToExistingZip')
        .mockResolvedValue(undefined);

      await service['addCsvToZip'](csvContent, fileName, zipLocation);

      expect(service['addToExistingZip']).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipLocation,
      );
    });

    it('should call createNewZipWithCsv when zip file does not exist', async () => {
      const csvContent = 'test,data';
      const fileName = 'test.csv';
      const zipLocation = '/path/to/new.zip';

      (mockFs.promises.access as jest.Mock).mockRejectedValue(
        new Error('ENOENT'),
      );
      jest
        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service['addCsvToZip'](csvContent, fileName, zipLocation);

      expect(service['createNewZipWithCsv']).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipLocation,
      );
    });

    it('should create directory structure recursively', async () => {
      const csvContent = 'test,data';
      const fileName = 'test.csv';
      const zipLocation = '/deep/nested/path/bundle.zip';

      (mockFs.promises.access as jest.Mock).mockRejectedValue(
        new Error('ENOENT'),
      );
      jest
        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service['addCsvToZip'](csvContent, fileName, zipLocation);

      expect(mockFs.promises.mkdir).toHaveBeenCalledWith('/deep/nested/path', {
        recursive: true,
      });
    });

    it('should handle directory creation errors gracefully', async () => {
      const csvContent = 'test,data';
      const fileName = 'test.csv';
      const zipLocation = '/invalid/path/bundle.zip';

      const dirError = new Error('Permission denied');
      (mockFs.promises.mkdir as jest.Mock).mockRejectedValue(dirError);

      await expect(
        service['addCsvToZip'](csvContent, fileName, zipLocation),
      ).rejects.toThrow('Permission denied');

      expect(mockFs.promises.mkdir).toHaveBeenCalledWith('/invalid/path', {
        recursive: true,
      });
    });
  });

  describe('createNewZipWithCsv - Archive Error Handling (Lines 265-266)', () => {
    it('should handle archive errors and reject promise with error details', async () => {
      const csvContent = 'header1,header2\nvalue1,value2';
      const fileName = 'test.csv';
      const zipPath = '/path/to/bundle.zip';

      const mockOutput = { on: jest.fn() };
      const mockArchiveInstance = {
        on: jest.fn(),
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
        pointer: jest.fn().mockReturnValue(1024),
      };

      // Use jest.spyOn to override the createWriteStream mock for this test
      jest
        .spyOn(mockFs, 'createWriteStream')
        .mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchiveInstance as any);

      const archiveError = new Error('Compression algorithm failed');
      mockArchiveInstance.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(archiveError);
        }
      });

      await expect(
        service['createNewZipWithCsv'](csvContent, fileName, zipPath),
      ).rejects.toThrow('Compression algorithm failed');

      expect(mockArchiveInstance.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
    });

    it('should handle different types of archive errors', async () => {
      const csvContent = 'test,content';
      const fileName = 'test.csv';
      const zipPath = '/path/to/bundle.zip';

      const mockOutput = { on: jest.fn() };
      const mockArchiveInstance = {
        on: jest.fn(),
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
      };

      // Use jest.spyOn to override the createWriteStream mock for this test
      jest
        .spyOn(mockFs, 'createWriteStream')
        .mockReturnValue(mockOutput as any);
      mockArchiver.mockReturnValue(mockArchiveInstance as any);

      const compressionError = new Error('Out of memory during compression');
      mockArchiveInstance.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(compressionError);
        }
      });

      await expect(
        service['createNewZipWithCsv'](csvContent, fileName, zipPath),
      ).rejects.toThrow('Out of memory during compression');
    });
  });

  describe('addToExistingZip - Fallback Mechanism (Lines 291-295)', () => {
    it('should log error and fallback to archiver when AdmZip fails', async () => {
      const csvContent = 'header,value\ntest,data';
      const fileName = 'test.csv';
      const zipPath = '/path/to/existing.zip';

      const mockZipInstance = {
        addFile: jest.fn(),
        writeZip: jest.fn(),
      };
      const admZipError = new Error('AdmZip parsing failed');

      mockAdmZip.mockImplementation(() => {
        throw admZipError;
      });

      jest
        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');
      const loggerLogSpy = jest.spyOn(service['logger'], 'log');

      await service['addToExistingZip'](csvContent, fileName, zipPath);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error adding CSV to existing zip with AdmZip: AdmZip parsing failed',
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Falling back to archiver-based approach...',
      );
      expect(service['createNewZipWithCsv']).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipPath,
      );
    });

    it('should fallback when AdmZip writeZip method fails', async () => {
      const csvContent = 'test,data';
      const fileName = 'test.csv';
      const zipPath = '/path/to/existing.zip';

      const mockZipInstance = {
        addFile: jest.fn(),
        writeZip: jest.fn().mockImplementation(() => {
          throw new Error('Write operation failed');
        }),
      };

      mockAdmZip.mockImplementation(() => mockZipInstance as any);
      jest
        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service['addToExistingZip'](csvContent, fileName, zipPath);

      expect(mockZipInstance.addFile).toHaveBeenCalledWith(
        'configuration data/test.csv',
        expect.any(Buffer),
      );
      expect(service['createNewZipWithCsv']).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipPath,
      );
    });

    it('should fallback when AdmZip addFile method fails', async () => {
      const csvContent = 'test,data';
      const fileName = 'test.csv';
      const zipPath = '/path/to/existing.zip';

      const mockZipInstance = {
        addFile: jest.fn().mockImplementation(() => {
          throw new Error('Add file operation failed');
        }),
        writeZip: jest.fn(),
      };

      mockAdmZip.mockImplementation(() => mockZipInstance as any);
      jest
        .spyOn(service as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await service['addToExistingZip'](csvContent, fileName, zipPath);

      expect(service['createNewZipWithCsv']).toHaveBeenCalledWith(
        csvContent,
        fileName,
        zipPath,
      );
    });
  });

  describe('getJobConfigDetails - createJobConfigCsvFile Call (Line 394)', () => {
    it('should call createJobConfigCsvFile when results are found', async () => {
      const projectIds = ['project-1', 'project-2'];
      const payload = {
        zipLocation: '/path/to/zip',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      };
      const mockResults = [
        { 'Project Id': 'project-1', 'Project Name': 'Test Project 1' },
        { 'Project Id': 'project-2', 'Project Name': 'Test Project 2' },
      ];

      mockDataSource.query.mockResolvedValue(mockResults);
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      const result = await service['generateJobConfigCsv'](projectIds, payload);

      expect(result).toBeUndefined();
      expect(service['addCsvToZip']).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^job_config_details_\d+\.csv$/),
        payload.zipLocation,
      );
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM datamigrator.project p'),
        [payload.startDate, payload.endDate],
      );
    });

    it('should not call createJobConfigCsvFile when no results are found', async () => {
      const projectIds = ['project-1'];
      const payload = {
        zipLocation: '/path/to/zip',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      };

      mockDataSource.query.mockResolvedValue([]);
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      const result = await service['generateJobConfigCsv'](projectIds, payload);

      expect(result).toBeUndefined();
      expect(service['addCsvToZip']).not.toHaveBeenCalled();
    });
  });

  describe('getJobConfigDetails - Error Handling (Lines 399-400)', () => {
    it('should handle query errors and throw descriptive error message', async () => {
      const projectIds = ['project-1'];
      const payload = {
        zipLocation: '/path/to/zip',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      };
      const queryError = new Error('Connection timeout');

      mockDataSource.query.mockRejectedValue(queryError);

      await expect(
        service['generateJobConfigCsv'](projectIds, payload),
      ).rejects.toThrow(
        'Failed to fetch job config details: Connection timeout',
      );

      expect(mockDataSource.query).toHaveBeenCalledWith(expect.any(String), [
        payload.startDate,
        payload.endDate,
      ]);
    });

    it('should handle createJobConfigCsvFile errors and propagate them', async () => {
      const projectIds = ['project-1'];
      const payload = {
        zipLocation: '/path/to/zip',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      };
      const mockResults = [{ 'Project Id': 'project-1' }];
      const csvError = new Error('CSV file creation failed');

      mockDataSource.query.mockResolvedValue(mockResults);
      jest.spyOn(service as any, 'addCsvToZip').mockRejectedValue(csvError);

      await expect(
        service['generateJobConfigCsv'](projectIds, payload),
      ).rejects.toThrow(
        'Failed to fetch job config details: CSV file creation failed',
      );
    });
  });

  describe('createJobConfigCsvFile - Complete Flow (Lines 404-427)', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should successfully create job config CSV file with timestamp', async () => {
      const jobConfigs = [
        { 'Project Id': 'project-1', 'Project Name': 'Test Project' },
        { 'Project Id': 'project-2', 'Project Name': 'Another Project' },
      ];
      const payload = { zipLocation: '/path/to/zip' };

      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockReturnValue('csv,content\ndata,values');
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      await service['createJobConfigCsvFile'](jobConfigs, payload);

      expect(service['createJobConfigCsvContent']).toHaveBeenCalledWith(
        jobConfigs,
      );
      expect(service['addCsvToZip']).toHaveBeenCalledWith(
        'csv,content\ndata,values',
        'job_config_details_1234567890.csv',
        '/path/to/zip',
      );
    });

    it('should handle CSV content creation errors', async () => {
      const jobConfigs = [{ 'Project Id': 'project-1' }];
      const payload = { zipLocation: '/path/to/zip' };
      const contentError = new Error('Invalid data format');

      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockImplementation(() => {
          throw contentError;
        });

      await expect(
        service['createJobConfigCsvFile'](jobConfigs, payload),
      ).rejects.toThrow('Invalid data format');
    });

    it('should handle addCsvToZip errors and propagate them', async () => {
      const jobConfigs = [{ 'Project Id': 'project-1' }];
      const payload = { zipLocation: '/path/to/zip' };
      const zipError = new Error('Zip operation failed');

      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockReturnValue('csv,content');
      jest.spyOn(service as any, 'addCsvToZip').mockRejectedValue(zipError);

      await expect(
        service['createJobConfigCsvFile'](jobConfigs, payload),
      ).rejects.toThrow('Zip operation failed');
    });

    it('should handle empty jobConfigs array', async () => {
      const jobConfigs: any[] = [];
      const payload = { zipLocation: '/path/to/zip' };

      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockReturnValue('');
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      await service['createJobConfigCsvFile'](jobConfigs, payload);

      expect(service['createJobConfigCsvContent']).toHaveBeenCalledWith([]);
      expect(service['addCsvToZip']).toHaveBeenCalledWith(
        '',
        expect.stringContaining('job_config_details_'),
        '/path/to/zip',
      );
    });

    it('should handle zipLocation type assertion correctly', async () => {
      const jobConfigs = [{ 'Project Id': 'project-1' }];
      const payload = { zipLocation: '/path/to/zip' };

      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockReturnValue('csv,content');
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      await service['createJobConfigCsvFile'](jobConfigs, payload);

      expect(service['addCsvToZip']).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        '/path/to/zip',
      );
    });

    it('should generate unique filename with current timestamp', async () => {
      const jobConfigs = [{ 'Project Id': 'project-1' }];
      const payload = { zipLocation: '/path/to/zip' };
      const mockTimestamp = 9876543210;

      jest.spyOn(Date, 'now').mockReturnValue(mockTimestamp);
      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockReturnValue('csv,content');
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      await service['createJobConfigCsvFile'](jobConfigs, payload);

      expect(service['addCsvToZip']).toHaveBeenCalledWith(
        'csv,content',
        'job_config_details_9876543210.csv',
        '/path/to/zip',
      );
    });
  });
});
