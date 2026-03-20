import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AsupSchedulerService } from './asup-scheduler.service';
import { AsupStatsService } from './asup-stats.service';
import { AsupPackagerService } from './asup-packager.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

// Mock fs/promises for readFile in transmitAsupMetrics
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('mock-archive-data')),
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

// axios is loaded via require('axios') in the service file.
// We mock the entire module — jest.mock is hoisted above imports.
jest.mock('axios', () => {
  const mockPut = jest.fn().mockResolvedValue({ status: 200 });
  return { put: mockPut, default: { put: mockPut } };
}, { virtual: true });

describe('AsupSchedulerService', () => {
  let service: AsupSchedulerService;
  let dataSource: jest.Mocked<DataSource>;
  let configService: jest.Mocked<ConfigService>;
  let asupStatsService: jest.Mocked<AsupStatsService>;
  let asupPackagerService: jest.Mocked<AsupPackagerService>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let mockAxiosPut: jest.Mock;

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  beforeEach(async () => {
    // Get reference to the mocked axios.put
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const axios = require('axios');
    mockAxiosPut = axios.put;

    dataSource = {
      query: jest.fn(),
    } as any;

    configService = {
      get: jest.fn().mockReturnValue('https://support.netapp.com/put/AsupPut'),
    } as any;

    asupStatsService = {
      getUntransmittedCount: jest.fn(),
      markAsTransmitted: jest.fn(),
      getUntransmittedStatsGroupedByProject: jest.fn(),
      recordJobRunStats: jest.fn(),
    } as any;

    asupPackagerService = {
      packageAsupPayload: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AsupSchedulerService,
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: configService },
        { provide: AsupStatsService, useValue: asupStatsService },
        { provide: AsupPackagerService, useValue: asupPackagerService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    service = module.get<AsupSchedulerService>(AsupSchedulerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── getAsupSettings ────────────────────────────────────────

  describe('getAsupSettings', () => {
    it('should return enabled=true when DB has asup_enabled=true', async () => {
      dataSource.query.mockResolvedValue([
        { setting_key: 'asup_enabled', setting_value: 'true', updated_at: new Date('2026-03-01') },
      ]);

      const result = await service.getAsupSettings();

      expect(result.enabled).toBe(true);
      expect(result.lastUpdated).toBeDefined();
    });

    it('should return enabled=false when DB has asup_enabled=false', async () => {
      dataSource.query.mockResolvedValue([
        { setting_key: 'asup_enabled', setting_value: 'false', updated_at: null },
      ]);

      const result = await service.getAsupSettings();

      expect(result.enabled).toBe(false);
      expect(result.lastUpdated).toBeNull();
    });

    it('should return enabled=false when no row exists in DB', async () => {
      dataSource.query.mockResolvedValue([]);

      const result = await service.getAsupSettings();

      expect(result.enabled).toBe(false);
    });

    it('should return enabled=false on DB error', async () => {
      dataSource.query.mockRejectedValue(new Error('connection timeout'));

      const result = await service.getAsupSettings();

      expect(result.enabled).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ─── updateAsupSettings ─────────────────────────────────────

  describe('updateAsupSettings', () => {
    it('should update setting and return updated settings', async () => {
      // 1st call: UPDATE query
      dataSource.query.mockResolvedValueOnce(undefined);
      // 2nd call: SELECT query from getAsupSettings() read-back
      dataSource.query.mockResolvedValueOnce([
        { setting_key: 'asup_enabled', setting_value: 'true', updated_at: new Date('2026-03-01') },
      ]);

      const result = await service.updateAsupSettings(true, 'user-abc');

      expect(result.enabled).toBe(true);
      expect(result.lastUpdated).toBeDefined();
      expect(dataSource.query).toHaveBeenCalledTimes(2);
      const updateQuery = dataSource.query.mock.calls[0][0] as string;
      expect(updateQuery).toContain('UPDATE');
      expect(updateQuery).not.toContain('INSERT');
    });

    it('should pass null userId when not provided', async () => {
      // 1st call: UPDATE query
      dataSource.query.mockResolvedValueOnce(undefined);
      // 2nd call: SELECT query from getAsupSettings() read-back
      dataSource.query.mockResolvedValueOnce([
        { setting_key: 'asup_enabled', setting_value: 'false', updated_at: null },
      ]);

      await service.updateAsupSettings(false);

      const params = dataSource.query.mock.calls[0][1] as any[];
      expect(params[1]).toBeNull();
    });

    it('should throw on DB error', async () => {
      dataSource.query.mockRejectedValue(new Error('write failed'));

      await expect(
        service.updateAsupSettings(true, 'user-1'),
      ).rejects.toThrow('write failed');
    });
  });

  // ─── handleAsupTransmission ─────────────────────────────────

  describe('handleAsupTransmission', () => {
    it('should skip when no untransmitted records', async () => {
      dataSource.query.mockResolvedValueOnce([
        { setting_key: 'asup_enabled', setting_value: 'true', updated_at: null },
      ]);
      asupStatsService.getUntransmittedCount.mockResolvedValue(0);

      await service.handleAsupTransmission();

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('No untransmitted records'),
      );
      expect(asupPackagerService.packageAsupPayload).not.toHaveBeenCalled();
    });

    it('should skip when ASUP is disabled', async () => {
      asupStatsService.getUntransmittedCount.mockResolvedValue(5);
      dataSource.query.mockResolvedValue([
        { setting_key: 'asup_enabled', setting_value: 'false', updated_at: null },
      ]);

      await service.handleAsupTransmission();

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('ASUP is disabled'),
      );
      expect(asupPackagerService.packageAsupPayload).not.toHaveBeenCalled();
    });

    it('should transmit when ASUP is enabled and records exist', async () => {
      asupStatsService.getUntransmittedCount.mockResolvedValue(3);
      dataSource.query.mockResolvedValue([
        { setting_key: 'asup_enabled', setting_value: 'true', updated_at: null },
      ]);
      asupPackagerService.packageAsupPayload.mockResolvedValue({
        archivePath: '/tmp/asup-reports/asup-payload.7z',
        md5Checksum: 'abc123',
        headersMap: {},
        xmlContent: '<xml/>',
      });
      mockAxiosPut.mockResolvedValue({ status: 200 });
      asupStatsService.markAsTransmitted.mockResolvedValue(3);

      await service.handleAsupTransmission();

      expect(asupPackagerService.packageAsupPayload).toHaveBeenCalled();
      expect(asupStatsService.markAsTransmitted).toHaveBeenCalled();
    });

    it('should not throw on transmission error (catches internally)', async () => {
      asupStatsService.getUntransmittedCount.mockResolvedValue(1);
      dataSource.query.mockResolvedValue([
        { setting_key: 'asup_enabled', setting_value: 'true', updated_at: null },
      ]);
      asupPackagerService.packageAsupPayload.mockRejectedValue(
        new Error('packaging failed'),
      );

      await expect(service.handleAsupTransmission()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('packaging failed'),
      );
    });
  });

  // ─── transmitAsupMetrics ────────────────────────────────────

  describe('transmitAsupMetrics', () => {
    beforeEach(() => {
      asupPackagerService.packageAsupPayload.mockResolvedValue({
        archivePath: '/tmp/asup-reports/asup-payload.7z',
        md5Checksum: 'def456',
        headersMap: { 'X-Custom': 'value' },
        xmlContent: '<xml/>',
      });
    });

    it('should send PUT request and mark records as transmitted', async () => {
      mockAxiosPut.mockResolvedValue({ status: 200 });
      asupStatsService.markAsTransmitted.mockResolvedValue(2);

      await service.transmitAsupMetrics();

      expect(mockAxiosPut).toHaveBeenCalledTimes(1);
      const [url, , options] = mockAxiosPut.mock.calls[0];
      expect(url).toContain('asup-payload.7z');
      expect(options.headers['Content-Type']).toBe('application/x-7z-compressed');
      expect(options.headers['X-Netapp-Asup-Payload-Checksum']).toBe('def456');
      expect(options.headers['X-Custom']).toBe('value');
      expect(asupStatsService.markAsTransmitted).toHaveBeenCalled();
    });

    it('should not transmit when endpoint is not configured', async () => {
      // Create a new service instance with no endpoint
      const noEndpointConfigService = { get: jest.fn().mockReturnValue(undefined) } as any;
      const module = await Test.createTestingModule({
        providers: [
          AsupSchedulerService,
          { provide: DataSource, useValue: dataSource },
          { provide: ConfigService, useValue: noEndpointConfigService },
          { provide: AsupStatsService, useValue: asupStatsService },
          { provide: AsupPackagerService, useValue: asupPackagerService },
          { provide: LoggerFactory, useValue: mockLoggerFactory },
        ],
      }).compile();

      const svcNoEndpoint = module.get<AsupSchedulerService>(AsupSchedulerService);
      await svcNoEndpoint.transmitAsupMetrics();

      expect(mockAxiosPut).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('ASUP endpoint not set'),
      );
    });

    it('should retry on transmission failure', async () => {
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: () => void) => {
        fn();
        return 0;
      }) as any;

      mockAxiosPut
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ status: 200 });
      asupStatsService.markAsTransmitted.mockResolvedValue(1);

      await service.transmitAsupMetrics();

      expect(mockAxiosPut).toHaveBeenCalledTimes(3);
      expect(asupStatsService.markAsTransmitted).toHaveBeenCalled();
      global.setTimeout = originalSetTimeout;
    });

    it('should throw after all retries exhausted', async () => {
      // Mock setTimeout to resolve immediately (avoid real delays)
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: () => void) => {
        fn();
        return 0;
      }) as any;

      mockAxiosPut
        .mockRejectedValueOnce(new Error('persistent error'))
        .mockRejectedValueOnce(new Error('persistent error'))
        .mockRejectedValueOnce(new Error('persistent error'));

      let thrownError: Error | null = null;
      try {
        await service.transmitAsupMetrics();
      } catch (e) {
        thrownError = e as Error;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError!.message).toBe('persistent error');
      expect(mockAxiosPut).toHaveBeenCalledTimes(3);
      expect(asupStatsService.markAsTransmitted).not.toHaveBeenCalled();
      global.setTimeout = originalSetTimeout;
    });
  });
});
