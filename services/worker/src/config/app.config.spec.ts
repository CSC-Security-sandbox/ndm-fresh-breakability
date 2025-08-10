import { ConfigService } from '@nestjs/config';
import workerConfigFactory, { WorkersConfig } from './app.config';

describe('worker.config factory', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should return defaults when no env vars set', () => {
    const cfg = workerConfigFactory();

    // string and platform defaults
    expect(cfg.workerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(cfg.buildId).toBe('1.0.0');
    expect(cfg.baseWorkingPath).toBe('/mnt/datamigrate');
    expect(cfg.platform).toBe(process.platform);

    // connection defaults
    expect(cfg.connection).toEqual({
      workerConfigUrl: 'http://localhost:3002',
      workerReportServiceUrl: 'http://localhost:3003',
      workerJobServiceUrl: 'http://localhost:3006',
    });

    // health & pre-check
    expect(cfg.healthCheckInterval).toBe('5');
    expect(cfg.checkSpaceForPreCheck).toBe(false);

    // core operations (number parsing)
    expect(cfg.maxRetryCount).toBe(3);
    expect(cfg.operationTimeout).toBe(5000);
    expect(cfg.maxMigrationCommand).toBe(100);
    expect(cfg.maxScanCommand).toBe(500);
    expect(cfg.migrationTaskStreamLimit).toBe(100);
    expect(cfg.migrationChunkSize).toBe(1048576);
    expect(cfg.maxCommandConcurrency).toBe(100);

    // speed test defaults
    expect(cfg.speedTestFileName).toBe('1GB_zero_file.bin');
    expect(cfg.speedTestFileSize).toBe(1);
    expect(cfg.speedTestTimeout).toBe(120000);

    // redis & temporal
    expect(cfg.redisMemoryUsageThreshold).toBe(90);
    expect(cfg.maxActivityConcurrency).toBe(1);

    // thread pool defaults
    expect(cfg.thread).toEqual({
      threadBand: '1kb,1500;1mb,1000;10mb,100;100mb,10;1gb,1',
      threadCount: 5,
    });

    // metrics defaults
    expect(cfg.metrics).toEqual({
      versionsPathWindows: 'C:\\datamigrator\\conf\\versions.conf',
      versionsPathLinux: '/opt/datamigrator/conf/versions.conf',
    });
  });

  it('should pick up environment overrides correctly', () => {
    Object.assign(process.env, {
      WORKER_ID: 'custom-id',
      BUILD_ID: '2.3.4',
      BASE_WORKING_PATH: '/tmp/work',
      WORKER_CONFIG_URL: 'https://cfg',
      WORKER_REPORT_SERVICE_URL: 'https://rep',
      WORKER_JOB_SERVICE_URL: 'https://job',
      HEALTH_CHECK_INTERVAL: '42',
      CHECK_AVAILABLE_DISK_SPACE: 'true',
      MAX_OPERATION_RETRY: '7',
      MAX_MIGRATION_COMMAND: '77',
      MAX_SCAN_COMMAND: '88',
      MIGRATION_TASK_LIMIT: '99',
      CHUNK_SIZE: '1234',
      MAX_COMMAND_CONCURRENCY: '11',
      SPEED_TEST_FILE_NAME: 'zero.bin',
      SPEED_TEST_FILE_Size_GB: '2.5',
      SPEED_TEST_TIMEOUT: '500000',
      REDIS_MEM_USAGE_THRESHOLD: '45',
      JOB_TASK_ACTIVITY_CONCURRENCY: '9',
      THREAD_BANDS: 'X;Y',
      THREAD_COUNT: '42',
      VERSIONS_PATH_WINDOWS: 'C:\\my\\path\\versions.conf',
      VERSIONS_PATH_LINUX: '/your/path/versions.conf',
    });

    const cfg = workerConfigFactory();

    expect(cfg.workerId).toBe('custom-id');
    expect(cfg.buildId).toBe('2.3.4');
    expect(cfg.baseWorkingPath).toBe('/tmp/work');
    expect(cfg.connection.workerConfigUrl).toBe('https://cfg');
    expect(cfg.connection.workerReportServiceUrl).toBe('https://rep');
    expect(cfg.connection.workerJobServiceUrl).toBe('https://job');
    expect(cfg.healthCheckInterval).toBe('42');
    expect(cfg.checkSpaceForPreCheck).toBe(true);
    expect(cfg.maxRetryCount).toBe(7);
    expect(cfg.maxMigrationCommand).toBe(77);
    expect(cfg.maxScanCommand).toBe(88);
    expect(cfg.migrationTaskStreamLimit).toBe(99);
    expect(cfg.migrationChunkSize).toBe(1234);
    expect(cfg.maxCommandConcurrency).toBe(11);
    expect(cfg.speedTestFileName).toBe('zero.bin');
    expect(cfg.speedTestFileSize).toBe(2.5);
    expect(cfg.speedTestTimeout).toBe(500000);
    expect(cfg.redisMemoryUsageThreshold).toBe(45);
    expect(cfg.maxActivityConcurrency).toBe(9);
    expect(cfg.thread.threadBand).toBe('X;Y');
    expect(cfg.thread.threadCount).toBe(42);
    expect(cfg.metrics.versionsPathWindows).toBe('C:\\my\\path\\versions.conf');
    expect(cfg.metrics.versionsPathLinux).toBe('/your/path/versions.conf');
  });
});

describe('WorkersConfig helper', () => {
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeAll(() => {
    mockConfigService = {
      get: jest.fn((key: string) => `VAL:${key}`),
    } as any;

    // instantiate to set the static configService
    new WorkersConfig(mockConfigService);
  });

  it('should proxy to ConfigService.get with correct prefix', () => {
    expect(WorkersConfig.get('foo')).toBe('VAL:worker.foo');
    expect(mockConfigService.get).toHaveBeenCalledWith('worker.foo');
  });

  it('should handle nested keys', () => {
    expect(WorkersConfig.get('connection.workerConfigUrl'))
      .toBe('VAL:worker.connection.workerConfigUrl');
  });

  it('should handle metrics configuration keys', () => {
    expect(WorkersConfig.get('metrics.versionsPathWindows'))
      .toBe('VAL:worker.metrics.versionsPathWindows');
    expect(WorkersConfig.get('metrics.versionsPathLinux'))
      .toBe('VAL:worker.metrics.versionsPathLinux');
  });
});
