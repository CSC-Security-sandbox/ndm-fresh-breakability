import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { ConfigurationDataCsvGenerationActivity } from './config-data-csv-generation.activity';
import { WorkerEntity } from 'src/entities/worker.entity';

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    access: jest.fn(),
  },
  createWriteStream: jest.fn(),
}));

jest.mock('adm-zip');
jest.mock('archiver');

describe('ConfigurationDataCsvGenerationActivity', () => {
  let activity: ConfigurationDataCsvGenerationActivity;
  let workerRepository: jest.Mocked<Repository<WorkerEntity>>;
  let dataSource: jest.Mocked<DataSource>;
  let mockLogger: jest.Mocked<Logger>;

  const mockWorkerData: WorkerEntity[] = [
    {
      workerId: 'worker-1',
      projectId: 'project-123',
      envVariables: {
        DATABASE_URL: 'postgres://localhost',
        API_KEY: 'secret-key',
        DEBUG_MODE: 'true',
        LOG_LEVEL: 'info',
      },
    } as WorkerEntity,
    {
      workerId: 'worker-2',
      projectId: 'project-123',
      envVariables: {
        DATABASE_URL: 'postgres://remote',
        CACHE_SIZE: '1000',
        TIMEOUT: '30',
      },
    } as WorkerEntity,
  ];

  const mockJobConfigData = [
    {
      'Project Id': 'project-123',
      'Project Name': 'Test Project',
      'Config Id': 'config-1',
      'Config Name': 'Test Config',
      'File Server Hostname': 'server1.example.com',
      'Job Type': 'COPY',
      'Job Status': 'ACTIVE',
    },
    {
      'Project Id': 'project-456',
      'Project Name': 'Another Project',
      'Config Id': 'config-2',
      'Config Name': 'Another Config',
      'File Server Hostname': 'server2.example.com',
      'Job Type': 'MOVE',
      'Job Status': 'INACTIVE',
    },
  ];

  beforeEach(async () => {
    const mockWorkerRepository = {
      find: jest.fn(),
    };

    const mockDataSource = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigurationDataCsvGenerationActivity,
        {
          provide: getRepositoryToken(WorkerEntity),
          useValue: mockWorkerRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    activity = module.get<ConfigurationDataCsvGenerationActivity>(
      ConfigurationDataCsvGenerationActivity,
    );
    workerRepository = module.get(getRepositoryToken(WorkerEntity));
    dataSource = module.get(DataSource);
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as any;

    (activity as any).logger = mockLogger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateConfigurationDataCsv', () => {
    it('should generate worker CSV when worker IDs exist and Configuration Data is requested', async () => {
      const payload = {
        projectWorkerMap: [
          { workerIds: ['worker-1', 'worker-2'] },
          { workerIds: ['worker-3'] },
        ],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/test.zip',
      };

      workerRepository.find.mockResolvedValue(mockWorkerData);
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.access as jest.Mock).mockRejectedValue(
        new Error('File not found'),
      );

      const mockArchiver = {
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
        pointer: jest.fn().mockReturnValue(1024),
        on: jest.fn((event, callback) => {
          if (event === 'error') return;
          if (event === 'close') setTimeout(callback, 0);
        }),
      };

      const mockWriteStream = {
        on: jest.fn((event, callback) => {
          if (event === 'close') setTimeout(callback, 0);
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
      const archiver = require('archiver');
      archiver.mockReturnValue(mockArchiver);

      const result = await activity.generateConfigurationDataCsv({
        traceId: 'test-trace',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(workerRepository.find).toHaveBeenCalledWith({
        where: { workerId: expect.anything() },
        select: ['workerId', 'projectId', 'envVariables'],
      });
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Generating CSV for 3 workers',
      );
    });

    it('should skip generation when no worker IDs exist', async () => {
      const payload = {
        projectWorkerMap: [{ workerIds: [] }],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/test.zip',
      };

      const result = await activity.generateConfigurationDataCsv({
        traceId: 'test-trace',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(workerRepository.find).not.toHaveBeenCalled();
    });

    it('should skip generation when Configuration Data is not in otherMetrics', async () => {
      const payload = {
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
        otherMetrics: ['Other Metric'],
        zipLocation: '/tmp/test.zip',
      };

      const result = await activity.generateConfigurationDataCsv({
        traceId: 'test-trace',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(workerRepository.find).not.toHaveBeenCalled();
    });

    it('should handle malformed payload gracefully', async () => {
      const payload = {
        projectWorkerMap: null,
        otherMetrics: undefined,
        zipLocation: '/tmp/test.zip',
      };

      const result = await activity.generateConfigurationDataCsv({
        traceId: 'test-trace',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(workerRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('generateConfigurationJobCsv', () => {
    it('should generate job config CSV when project IDs exist and Configuration Data is requested', async () => {
      const payload = {
        projectWorkerMap: [
          { projectId: 'project-123' },
          { projectId: 'project-456' },
        ],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/test.zip',
      };

      dataSource.query.mockResolvedValue(mockJobConfigData);
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.access as jest.Mock).mockRejectedValue(
        new Error('File not found'),
      );

      const mockArchiver = {
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
        pointer: jest.fn().mockReturnValue(2048),
        on: jest.fn((event, callback) => {
          if (event === 'error') return;
          if (event === 'close') setTimeout(callback, 0);
        }),
      };

      const mockWriteStream = {
        on: jest.fn((event, callback) => {
          if (event === 'close') setTimeout(callback, 0);
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
      const archiver = require('archiver');
      archiver.mockReturnValue(mockArchiver);

      const result = await activity.generateConfigurationJobCsv({
        traceId: 'test-trace',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['project-123', 'project-456'],
      );
      expect(mockLogger.log).toHaveBeenCalledWith('Found 2 job config records');
    });

    it('should handle empty query results', async () => {
      const payload = {
        projectWorkerMap: [{ projectId: 'nonexistent-project' }],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/test.zip',
      };

      dataSource.query.mockResolvedValue([]);

      const result = await activity.generateConfigurationJobCsv({
        traceId: 'test-trace',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(dataSource.query).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith('Found 0 job config records');
    });

    it('should handle database query errors', async () => {
      const payload = {
        projectWorkerMap: [{ projectId: 'project-123' }],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/test.zip',
      };

      const dbError = new Error('Database connection failed');
      dataSource.query.mockRejectedValue(dbError);

      await expect(
        activity.generateConfigurationJobCsv({
          traceId: 'test-trace',
          payload,
        }),
      ).rejects.toThrow(
        'Failed to fetch job config details: Database connection failed',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error fetching job config details:',
        dbError,
      );
    });
  });

  describe('CSV Content Generation', () => {
    it('should generate proper CSV content for workers with environment variables', () => {
      const csvContent = (activity as any).createWorkerCsvContent(
        mockWorkerData,
      );

      expect(csvContent).toContain(
        'Project ID,DATABASE_URL,DEBUG_MODE,LOG_LEVEL',
      );
      expect(csvContent).toContain(
        'project-123,postgres://localhost,true,info',
      );
      expect(csvContent).toContain('project-123,postgres://remote,,');
    });

    it('should handle workers with no environment variables', () => {
      const workersWithoutEnv = [
        {
          workerId: 'worker-empty',
          projectId: 'project-123',
          envVariables: {},
        } as WorkerEntity,
      ];

      const csvContent = (activity as any).createWorkerCsvContent(
        workersWithoutEnv,
      );

      expect(csvContent).toContain('Project ID');
      expect(csvContent).toContain('project-123');
    });

    it('should mask sensitive environment variables', () => {
      const workersWithSensitiveData = [
        {
          workerId: 'worker-sensitive',
          projectId: 'project-123',
          envVariables: {
            DATABASE_PASSWORD: 'secret123',
            API_TOKEN: 'token456',
            PUBLIC_URL: 'https://example.com',
          },
        } as WorkerEntity,
      ];

      const csvContent = (activity as any).createWorkerCsvContent(
        workersWithSensitiveData,
      );

      expect(csvContent).toContain('***MASKED***');
      expect(csvContent).not.toContain('secret123');
      expect(csvContent).not.toContain('token456');
    });

    it('should escape CSV special characters properly', () => {
      const workersWithSpecialChars = [
        {
          workerId: 'worker-special',
          projectId: 'project-123',
          envVariables: {
            DESCRIPTION: 'Contains, comma and "quotes"',
            MULTILINE: 'Line 1\nLine 2',
          },
        } as WorkerEntity,
      ];

      const csvContent = (activity as any).createWorkerCsvContent(
        workersWithSpecialChars,
      );

      expect(csvContent).toContain('"Contains, comma and ""quotes"""');
      expect(csvContent).toContain('"Line 1\nLine 2"');
    });

    it('should generate proper CSV content for job configurations', () => {
      const csvContent = (activity as any).createJobConfigCsvContent(
        mockJobConfigData,
      );

      expect(csvContent).toContain('Project Id,Project Name,Config Id');
      expect(csvContent).toContain('project-123,Test Project,config-1');
      expect(csvContent).toContain('project-456,Another Project,config-2');
    });

    it('should return empty string for empty data arrays', () => {
      const workerCsvContent = (activity as any).createWorkerCsvContent([]);
      const jobCsvContent = (activity as any).createJobConfigCsvContent([]);

      expect(workerCsvContent).toBe('');
      expect(jobCsvContent).toBe('');
    });
  });

  describe('Zip File Operations', () => {
    it('should create new zip file when it does not exist', async () => {
      (fs.promises.access as jest.Mock).mockRejectedValue(
        new Error('File not found'),
      );
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);

      const mockArchiver = {
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
        pointer: jest.fn().mockReturnValue(1024),
        on: jest.fn((event, callback) => {
          if (event === 'error') return;
          if (event === 'close') setTimeout(callback, 0);
        }),
      };

      const mockWriteStream = {
        on: jest.fn((event, callback) => {
          if (event === 'close') setTimeout(callback, 0);
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
      const archiver = require('archiver');
      archiver.mockReturnValue(mockArchiver);

      await (activity as any).addCsvToZip(
        'test content',
        'test.csv',
        '/tmp/test.zip',
      );

      expect(fs.createWriteStream).toHaveBeenCalledWith('/tmp/test.zip');
      expect(mockArchiver.append).toHaveBeenCalledWith('test content', {
        name: 'configuration data/test.csv',
      });
    });

    it('should add to existing zip file when it exists', async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);

      const mockZip = {
        addFile: jest.fn(),
        writeZip: jest.fn(),
      };

      (AdmZip as jest.MockedClass<typeof AdmZip>).mockImplementation(
        () => mockZip as any,
      );

      await (activity as any).addCsvToZip(
        'test content',
        'test.csv',
        '/tmp/existing.zip',
      );

      expect(AdmZip).toHaveBeenCalledWith('/tmp/existing.zip');
      expect(mockZip.addFile).toHaveBeenCalledWith(
        'configuration data/test.csv',
        Buffer.from('test content', 'utf8'),
      );
      expect(mockZip.writeZip).toHaveBeenCalledWith('/tmp/existing.zip');
    });

    it('should handle AdmZip errors and fallback to archiver', async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);

      const mockZip = {
        addFile: jest.fn().mockImplementation(() => {
          throw new Error('AdmZip error');
        }),
        writeZip: jest.fn(),
      };

      (AdmZip as jest.MockedClass<typeof AdmZip>).mockImplementation(
        () => mockZip as any,
      );

      const mockArchiver = {
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
        pointer: jest.fn().mockReturnValue(1024),
        on: jest.fn((event, callback) => {
          if (event === 'error') return;
          if (event === 'close') setTimeout(callback, 0);
        }),
      };

      const mockWriteStream = {
        on: jest.fn((event, callback) => {
          if (event === 'close') setTimeout(callback, 0);
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
      const archiver = require('archiver');
      archiver.mockReturnValue(mockArchiver);

      await (activity as any).addCsvToZip(
        'test content',
        'test.csv',
        '/tmp/existing.zip',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error adding CSV to existing zip'),
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Falling back to archiver-based approach...',
      );
    });

    it('should handle different zip location formats', async () => {
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.access as jest.Mock).mockRejectedValue(
        new Error('File not found'),
      );

      const directoryPath = '/tmp/support-bundle/';

      await (activity as any).addCsvToZip(
        'test content',
        'test.csv',
        directoryPath,
      );

      expect(fs.promises.mkdir).toHaveBeenCalledWith('/tmp/support-bundle', {
        recursive: true,
      });
    });
  });

  describe('Environment Variable Filtering', () => {
    it('should filter only uppercase configuration variables with allowed keywords', () => {
      const envVars = {
        DATABASE_URL: 'postgres://localhost',
        api_key: 'should-be-filtered-out',
        DEBUG_MODE: 'true',
        random_var: 'also-filtered',
        LOG_LEVEL: 'info',
        notConfigVar: 'filtered',
      };

      const filtered = (activity as any).filterEnvVariables(envVars);

      expect(filtered).toHaveProperty('DATABASE_URL');
      expect(filtered).toHaveProperty('DEBUG_MODE');
      expect(filtered).toHaveProperty('LOG_LEVEL');
      expect(filtered).not.toHaveProperty('api_key');
      expect(filtered).not.toHaveProperty('random_var');
      expect(filtered).not.toHaveProperty('notConfigVar');
    });

    it('should mask sensitive patterns', () => {
      const envVars = {
        DATABASE_PASSWORD: 'secret123',
        API_TOKEN: 'token456',
        SECRET_KEY: 'key789',
        PUBLIC_URL: 'https://example.com',
      };

      const filtered = (activity as any).filterEnvVariables(envVars);

      expect(filtered.DATABASE_PASSWORD).toBe('***MASKED***');
      expect(filtered.API_TOKEN).toBe('***MASKED***');
      expect(filtered.SECRET_KEY).toBe('***MASKED***');
      expect(filtered.PUBLIC_URL).toBe('https://example.com');
    });

    it('should handle null or undefined environment variables', () => {
      expect((activity as any).filterEnvVariables(null)).toEqual({});
      expect((activity as any).filterEnvVariables(undefined)).toEqual({});
      expect((activity as any).filterEnvVariables({})).toEqual({});
    });

    it('should handle non-object environment variables', () => {
      expect((activity as any).filterEnvVariables('string')).toEqual({});
      expect((activity as any).filterEnvVariables(123)).toEqual({});
      expect((activity as any).filterEnvVariables([])).toEqual({});
    });
  });

  describe('CSV Content Generation Edge Cases', () => {
    it('should handle CSV special characters properly', () => {
      const testData = [
        {
          field1: 'Contains, comma',
          field2: 'Contains "quotes"',
          field3: 'Contains\nnewline',
          field4: 'Normal value',
          field5: null,
          field6: undefined,
        },
      ];

      const csvContent = (activity as any).createCsvString(
        ['field1', 'field2', 'field3', 'field4', 'field5', 'field6'],
        testData,
      );

      expect(csvContent).toContain('"Contains, comma"');
      expect(csvContent).toContain('"Contains ""quotes"""');
      expect(csvContent).toContain('"Contains\nnewline"');
      expect(csvContent).toContain('Normal value');
      expect(csvContent).toContain(',,');
    });

    it('should handle empty and whitespace values correctly', () => {
      const testData = [
        {
          empty: '',
          space: ' ',
          tabs: '\t',
          mixed: '  \t  ',
        },
      ];

      const csvContent = (activity as any).createCsvString(
        ['empty', 'space', 'tabs', 'mixed'],
        testData,
      );

      expect(csvContent).toContain(', ,\t,  \t  ');
    });

    it('should handle Unicode and special characters', () => {
      const testData = [
        {
          unicode: '你好世界',
          emoji: '🚀💻📊',
          accents: 'café naïve résumé',
          symbols: '™®©€£¥',
        },
      ];

      const csvContent = (activity as any).createCsvString(
        ['unicode', 'emoji', 'accents', 'symbols'],
        testData,
      );

      expect(csvContent).toContain(
        '你好世界,🚀💻📊,café naïve résumé,™®©€£¥',
      );
    });

    it('should handle very long field values', () => {
      const longValue = 'a'.repeat(5000);
      const testData = [{ longField: longValue }];

      const csvContent = (activity as any).createCsvString(
        ['longField'],
        testData,
      );
      expect(csvContent).toContain(longValue);
    });

    it('should handle mixed data types', () => {
      const testData = [
        {
          string: 'text',
          number: 42,
          boolean: true,
          falsy: false,
          zero: 0,
          object: { key: 'value' },
          array: [1, 2, 3],
        },
      ];

      const csvContent = (activity as any).createCsvString(
        ['string', 'number', 'boolean', 'falsy', 'zero', 'object', 'array'],
        testData,
      );

      expect(csvContent).toContain(
        'text,42,true,false,0,[object Object],1,2,3',
      );
    });
  });

  describe('Advanced Environment Variable Filtering', () => {
    it('should filter sensitive patterns case-insensitively', () => {
      const envVars = {
        DATABASE_PASSWORD: 'secret123',
        api_secret: 'should-be-filtered-anyway',
        SECRET_API_KEY: 'masked',
        TOKEN_VALUE: 'token123',
        private_key: 'key456',
        KEY_STORE_PASSWORD: 'store_pass',
        normal_config: 'normal',
        DEBUG_MODE: 'true',
      };

      const filtered = (activity as any).filterEnvVariables(envVars);

      expect(filtered.DATABASE_PASSWORD).toBe('***MASKED***');
      expect(filtered.SECRET_API_KEY).toBe('***MASKED***');
      expect(filtered.TOKEN_VALUE).toBe('***MASKED***');
      expect(filtered.KEY_STORE_PASSWORD).toBe('***MASKED***');
      expect(filtered.DEBUG_MODE).toBe('true');
      expect(filtered).not.toHaveProperty('api_secret');
      expect(filtered).not.toHaveProperty('private_key');
      expect(filtered).not.toHaveProperty('normal_config');
    });

    it('should handle configuration variable validation edge cases', () => {
      const testCases = [
        { key: 'DATABASE_URL', expected: true },
        { key: 'database_url', expected: false },
        { key: 'Database_Url', expected: false },
        { key: 'API_KEY_VALUE', expected: true },
        { key: 'RANDOM_VARIABLE', expected: false },
        { key: 'DEBUG_CONFIG_MODE', expected: true },
        { key: 'LOG_DEBUG_LEVEL', expected: true },
        { key: 'CACHE_API_TIMEOUT', expected: true },
        { key: '', expected: false },
        { key: 'A', expected: false },
      ];

      testCases.forEach(({ key, expected }) => {
        expect((activity as any).isConfigurationVariable(key)).toBe(expected);
      });
    });

    it('should handle sensitive data detection edge cases', () => {
      const testCases = [
        { key: 'PASSWORD', expected: true },
        { key: 'SECRET', expected: true },
        { key: 'TOKEN', expected: true },
        { key: 'KEY', expected: true },
        { key: 'MY_PASSWORD_FIELD', expected: true },
        { key: 'API_SECRET_VALUE', expected: true },
        { key: 'AUTH_TOKEN_BEARER', expected: true },
        { key: 'PRIVATE_KEY_PATH', expected: true },
        { key: 'KEYSTORE', expected: true },
        { key: 'PASSPHRASE', expected: false },
        { key: 'NORMAL_CONFIG', expected: false },
        { key: 'DEBUG_MODE', expected: false },
        { key: '', expected: false },
      ];

      testCases.forEach(({ key, expected }) => {
        expect((activity as any).containsSensitiveData(key)).toBe(expected);
      });
    });
  });

  describe('Zip File Operations Advanced Tests', () => {
    let mockArchiver: any;
    let mockWriteStream: any;
    let mockAdmZip: any;

    beforeEach(() => {
      mockArchiver = {
        pipe: jest.fn(),
        append: jest.fn(),
        finalize: jest.fn(),
        pointer: jest.fn().mockReturnValue(1024),
        on: jest.fn(),
      };

      mockWriteStream = {
        on: jest.fn(),
      };

      mockAdmZip = {
        addFile: jest.fn(),
        writeZip: jest.fn(),
        getEntries: jest.fn().mockReturnValue([]),
      };

      // Mock archiver
      const archiverModule = require('archiver');
      archiverModule.mockReturnValue(mockArchiver);

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
      (AdmZip as jest.MockedClass<typeof AdmZip>).mockImplementation(
        () => mockAdmZip,
      );
    });

    it('should handle directory-style zip locations', async () => {
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.access as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') setTimeout(callback, 0);
          return mockWriteStream;
        },
      );

      await (activity as any).addCsvToZip(
        'content',
        'test.csv',
        '/tmp/bundle/',
      );

      expect(fs.promises.mkdir).toHaveBeenCalledWith('/tmp/bundle', {
        recursive: true,
      });
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        '/tmp/bundle/support-bundle.zip',
      );
    });

    it('should handle AdmZip fallback scenarios', async () => {
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);

      const admZipError = new Error('AdmZip failed');
      mockAdmZip.addFile.mockImplementation(() => {
        throw admZipError;
      });

      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'close') setTimeout(callback, 0);
          return mockWriteStream;
        },
      );

      const createNewZipSpy = jest
        .spyOn(activity as any, 'createNewZipWithCsv')
        .mockResolvedValue(undefined);

      await (activity as any).addCsvToZip(
        'content',
        'test.csv',
        '/tmp/test.zip',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error adding CSV to existing zip with AdmZip'),
      );
      expect(createNewZipSpy).toHaveBeenCalled();
    });

    it('should handle archiver error events', async () => {
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.access as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      const archiverError = new Error('Archiver failed');
      mockArchiver.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'error') {
            setTimeout(() => callback(archiverError), 0);
          }
          return mockArchiver;
        },
      );

      await expect(
        (activity as any).addCsvToZip('content', 'test.csv', '/tmp/test.zip'),
      ).rejects.toThrow('Archiver failed');
    });

    it('should handle write stream errors', async () => {
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.access as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      );

      const streamError = new Error('Write stream failed');
      mockWriteStream.on.mockImplementation(
        (event: string, callback: Function) => {
          if (event === 'error') {
            setTimeout(() => callback(streamError), 0);
          }
          return mockWriteStream;
        },
      );

      await expect(
        (activity as any).addCsvToZip('content', 'test.csv', '/tmp/test.zip'),
      ).rejects.toThrow('Write stream failed');
    });
  });

  describe('Integration and Performance Tests', () => {
    it('should handle large datasets efficiently', async () => {
      const largeWorkerIds = Array.from(
        { length: 1000 },
        (_, i) => `worker-${i}`,
      );
      const largeWorkerData = largeWorkerIds.map((workerId, i) => ({
        workerId,
        projectId: `project-${i % 10}`,
        envVariables: {
          DATABASE_URL: `postgres://db${i}.example.com`,
          API_KEY: `key-${i}`,
          LOG_LEVEL: 'info',
          CACHE_SIZE: `${1000 + i}`,
        },
      })) as WorkerEntity[];

      const payload = {
        projectWorkerMap: [{ workerIds: largeWorkerIds }],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/large-test.zip',
      };

      workerRepository.find.mockResolvedValue(largeWorkerData);
      jest.spyOn(activity as any, 'addCsvToZip').mockResolvedValue(undefined);

      const result = await activity.generateConfigurationDataCsv({
        traceId: 'large-test',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Generating CSV for 1000 workers',
      );
    });

    it('should handle complex job configuration queries', async () => {
      const complexJobData = Array.from({ length: 500 }, (_, i) => ({
        'Project Id': `project-${i}`,
        'Project Name': `Project ${i}`,
        'Project Description':
          i % 3 === 0 ? null : `Description for project ${i}`,
        'Config Id': `config-${i}`,
        'Config Name': `Config ${i}`,
        'File Server Id': `fs-${i}`,
        'File Server Hostname': `server${i}.example.com`,
        'File Server Username': `user${i}`,
        'File Server Protocol': i % 2 === 0 ? 'SMB' : 'NFS',
        'File Server Type': i % 2 === 0 ? 'Windows' : 'Linux',
        'File Server Protocol Version': i % 2 === 0 ? '3.0' : '4.1',
        'Export Path Source': `/source/path/${i}`,
        'Volume Path': `/volume/path/${i}`,
        'JobConfig Id': `job-${i}`,
        'Job Type': i % 3 === 0 ? 'COPY' : i % 3 === 1 ? 'MOVE' : 'SYNC',
        'Job Status': i % 2 === 0 ? 'ACTIVE' : 'INACTIVE',
        'Exclude File Patterns': `*.tmp,*.log${i}`,
      }));

      const payload = {
        projectWorkerMap: Array.from({ length: 100 }, (_, i) => ({
          projectId: `project-${i}`,
        })),
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/complex-test.zip',
      };

      dataSource.query.mockResolvedValue(complexJobData);
      jest.spyOn(activity as any, 'addCsvToZip').mockResolvedValue(undefined);

      const result = await activity.generateConfigurationJobCsv({
        traceId: 'complex-test',
        payload,
      });

      expect(result).toBe(
        'Configuration data CSV generation completed successfully',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Found 500 job config records',
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle worker repository errors', async () => {
      const payload = {
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/test.zip',
      };

      const dbError = new Error('Repository error');
      workerRepository.find.mockRejectedValue(dbError);

      await expect(
        activity.generateConfigurationDataCsv({
          traceId: 'test-trace',
          payload,
        }),
      ).rejects.toThrow('Failed to generate worker CSV data: Repository error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error generating worker CSV data:',
        dbError,
      );
    });

    it('should handle job config database errors', async () => {
      const payload = {
        projectWorkerMap: [{ projectId: 'project-123' }],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/tmp/test.zip',
      };

      const dbError = new Error('Database query failed');
      dataSource.query.mockRejectedValue(dbError);

      await expect(
        activity.generateConfigurationJobCsv({
          traceId: 'test-trace',
          payload,
        }),
      ).rejects.toThrow(
        'Failed to fetch job config details: Database query failed',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error fetching job config details:',
        dbError,
      );
    });

    it('should handle zip creation errors', async () => {
      const payload = {
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
        otherMetrics: ['Configuration Data'],
        zipLocation: '/invalid/path/test.zip',
      };

      workerRepository.find.mockResolvedValue(mockWorkerData);
      (fs.promises.mkdir as jest.Mock).mockRejectedValue(
        new Error('Permission denied'),
      );

      await expect(
        activity.generateConfigurationDataCsv({
          traceId: 'test-trace',
          payload,
        }),
      ).rejects.toThrow(
        'Failed to generate worker CSV data: Permission denied',
      );
    });

    it('should handle null/undefined edge cases in formatWorkerForCsv', () => {
      const edgeCaseWorkers = [
        {
          workerId: 'worker-null',
          projectId: null,
          envVariables: null,
        },
        {
          workerId: 'worker-undefined',
          projectId: undefined,
          envVariables: undefined,
        },
        {
          workerId: 'worker-empty',
          projectId: '',
          envVariables: {},
        },
      ] as WorkerEntity[];

      edgeCaseWorkers.forEach((worker) => {
        const formatted = (activity as any).formatWorkerForCsv(worker);
        expect(formatted).toHaveProperty('Project ID');
        expect(typeof formatted['Project ID']).toBe('string');
      });
    });

    it('should handle empty or invalid input arrays', () => {
      expect((activity as any).createWorkerCsvContent([])).toBe('');
      expect((activity as any).createWorkerCsvContent(null)).toBe('');
      expect((activity as any).createWorkerCsvContent(undefined)).toBe('');

      expect((activity as any).createJobConfigCsvContent([])).toBe('');
      expect((activity as any).createJobConfigCsvContent(null)).toBe('');
      expect((activity as any).createJobConfigCsvContent(undefined)).toBe('');
    });
  });
});
