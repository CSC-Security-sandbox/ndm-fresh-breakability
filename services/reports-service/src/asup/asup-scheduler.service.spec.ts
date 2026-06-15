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
  stat: jest.fn().mockResolvedValue({ size: 1024 }),
}));

// Mock createReadStream from 'fs' for streaming PUT requests
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  const { Readable } = require('stream');
  return {
    ...actual,
    createReadStream: jest.fn(() => Readable.from([Buffer.from('mock-stream')])),
  };
});

jest.mock('7zip-bin', () => ({ path7za: '/usr/bin/7za' }), { virtual: true });

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
      getUntransmittedIds: jest.fn().mockResolvedValue(['id-1', 'id-2', 'id-3']),
      markAsTransmitted: jest.fn(),
      getUntransmittedStatsGroupedByProject: jest.fn(),
      recordJobRunStats: jest.fn(),
    } as any;

    asupPackagerService = {
      packageAsupPayload: jest.fn(),
      packageSupportBundlePayload: jest.fn(),
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

    it('should throw after all retries exhausted for ASUP metrics', async () => {
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

  // ─── transmitSupportBundle ──────────────────────────────────

  describe('transmitSupportBundle', () => {
    beforeEach(() => {
      mockAxiosPut.mockClear();
      mockAxiosPut.mockResolvedValue({ status: 200 });
      asupPackagerService.packageSupportBundlePayload.mockResolvedValue({
        archivePath: '/tmp/asup-reports/support-bundle-asup-123.7z',
        md5Checksum: 'sb-md5-abc',
        headersMap: { 'X-Netapp-Asup-Subject': 'NDM Support Bundle' },
        isLargePayload: false,
      });
      // Default stat returns small size (< 100MB threshold)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMocked = require('fs/promises');
      fsMocked.stat.mockResolvedValue({ size: 1024 });
    });

    it('should send a single streaming PUT for archive ≤ 100MB with no ISF chunk headers', async () => {
      mockAxiosPut.mockResolvedValue({ status: 200 });

      await service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip');

      expect(asupPackagerService.packageSupportBundlePayload).toHaveBeenCalledWith(
        'bundle.zip',
        '/generated-zips/bundle.zip',
      );
      expect(mockAxiosPut).toHaveBeenCalledTimes(1);
      const [url, , options] = mockAxiosPut.mock.calls[0];
      expect(url).toContain('support-bundle-asup-123.7z');
      expect(options.headers['Content-Type']).toBe('application/x-7z-compressed');
      expect(options.headers['Content-Length']).toBe('1024');
      expect(options.headers['X-Netapp-asup-chunk-number']).toBeUndefined();
      expect(options.headers['X-Netapp-asup-retransmit']).toBeUndefined();
      expect(options.headers['X-Netapp-asup-large']).toBeUndefined();
    });

    it('should send ISF chunked PUTs for archive > 100MB with retransmit=false on first attempt per chunk', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMocked = require('fs/promises');
      const TOTAL = 201 * 1024 * 1024;
      fsMocked.stat.mockResolvedValue({ size: TOTAL });
      mockAxiosPut.mockResolvedValue({ status: 200 });

      await service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip');

      // 201MB / 50MB = 5 chunks
      expect(mockAxiosPut).toHaveBeenCalledTimes(5);

      // First chunk
      const [, , opts0] = mockAxiosPut.mock.calls[0];
      expect(opts0.headers['X-Netapp-asup-chunk-number']).toBe('1');
      expect(opts0.headers['X-Netapp-asup-chunk-total']).toBe('5');
      expect(opts0.headers['X-Netapp-asup-large']).toBe('true');
      expect(opts0.headers['X-Netapp-asup-large-filename']).toBe('support-bundle-asup-123.7z');
      expect(opts0.headers['X-Netapp-asup-large-size']).toBe(String(TOTAL));
      expect(opts0.headers['X-Netapp-asup-retransmit']).toBe('false');

      // Last chunk
      const [, , opts4] = mockAxiosPut.mock.calls[4];
      expect(opts4.headers['X-Netapp-asup-chunk-number']).toBe('5');
      expect(opts4.headers['X-Netapp-asup-retransmit']).toBe('false');
    });

    it('should set X-Netapp-asup-retransmit=true on retry attempts for a chunk (Bug 4 fix)', async () => {
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: () => void) => { fn(); return 0; }) as any;

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMocked = require('fs/promises');
      fsMocked.stat.mockResolvedValue({ size: 201 * 1024 * 1024 });

      // Chunk 1: attempt 1 fails, attempt 2 (retry) succeeds; chunks 2–5 pass on first try
      mockAxiosPut
        .mockRejectedValueOnce(new Error('network error'))   // chunk 1, attempt 1
        .mockResolvedValueOnce({ status: 200 })              // chunk 1, attempt 2 (retry)
        .mockResolvedValueOnce({ status: 200 })              // chunk 2, attempt 1
        .mockResolvedValueOnce({ status: 200 })              // chunk 3, attempt 1
        .mockResolvedValueOnce({ status: 200 })              // chunk 4, attempt 1
        .mockResolvedValueOnce({ status: 200 });             // chunk 5, attempt 1

      await service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip');

      expect(mockAxiosPut).toHaveBeenCalledTimes(6);

      // First attempt for chunk 1: retransmit must be false
      const [, , firstAttempt] = mockAxiosPut.mock.calls[0];
      expect(firstAttempt.headers['X-Netapp-asup-retransmit']).toBe('false');
      expect(firstAttempt.headers['X-Netapp-asup-chunk-number']).toBe('1');

      // Retry attempt for chunk 1: retransmit must be true
      const [, , retryAttempt] = mockAxiosPut.mock.calls[1];
      expect(retryAttempt.headers['X-Netapp-asup-retransmit']).toBe('true');
      expect(retryAttempt.headers['X-Netapp-asup-chunk-number']).toBe('1');

      // Subsequent chunks on first attempt: retransmit must be false
      const [, , chunk2Opts] = mockAxiosPut.mock.calls[2];
      expect(chunk2Opts.headers['X-Netapp-asup-retransmit']).toBe('false');
      expect(chunk2Opts.headers['X-Netapp-asup-chunk-number']).toBe('2');

      global.setTimeout = originalSetTimeout;
    });

    it('should throw after all retries exhausted for a chunk', async () => {
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: () => void) => { fn(); return 0; }) as any;

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMocked = require('fs/promises');
      fsMocked.stat.mockResolvedValue({ size: 201 * 1024 * 1024 });

      mockAxiosPut
        .mockRejectedValueOnce(new Error('chunk failed'))
        .mockRejectedValueOnce(new Error('chunk failed'))
        .mockRejectedValueOnce(new Error('chunk failed'));

      await expect(
        service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip'),
      ).rejects.toThrow('chunk failed');

      expect(mockAxiosPut).toHaveBeenCalledTimes(3);
      global.setTimeout = originalSetTimeout;
    });

    it('should throw when single PUT fails for archive ≤ 100MB', async () => {
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: () => void) => { fn(); return 0; }) as any;

      mockAxiosPut.mockRejectedValue(new Error('connection refused'));

      await expect(
        service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip'),
      ).rejects.toThrow('connection refused');

      // Retry logic makes 3 attempts before throwing
      expect(mockAxiosPut).toHaveBeenCalledTimes(3);

      global.setTimeout = originalSetTimeout;
    });

    it('should merge packager headersMap and include standard ASUP headers in single PUT', async () => {
      mockAxiosPut.mockResolvedValue({ status: 200 });

      await service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip');

      const [, , options] = mockAxiosPut.mock.calls[0];
      // Standard headers
      expect(options.headers['Content-Type']).toBe('application/x-7z-compressed');
      expect(options.headers['X-ASUP-Source']).toBe('NDM');
      expect(options.headers['X-ASUP-Version']).toBe('1.3');
      expect(options.headers['X-Netapp-Asup-Payload-Checksum']).toBe('sb-md5-abc');
      // Packager headersMap merged in
      expect(options.headers['X-Netapp-Asup-Subject']).toBe('NDM Support Bundle');
    });

    it('should set correct X-Netapp-asup-chunk-size for each chunk including the smaller last chunk', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMocked = require('fs/promises');
      // 201MB → Math.ceil(201/50) = 5 chunks: [50MB, 50MB, 50MB, 50MB, 1MB]
      const TOTAL = 201 * 1024 * 1024;
      const CHUNK = 50 * 1024 * 1024;
      const lastSize = TOTAL - 4 * CHUNK; // 1MB
      fsMocked.stat.mockResolvedValue({ size: TOTAL });
      mockAxiosPut.mockResolvedValue({ status: 200 });

      await service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip');

      expect(mockAxiosPut).toHaveBeenCalledTimes(5);
      const [, , opts0] = mockAxiosPut.mock.calls[0];
      const [, , opts1] = mockAxiosPut.mock.calls[1];
      const [, , opts4] = mockAxiosPut.mock.calls[4];
      expect(opts0.headers['X-Netapp-asup-chunk-size']).toBe(String(CHUNK));
      expect(opts1.headers['X-Netapp-asup-chunk-size']).toBe(String(CHUNK));
      expect(opts4.headers['X-Netapp-asup-chunk-size']).toBe(String(lastSize));
      // X-Netapp-asup-chunk-filename must be present on every chunk
      expect(opts0.headers['X-Netapp-asup-chunk-filename']).toBe('support-bundle-asup-123.7z');
      expect(opts4.headers['X-Netapp-asup-chunk-filename']).toBe('support-bundle-asup-123.7z');
    });

    it('should throw when ASUP support bundle endpoint is not configured', async () => {
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
      const svc = module.get<AsupSchedulerService>(AsupSchedulerService);

      await expect(
        svc.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip'),
      ).rejects.toThrow('ASUP support bundle endpoint is not configured');
    });

    // ── archive cleanup (finally block) ──────────────────────────────────────

    it('should delete the .7z archive after successful single PUT (finally cleanup)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMocked = require('fs/promises');
      mockAxiosPut.mockResolvedValue({ status: 200 });

      await service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip');

      expect(fsMocked.unlink).toHaveBeenCalledWith(
        '/tmp/asup-reports/support-bundle-asup-123.7z',
      );
    });

    it('should delete the .7z archive even when single PUT transmission fails (finally cleanup)', async () => {
      // Bypass the 30s retry delay so the test does not time out
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: () => void) => { fn(); return 0; }) as any;

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMocked = require('fs/promises');
      mockAxiosPut.mockRejectedValue(new Error('network error'));

      await expect(
        service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip'),
      ).rejects.toThrow('network error');

      // Despite the error, unlink must still have been called
      expect(fsMocked.unlink).toHaveBeenCalledWith(
        '/tmp/asup-reports/support-bundle-asup-123.7z',
      );

      global.setTimeout = originalSetTimeout;
    });

    it('should warn (not throw) when archive unlink fails during cleanup, and still propagate original transmission error', async () => {
      // Bypass the 30s retry delay so the test does not time out
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: () => void) => { fn(); return 0; }) as any;

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMocked = require('fs/promises');
      mockAxiosPut.mockRejectedValue(new Error('PUT failed'));
      fsMocked.unlink.mockRejectedValue(new Error('unlink ENOENT'));

      // The original transmission error must be the one that propagates
      await expect(
        service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip'),
      ).rejects.toThrow('PUT failed');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete support bundle archive'),
      );

      global.setTimeout = originalSetTimeout;
    });

    it('should warn (not throw) when archive unlink fails after successful transmission', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsMocked = require('fs/promises');
      mockAxiosPut.mockResolvedValue({ status: 200 });
      fsMocked.unlink.mockRejectedValue(new Error('unlink EPERM'));

      // Transmission succeeded — cleanup failure must NOT cause the method to throw
      await expect(
        service.transmitSupportBundle('bundle.zip', '/generated-zips/bundle.zip'),
      ).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete support bundle archive'),
      );
    });
  });
});
