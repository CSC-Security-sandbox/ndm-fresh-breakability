import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AsupStatsService, JobRunStats, ProjectStats } from './asup-stats.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

describe('AsupStatsService', () => {
  let service: AsupStatsService;
  let dataSource: jest.Mocked<DataSource>;

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AsupStatsService,
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    service = module.get<AsupStatsService>(AsupStatsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── recordJobRunStats ──────────────────────────────────────

  describe('recordJobRunStats', () => {
    const mockStats: JobRunStats = {
      jobRunId: 'run-1',
      jobConfigId: 'config-1',
      projectId: 'project-1',
      projectName: 'Test Project',
      jobType: 'discovery',
      protocol: 'NFS',
      sourceServerType: 'ONTAP',
      destinationServerType: 'n/a',
      fileCount: 100,
      sizeBytes: 5000,
    };

    it('should insert stats into asup_stats table', async () => {
      dataSource.query.mockResolvedValue(undefined);

      await service.recordJobRunStats(mockStats);

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      const [query, params] = dataSource.query.mock.calls[0];
      expect(query).toContain('INSERT INTO datamigrator.asup_stats');
      expect(query).toContain('ON CONFLICT (job_run_id) DO UPDATE');
      expect(params).toEqual([
        'run-1',
        'config-1',
        'project-1',
        'Test Project',
        'discovery',
        'NFS',
        'ONTAP',
        'n/a',
        100,
        5000,
      ]);
    });

    it('should pass null for optional fields when not provided', async () => {
      dataSource.query.mockResolvedValue(undefined);

      const stats: JobRunStats = {
        jobRunId: 'run-2',
        jobConfigId: 'config-2',
        projectId: 'project-2',
        projectName: 'Project 2',
        jobType: 'migration',
        protocol: '',
        fileCount: 50,
        sizeBytes: 2000,
      };

      await service.recordJobRunStats(stats);

      const params = dataSource.query.mock.calls[0][1];
      expect(params[5]).toBeNull(); // protocol
      expect(params[6]).toBeNull(); // sourceServerType
      expect(params[7]).toBeNull(); // destinationServerType (migration, no value)
    });

    it('should set destinationServerType to n/a for discovery jobs without destination', async () => {
      dataSource.query.mockResolvedValue(undefined);

      const stats: JobRunStats = {
        jobRunId: 'run-3',
        jobConfigId: 'config-3',
        projectId: 'project-3',
        projectName: 'Project 3',
        jobType: 'discovery',
        protocol: 'SMB',
        fileCount: 10,
        sizeBytes: 500,
      };

      await service.recordJobRunStats(stats);

      const params = dataSource.query.mock.calls[0][1];
      expect(params[7]).toBe('n/a'); // discovery default
    });

    it('should throw on database error', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));

      await expect(service.recordJobRunStats(mockStats)).rejects.toThrow(
        'connection refused',
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ─── getUntransmittedStatsGroupedByProject ──────────────────

  describe('getUntransmittedStatsGroupedByProject', () => {
    it('should return empty array when no untransmitted records', async () => {
      dataSource.query.mockResolvedValue([]);

      const result = await service.getUntransmittedStatsGroupedByProject();

      expect(result).toEqual([]);
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      const query = dataSource.query.mock.calls[0][0] as string;
      expect(query).toContain('WHERE transmitted = FALSE');
    });

    it('should group rows by project', async () => {
      dataSource.query.mockResolvedValue([
        {
          project_id: 'p1',
          project_name: 'Project One',
          job_config_id: 'jc1',
          job_type: 'discovery',
          protocol: 'NFS',
          source_server_type: 'ONTAP',
          destination_server_type: 'n/a',
          total_file_count: '200',
          total_size_bytes: '10000',
          job_run_count: '2',
        },
        {
          project_id: 'p1',
          project_name: 'Project One',
          job_config_id: 'jc2',
          job_type: 'migration',
          protocol: 'NFS',
          source_server_type: 'ONTAP',
          destination_server_type: 'ANF',
          total_file_count: '150',
          total_size_bytes: '8000',
          job_run_count: '1',
        },
      ]);

      const result = await service.getUntransmittedStatsGroupedByProject();

      expect(result).toHaveLength(1);
      expect(result[0].projectId).toBe('p1');
      expect(result[0].jobs).toHaveLength(2);
      expect(result[0].totals.discoveredFileCount).toBe(200);
      expect(result[0].totals.discoveredSizeBytes).toBe(10000);
      expect(result[0].totals.migratedFileCount).toBe(150);
      expect(result[0].totals.migratedSizeBytes).toBe(8000);
      expect(result[0].totals.totalJobRuns).toBe(3);
    });

    it('should separate different projects', async () => {
      dataSource.query.mockResolvedValue([
        {
          project_id: 'p1',
          project_name: 'Project One',
          job_config_id: 'jc1',
          job_type: 'discovery',
          protocol: 'NFS',
          source_server_type: 'ONTAP',
          destination_server_type: 'n/a',
          total_file_count: '100',
          total_size_bytes: '5000',
          job_run_count: '1',
        },
        {
          project_id: 'p2',
          project_name: 'Project Two',
          job_config_id: 'jc3',
          job_type: 'migration',
          protocol: 'SMB',
          source_server_type: 'WindowsFS',
          destination_server_type: 'ANF',
          total_file_count: '50',
          total_size_bytes: '2000',
          job_run_count: '1',
        },
      ]);

      const result = await service.getUntransmittedStatsGroupedByProject();

      expect(result).toHaveLength(2);
      expect(result[0].projectId).toBe('p1');
      expect(result[1].projectId).toBe('p2');
    });

    it('should count cutover as migrated in totals', async () => {
      dataSource.query.mockResolvedValue([
        {
          project_id: 'p1',
          project_name: 'Project One',
          job_config_id: 'jc1',
          job_type: 'cutover',
          protocol: 'NFS',
          source_server_type: 'ONTAP',
          destination_server_type: 'ANF',
          total_file_count: '75',
          total_size_bytes: '3000',
          job_run_count: '1',
        },
      ]);

      const result = await service.getUntransmittedStatsGroupedByProject();

      expect(result[0].totals.migratedFileCount).toBe(75);
      expect(result[0].totals.migratedSizeBytes).toBe(3000);
      expect(result[0].totals.discoveredFileCount).toBe(0);
    });

    it('should default protocol to UNKNOWN and serverType to Unknown', async () => {
      dataSource.query.mockResolvedValue([
        {
          project_id: 'p1',
          project_name: 'Project',
          job_config_id: 'jc1',
          job_type: 'discovery',
          protocol: null,
          source_server_type: null,
          destination_server_type: null,
          total_file_count: '10',
          total_size_bytes: '500',
          job_run_count: '1',
        },
      ]);

      const result = await service.getUntransmittedStatsGroupedByProject();

      expect(result[0].jobs[0].protocol).toBe('UNKNOWN');
      expect(result[0].jobs[0].sourceServerType).toBe('Unknown');
      expect(result[0].jobs[0].destinationServerType).toBe('n/a');
    });
  });

  // ─── markAsTransmitted ──────────────────────────────────────

  describe('markAsTransmitted', () => {
    it('should update records created before cutoff and return count', async () => {
      dataSource.query.mockResolvedValue({ rowCount: 5 });
      const cutoff = new Date('2026-06-14T00:00:00Z');

      const count = await service.markAsTransmitted(cutoff);

      expect(count).toBe(5);
      const query = dataSource.query.mock.calls[0][0] as string;
      expect(query).toContain('SET transmitted = TRUE');
      expect(query).toContain('WHERE transmitted = FALSE AND created_at <= $1');
      expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [cutoff]);
    });

    it('should return 0 when no records to update', async () => {
      dataSource.query.mockResolvedValue({ rowCount: 0 });

      const count = await service.markAsTransmitted(new Date());

      expect(count).toBe(0);
    });

    it('should return 0 when rowCount is missing', async () => {
      dataSource.query.mockResolvedValue({});

      const count = await service.markAsTransmitted(new Date());

      expect(count).toBe(0);
    });
  });

  // ─── getUntransmittedCount ──────────────────────────────────

  describe('getUntransmittedCount', () => {
    it('should return count of untransmitted records', async () => {
      dataSource.query.mockResolvedValue([{ count: '10' }]);

      const count = await service.getUntransmittedCount();

      expect(count).toBe(10);
    });

    it('should return 0 when no untransmitted records', async () => {
      dataSource.query.mockResolvedValue([{ count: '0' }]);

      const count = await service.getUntransmittedCount();

      expect(count).toBe(0);
    });

    it('should return 0 when result is empty', async () => {
      dataSource.query.mockResolvedValue([]);

      const count = await service.getUntransmittedCount();

      expect(count).toBe(0);
    });
  });
});
