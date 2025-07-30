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
jest.mock('fs');
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

    // Setup mocks using direct instantiation approach
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

    // Instantiate service directly with mocks
    service = new ConfigurationDataCsvGenerationActivity(
      mockWorkerRepo,
      mockDataSource,
    );

    // Setup fs.promises mock with proper jest mocks
    const mockAccess = jest.fn().mockRejectedValue(new Error('File not found'));
    const mockMkdir = jest.fn().mockResolvedValue(undefined);

    mockFs.promises = {
      mkdir: mockMkdir,
      access: mockAccess,
    } as any;

    // Setup createWriteStream mock
    const mockWriteStream = {
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(callback, 0);
        }
        return mockWriteStream;
      }),
    };
    jest
      .spyOn(mockFs, 'createWriteStream')
      .mockImplementation(() => mockWriteStream as any);

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
  });

  describe('generateConfigurationDataCsv', () => {
    it('should generate worker CSV when workerIds exist and Configuration Data is included', async () => {
      const payload = {
        projectWorkerMap: [
          { workerIds: ['worker-1', 'worker-2'] },
          { workerIds: ['worker-3'] },
        ],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/path/to/zip',
      };

      mockWorkerRepo.find.mockResolvedValue([mockWorkerEntity as WorkerEntity]);
      jest
        .spyOn(service as any, 'generateWorkerCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationDataCsv({
        traceId: 'trace-1',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(service['generateWorkerCsv']).toHaveBeenCalledWith(
        ['worker-1', 'worker-2', 'worker-3'],
        payload,
      );
    });

    it('should not generate CSV when Configuration Data is not in otherMetrics', async () => {
      const payload = {
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
        otherMetrics: ['Other Metric'],
        zipLocation: '/path/to/zip',
      };

      jest
        .spyOn(service as any, 'generateWorkerCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationDataCsv({
        traceId: 'trace-1',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(service['generateWorkerCsv']).not.toHaveBeenCalled();
    });

    it('should not generate CSV when no workerIds exist', async () => {
      const payload = {
        projectWorkerMap: [{ workerIds: [] }],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/path/to/zip',
      };

      jest
        .spyOn(service as any, 'generateWorkerCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationDataCsv({
        traceId: 'trace-1',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(service['generateWorkerCsv']).not.toHaveBeenCalled();
    });
  });

  describe('generateConfigurationJobCsv', () => {
    it('should generate job config CSV when projectIds exist and Configuration Data is included', async () => {
      const payload = {
        projectWorkerMap: [
          { projectId: 'project-1' },
          { projectId: 'project-2' },
        ],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/path/to/zip',
      };

      jest
        .spyOn(service as any, 'generateJobConfigCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationJobCsv({
        traceId: 'trace-1',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(service['generateJobConfigCsv']).toHaveBeenCalledWith(
        ['project-1', 'project-2'],
        payload,
      );
    });

    it('should not generate CSV when Configuration Data is not in otherMetrics', async () => {
      const payload = {
        projectWorkerMap: [{ projectId: 'project-1' }],
        otherMetrics: ['Other Metric'],
        zipLocation: '/path/to/zip',
      };

      jest
        .spyOn(service as any, 'generateJobConfigCsv')
        .mockResolvedValue(undefined);

      const result = await service.generateConfigurationJobCsv({
        traceId: 'trace-1',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(service['generateJobConfigCsv']).not.toHaveBeenCalled();
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
      const payload = { zipLocation: '/path/to/zip' };

      mockDataSource.query.mockResolvedValue(mockJobConfigData);
      jest
        .spyOn(service as any, 'createJobConfigCsvContent')
        .mockReturnValue('csv content');
      jest.spyOn(service as any, 'addCsvToZip').mockResolvedValue(undefined);

      await service['generateJobConfigCsv'](projectIds, payload);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        projectIds,
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

      expect(result['Project ID']).toBe('');
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

  describe('getJobConfigDetails', () => {
    it('should fetch and process job config details successfully', async () => {
      const projectIds = ['project-1', 'project-2'];
      const payload = { zipLocation: '/path/to/zip' };

      mockDataSource.query.mockResolvedValue(mockJobConfigData);
      jest
        .spyOn(service as any, 'createJobConfigCsvFile')
        .mockResolvedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await service.getJobConfigDetails(projectIds, payload);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        projectIds,
      );
      expect(service['createJobConfigCsvFile']).toHaveBeenCalledWith(
        mockJobConfigData,
        payload,
      );
      expect(result).toEqual(mockJobConfigData);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Job Config Details:----',
        JSON.stringify(mockJobConfigData, null, 2),
      );

      consoleSpy.mockRestore();
    });

    it('should not create CSV file when no data found', async () => {
      const projectIds = ['project-1'];
      const payload = { zipLocation: '/path/to/zip' };

      mockDataSource.query.mockResolvedValue([]);
      jest
        .spyOn(service as any, 'createJobConfigCsvFile')
        .mockResolvedValue(undefined);

      const result = await service.getJobConfigDetails(projectIds, payload);

      expect(result).toEqual([]);
      expect(service['createJobConfigCsvFile']).not.toHaveBeenCalled();
    });
  });
});
