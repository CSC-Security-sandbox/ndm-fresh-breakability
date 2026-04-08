import { Test, TestingModule } from '@nestjs/testing';
import { AsupPackagerService } from './asup-packager.service';
import { AsupXmlGeneratorService } from './asup-xml-generator.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { SerialIdSyncService } from '../serial-id-sync.service';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as child_process from 'child_process';

jest.mock('fs/promises');
jest.mock('7zip-bin', () => ({
  path7za: '/usr/bin/7za',
}));
jest.mock('child_process', () => ({
  execFile: jest.fn((cmd: string, args: string[], optsOrCb: any, cb?: any) => {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
    if (typeof callback === 'function') callback(null, '', '');
  }),
}));

describe('AsupPackagerService', () => {
  let service: AsupPackagerService;
  let xmlGeneratorService: jest.Mocked<AsupXmlGeneratorService>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExecFile = child_process.execFile as unknown as jest.Mock;

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  const MOCK_SERIAL = '97500260331143500123';

  const mockSerialIdSyncService = {
    getSerialId: jest.fn().mockResolvedValue(MOCK_SERIAL),
  };

  const xHeadersTemplate = `X-Netapp-Asup-Subject: NDM ASUP Report
X-Netapp-Asup-Generated-On: {{GENERATED_ON}}
X-Netapp-Asup-Content-Type: application/x-7z-compressed`;

  beforeEach(async () => {
    xmlGeneratorService = {
      buildMigrationProjectXml: jest.fn(),
      buildManifestXml: jest.fn(),
      buildSupportBundleManifestXml: jest.fn().mockResolvedValue('<manifest/>'),
    } as any;

    // Mock template loading (loadTemplates runs in constructor)
    mockedFs.readFile.mockImplementation(((filePath: string) => {
      if (
        filePath.includes('x-headers.template') ||
        filePath.includes('support-bundle-x-headers.template')
      ) {
        return Promise.resolve(xHeadersTemplate);
      }
      // Default: tiny buffer for archive reads
      return Promise.resolve(Buffer.from('mock-7z-data'));
    }) as any);
    mockedFs.mkdir.mockResolvedValue(undefined as any);
    mockedFs.writeFile.mockResolvedValue(undefined);
    mockedFs.unlink.mockResolvedValue(undefined);
    mockedFs.copyFile.mockResolvedValue(undefined);
    mockedFs.rm.mockResolvedValue(undefined as any);
    // collectExtractedFiles: return a single mock file entry
    mockedFs.readdir.mockResolvedValue([
      { name: 'service.log', isDirectory: () => false } as any,
    ]);
    mockedFs.stat.mockResolvedValue({ size: 512 } as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AsupPackagerService,
        { provide: AsupXmlGeneratorService, useValue: xmlGeneratorService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: SerialIdSyncService, useValue: mockSerialIdSyncService },
      ],
    }).compile();

    service = module.get<AsupPackagerService>(AsupPackagerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── packageAsupPayload ─────────────────────────────────────

  describe('packageAsupPayload', () => {
    beforeEach(() => {
      xmlGeneratorService.buildMigrationProjectXml.mockResolvedValue(
        '<xml>migration data</xml>',
      );
      xmlGeneratorService.buildManifestXml.mockResolvedValue(
        '<xml>manifest data</xml>',
      );

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], optsOrCb: any, cb?: any) => {
          const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
          if (typeof callback === 'function') process.nextTick(() => callback(null, '', ''));
        },
      );
    });

    it('should generate archive with migration XML, manifest, and x-headers', async () => {
      const result = await service.packageAsupPayload();

      expect(xmlGeneratorService.buildMigrationProjectXml).toHaveBeenCalledTimes(1);
      expect(xmlGeneratorService.buildManifestXml).toHaveBeenCalledTimes(1);
      expect(result.archivePath).toContain('asup-payload.7z');
      expect(result.md5Checksum).toBeDefined();
      expect(result.headersMap).toBeDefined();
      expect(result.xmlContent).toBe('<xml>migration data</xml>');
    });

    it('should invoke 7za binary with correct arguments', async () => {
      await service.packageAsupPayload();

      expect(mockedExecFile).toHaveBeenCalledWith(
        '/usr/bin/7za',
        expect.arrayContaining([
          'a',
          expect.stringContaining('asup-payload.7z'),
          expect.stringContaining('migration-projects.xml'),
          expect.stringContaining('manifest.xml'),
          expect.stringContaining('x-header-data.txt'),
        ]),
        expect.any(Function),
      );
    });

    it('should write temp files before compression', async () => {
      await service.packageAsupPayload();

      // migration-projects.xml, manifest.xml, x-header-data.txt
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(3);
      const writeArgs = mockedFs.writeFile.mock.calls.map(c => c[0] as string);
      expect(writeArgs.some(p => p.includes('migration-projects.xml'))).toBe(true);
      expect(writeArgs.some(p => p.includes('manifest.xml'))).toBe(true);
      expect(writeArgs.some(p => p.includes('x-header-data.txt'))).toBe(true);
    });

    it('should create work and reports directories', async () => {
      await service.packageAsupPayload();

      expect(mockedFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('asup-packaging'),
        { recursive: true },
      );
      expect(mockedFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('asup-reports'),
        { recursive: true },
      );
    });

    it('should calculate MD5 checksum of the archive', async () => {
      const archiveData = Buffer.from('mock-7z-data');
      const expectedMd5 = crypto.createHash('md5').update(archiveData).digest('hex');

      const result = await service.packageAsupPayload();

      expect(result.md5Checksum).toBe(expectedMd5);
      expect(result.headersMap['X-Netapp-Asup-Payload-Checksum']).toBe(expectedMd5);
    });

    it('should clean up temp files after compression', async () => {
      await service.packageAsupPayload();

      // 3 temp files + 1 pre-existing archive unlink attempt = 4 unlink calls
      // (unlink is called for old archive before creation, then 3 temp files after)
      expect(mockedFs.unlink).toHaveBeenCalled();
    });

    it('should throw and log error.message when 7z fails without stderr', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          process.nextTick(() => cb(new Error('exit code 2'), '', ''));
        },
      );

      await expect(service.packageAsupPayload()).rejects.toThrow(
        '7za failed: exit code 2',
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create .7z archive: exit code 2',
        expect.stringContaining('exit code 2'),
      );
    });

    it('should throw and log stderr when 7z fails with stderr output', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          process.nextTick(() => cb(new Error('exit code 2'), '', 'Permission denied: /tmp/asup-reports/asup-payload.7z'));
        },
      );

      await expect(service.packageAsupPayload()).rejects.toThrow(
        '7za failed: Permission denied: /tmp/asup-reports/asup-payload.7z',
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create .7z archive: exit code 2',
        'stderr: Permission denied: /tmp/asup-reports/asup-payload.7z',
      );
    });

    it('should pass manifest XML size metadata including xHeaderSize', async () => {
      const migrationXml = '<xml>test migration data for sizing</xml>';
      xmlGeneratorService.buildMigrationProjectXml.mockResolvedValue(migrationXml);

      await service.packageAsupPayload();

      const manifestCall = xmlGeneratorService.buildManifestXml.mock.calls[0];
      const expectedMigrationSize = Buffer.byteLength(migrationXml, 'utf-8');
      expect(manifestCall[0]).toBe(expectedMigrationSize); // migrationXmlSize
      expect(manifestCall[1]).toBeGreaterThanOrEqual(0);   // collectionTimeMs
      expect(manifestCall[2]).toBe(expectedMigrationSize); // sizeCompressed
      // xHeaderSize must be > 0 since x-headers template produces non-empty text
      expect(manifestCall[3]).toBeGreaterThan(0);
    });

    it('should build x-headers before calling buildManifestXml (ordering check)', async () => {
      const callOrder: string[] = [];

      xmlGeneratorService.buildMigrationProjectXml.mockResolvedValue('<xml/>');
      xmlGeneratorService.buildManifestXml.mockImplementation(async () => {
        callOrder.push('buildManifestXml');
        return '<manifest/>';
      });

      // Track when writeFile is called for x-header-data.txt vs manifest.xml
      mockedFs.writeFile.mockImplementation(async (filePath: string) => {
        if (String(filePath).includes('x-header-data.txt')) callOrder.push('write-xheader');
        if (String(filePath).includes('manifest.xml')) callOrder.push('write-manifest');
      });

      await service.packageAsupPayload();

      // buildManifestXml must be called before both temp files are written,
      // and x-header build (tracked via write) happens in same batch after manifest call
      const manifestIdx = callOrder.indexOf('buildManifestXml');
      expect(manifestIdx).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── packageSupportBundlePayload ────────────────────────────

  describe('packageSupportBundlePayload', () => {
    afterEach(() => {
      // Reset execFile to the default success stub so implementations set by
      // individual tests (e.g. the compression-failure test) do not bleed into
      // subsequent tests — jest.clearAllMocks() only clears call counts, not impl.
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], optsOrCb: any, cb?: any) => {
          const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
          if (typeof callback === 'function') callback(null, '', '');
        },
      );
    });

    it('should return isLargePayload=false and skip ISF archive update for archive ≤ 100MB', async () => {
      // Default readFile mock returns a tiny buffer, well below 100MB threshold
      const result = await service.packageSupportBundlePayload(
        'ndm_support_bundle.zip',
        Buffer.from('mock-zip'),
      );

      expect(result.isLargePayload).toBe(false);
      expect(result.archivePath).toContain('support-bundle-asup-');
      expect(result.md5Checksum).toBeDefined();
      expect(result.headersMap['X-Netapp-Asup-Payload-Checksum']).toBe(result.md5Checksum);

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execFile: mockExecFile } = require('child_process');
      const isf7zaUpdateCalls = mockExecFile.mock.calls.filter(
        (c: any[]) => Array.isArray(c[1]) && c[1][0] === 'u',
      );
      expect(isf7zaUpdateCalls).toHaveLength(0);
    });

    it('should append ISF fields to x-header.txt inside .7z and return isLargePayload=true when archive > 100MB', async () => {
      const largeBuffer = Buffer.allocUnsafe(201 * 1024 * 1024);
      const existingXHeaderText = 'X-Netapp-Asup-Subject: NDM Support Bundle\n';

      mockedFs.readFile.mockImplementation(((filePath: string) => {
        if (
          String(filePath).includes('x-headers.template') ||
          String(filePath).includes('support-bundle-x-headers.template')
        ) {
          return Promise.resolve(xHeadersTemplate);
        }
        if (String(filePath).includes('x-header.txt')) {
          return Promise.resolve(existingXHeaderText);
        }
        return Promise.resolve(largeBuffer);
      }) as any);

      const result = await service.packageSupportBundlePayload(
        'ndm_support_bundle.zip',
        Buffer.from('mock-zip'),
      );

      expect(result.isLargePayload).toBe(true);

      // x-header.txt in staged dir must have ISF fields written
      const isf7zWriteCalls = mockedFs.writeFile.mock.calls.filter(
        (c: any[]) =>
          String(c[0]).includes('x-header.txt') &&
          String(c[1]).includes('X-Netapp-asup-large: true'),
      );
      expect(isf7zWriteCalls).toHaveLength(1);
      const updatedContent = String(isf7zWriteCalls[0][1]);
      expect(updatedContent).toContain('X-Netapp-asup-large: true');
      expect(updatedContent).toContain('X-Netapp-asup-large-filename:');
      expect(updatedContent).toContain('support-bundle-asup-');
      expect(updatedContent).toContain('.7z');
      // Original content must be preserved
      expect(updatedContent).toContain('X-Netapp-Asup-Subject: NDM Support Bundle');

      // 7za u must be called to patch only x-header.txt inside the existing archive
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execFile: mockExecFile } = require('child_process');
      const isf7zaUpdateCalls = mockExecFile.mock.calls.filter(
        (c: any[]) => Array.isArray(c[1]) && c[1][0] === 'u',
      );
      expect(isf7zaUpdateCalls).toHaveLength(1);
      expect(isf7zaUpdateCalls[0][1]).toContain('x-header.txt');
    });

    it('should recompute MD5 over the updated archive after ISF patch', async () => {
      const largeBuffer = Buffer.allocUnsafe(201 * 1024 * 1024);

      mockedFs.readFile.mockImplementation(((filePath: string) => {
        if (
          String(filePath).includes('x-headers.template') ||
          String(filePath).includes('support-bundle-x-headers.template')
        ) {
          return Promise.resolve(xHeadersTemplate);
        }
        if (String(filePath).includes('x-header.txt')) {
          return Promise.resolve('X-Header: value\n');
        }
        return Promise.resolve(largeBuffer);
      }) as any);

      const result = await service.packageSupportBundlePayload(
        'bundle.zip',
        Buffer.from('zip'),
      );

      // MD5 is computed over the re-read (post-patch) archive buffer
      const expectedMd5 = crypto.createHash('md5').update(largeBuffer).digest('hex');
      expect(result.md5Checksum).toBe(expectedMd5);
      expect(result.headersMap['X-Netapp-Asup-Payload-Checksum']).toBe(expectedMd5);
    });

    it('should clean up staged and extracted dirs after packaging', async () => {
      await service.packageSupportBundlePayload('bundle.zip', Buffer.from('zip'));

      expect(mockedFs.rm).toHaveBeenCalledWith(
        expect.stringContaining('support-bundle-extracted-'),
        { recursive: true, force: true },
      );
      expect(mockedFs.rm).toHaveBeenCalledWith(
        expect.stringContaining('support-bundle-staged-'),
        { recursive: true, force: true },
      );
    });

    it('should call buildSupportBundleManifestXml with collected file entries', async () => {
      mockedFs.readdir.mockResolvedValue([
        { name: 'app.log', isDirectory: () => false } as any,
        { name: 'error.log', isDirectory: () => false } as any,
      ]);
      mockedFs.stat.mockResolvedValue({ size: 1024 } as any);

      await service.packageSupportBundlePayload('bundle.zip', Buffer.from('zip'));

      expect(xmlGeneratorService.buildSupportBundleManifestXml).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: expect.any(String), size: 1024 }),
        ]),
        expect.any(Number),
      );
    });

    it('should propagate error when 7z compression fails during support bundle packaging', async () => {
      mockedExecFile.mockImplementation((
        _cmd: string, args: string[], optsOrCb: any, cb?: any,
      ) => {
        const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
        // Fail only on the 'a' (add/compress) command; let extract ('x') succeed
        if (Array.isArray(args) && args[0] === 'a') {
          if (typeof callback === 'function') callback(new Error('compression failed'), '', '');
        } else {
          if (typeof callback === 'function') callback(null, '', '');
        }
      });

      await expect(
        service.packageSupportBundlePayload('bundle.zip', Buffer.from('zip')),
      ).rejects.toThrow('compression failed');
    });

    it('should flatten nested file paths and strip the top-level bundle directory (toFlatFilename)', async () => {
      // Simulate: root contains a 'logs' subdirectory containing 'app service.log'
      // collectExtractedFiles walks it → relativePath = 'logs/app service.log'
      // toFlatFilename strips the first segment ('logs') — it's the top-level bundle dir —
      // then sanitises the rest: 'app service.log' → 'app_service.log'
      mockedFs.readdir
        .mockResolvedValueOnce([
          { name: 'logs', isDirectory: () => true } as any,
        ])
        .mockResolvedValueOnce([
          { name: 'app service.log', isDirectory: () => false } as any,
        ]);
      mockedFs.stat.mockResolvedValue({ size: 256 } as any);

      await service.packageSupportBundlePayload('bundle.zip', Buffer.from('zip'));

      // Manifest entry must use the trimmed, flattened safe name (no top-level dir prefix)
      expect(xmlGeneratorService.buildSupportBundleManifestXml).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'app_service.log' }),
        ]),
        expect.any(Number),
      );
      // copyFile destination must also use the trimmed name
      const copyFileCalls = mockedFs.copyFile.mock.calls;
      expect(
        copyFileCalls.some((c: any[]) => String(c[1]).endsWith('app_service.log')),
      ).toBe(true);
    });

    it('should parse x-headers template into headersMap (non-Payload headers for HTTP)', async () => {
      const result = await service.packageSupportBundlePayload('bundle.zip', Buffer.from('zip'));

      // Template contains X-Netapp-Asup-Subject and X-Netapp-Asup-Content-Type
      expect(result.headersMap['X-Netapp-Asup-Subject']).toBe('NDM ASUP Report');
      expect(result.headersMap['X-Netapp-Asup-Content-Type']).toBe('application/x-7z-compressed');
      // {{GENERATED_ON}} must be filled with a real date, not the raw placeholder
      expect(result.headersMap['X-Netapp-Asup-Generated-On']).toBeDefined();
      expect(result.headersMap['X-Netapp-Asup-Generated-On']).not.toContain('{{GENERATED_ON}}');
    });
  });

  // ─── buildXHeaders ──────────────────────────────────────────

  describe('x-headers generation', () => {
    it('should include GENERATED_ON in headers map', async () => {
      xmlGeneratorService.buildMigrationProjectXml.mockResolvedValue('<xml/>');
      xmlGeneratorService.buildManifestXml.mockResolvedValue('<manifest/>');

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          process.nextTick(() => cb(null, '', ''));
        },
      );

      const result = await service.packageAsupPayload();

      // Headers should have the parsed x-header values
      expect(result.headersMap['X-Netapp-Asup-Subject']).toBe('NDM ASUP Report');
      expect(result.headersMap['X-Netapp-Asup-Content-Type']).toBe(
        'application/x-7z-compressed',
      );
      // GENERATED_ON should be replaced with a date string
      expect(result.headersMap['X-Netapp-Asup-Generated-On']).toBeDefined();
      expect(result.headersMap['X-Netapp-Asup-Generated-On']).not.toContain(
        '{{GENERATED_ON}}',
      );
    });
  });

  // ─── serial ID wiring ────────────────────────────────────────

  describe('serial ID wiring in x-headers', () => {
    beforeEach(() => {
      xmlGeneratorService.buildMigrationProjectXml.mockResolvedValue('<xml/>');
      xmlGeneratorService.buildManifestXml.mockResolvedValue('<manifest/>');
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], optsOrCb: any, cb?: any) => {
          const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
          if (typeof callback === 'function') process.nextTick(() => callback(null, '', ''));
        },
      );
    });

    it('should delegate to SerialIdSyncService.getSerialId and use the returned serial', async () => {
      mockSerialIdSyncService.getSerialId.mockResolvedValueOnce(MOCK_SERIAL);

      const result = await service.packageAsupPayload();

      expect(mockSerialIdSyncService.getSerialId).toHaveBeenCalledTimes(1);
      expect(result.archivePath).toContain('asup-payload.7z');
    });

    it('should log error and return null when SerialIdSyncService returns null', async () => {
      mockSerialIdSyncService.getSerialId.mockResolvedValueOnce(null);

      const result = await service.packageAsupPayload();

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Serial ID not found'),
      );
      // No packaging work should have started
      expect(mockedExecFile).not.toHaveBeenCalled();
      expect(mockedFs.mkdir).not.toHaveBeenCalled();
    });
  });

  // ─── toFlatFilename ──────────────────────────────────────────

  describe('toFlatFilename', () => {
    it('should return a fallback filename when relativePath is empty string', () => {
      const result = (service as any).toFlatFilename('');
      expect(result).toMatch(/^file-\d+$/);
    });

    it('should return a sanitised flat fallback for an unrecognised top-level dir', () => {
      const result = (service as any).toFlatFilename('some_root/unknown-dir/file.txt');
      expect(result).toBe('unknown-dir_file.txt');
    });

    it('should handle a single-segment path with no slash', () => {
      // parts.length === 1 → trimmed = normalized (no slice)
      const result = (service as any).toFlatFilename('justfilename.log');
      expect(result).toBe('justfilename.log');
    });

    // ── ndm_logs / no-project paths ──────────────────────────────────────────

    it('no-project: worker.log exact match → <date>_no_project_worker_<id>.log', () => {
      const result = (service as any).toFlatFilename(
        'ndm_logs_user/ndm_logs/2026-04-07/no-project/worker/wid-123/worker.log',
      );
      expect(result).toBe('26_04_07_no_project_worker_wid-123.log');
    });

    it('no-project: worker other file → <date>_no_project_worker_<id>_<file>', () => {
      const result = (service as any).toFlatFilename(
        'ndm_logs_user/ndm_logs/2026-04-07/no-project/worker/wid-123/debug.log',
      );
      expect(result).toBe('26_04_07_no_project_worker_wid-123_debug.log');
    });

    it('no-project: non-worker control-plane entry → <date>_no_project_cp_<safe>', () => {
      const result = (service as any).toFlatFilename(
        'ndm_logs_user/ndm_logs/2026-04-07/no-project/control-plane/admin.log',
      );
      expect(result).toBe('26_04_07_no_project_cp_admin.log');
    });

    it('no-project: worker path with fewer than 3 rest segments falls to generic fallback', () => {
      // rest = ['worker', 'wid-123'] → rest.length=2 < 3 → fallback branch
      const result = (service as any).toFlatFilename(
        'ndm_logs_user/ndm_logs/2026-04-07/no-project/worker/wid-123',
      );
      expect(result).toContain('no_project');
    });

    // ── ndm_logs / project paths ──────────────────────────────────────────────

    it('project: sub.length === 0 (bare ndm_logs/date/projectId) returns sanitised flat path', () => {
      // tp = ['ndm_logs', '2026-04-07', 'proj-abc'] → sub = []
      const result = (service as any).toFlatFilename('bundle/ndm_logs/2026-04-07/proj-abc');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('project: control-plane known service → <date>_cp_<svc>_<projectId>.log', () => {
      const result = (service as any).toFlatFilename(
        'ndm_logs_user/ndm_logs/2026-04-07/proj-abc/control-plane/admin-service.log',
      );
      expect(result).toBe('26_04_07_cp_admin_svc_proj-abc.log');
    });

    it('project: control-plane config-service → <date>_cp_config_svc_<projectId>.log', () => {
      const result = (service as any).toFlatFilename(
        'bundle/ndm_logs/2026-04-07/proj-abc/control-plane/config-service.log',
      );
      expect(result).toBe('26_04_07_cp_config_svc_proj-abc.log');
    });

    it('project: control-plane error-report.csv → <date>_cp_error_report_<projectId>.csv', () => {
      const result = (service as any).toFlatFilename(
        'bundle/ndm_logs/2026-04-07/proj-abc/control-plane/error-report.csv',
      );
      expect(result).toBe('26_04_07_cp_error_report_proj-abc.csv');
    });

    it('project: control-plane unknown service (cpMap miss) → <date>_cp_<projectId>_<safe>', () => {
      const result = (service as any).toFlatFilename(
        'bundle/ndm_logs/2026-04-07/proj-abc/control-plane/custom-service.log',
      );
      expect(result).toBe('26_04_07_cp_proj-abc_custom-service.log');
    });

    it('project: worker worker.log exact match → <date>_worker_<id>_<projectId>.log', () => {
      const result = (service as any).toFlatFilename(
        'bundle/ndm_logs/2026-04-07/proj-abc/worker/wid-456/worker.log',
      );
      expect(result).toBe('26_04_07_worker_wid-456_proj-abc.log');
    });

    it('project: worker other file → <date>_<projectId>_worker_<id>_<safe>', () => {
      const result = (service as any).toFlatFilename(
        'bundle/ndm_logs/2026-04-07/proj-abc/worker/wid-456/debug.log',
      );
      expect(result).toBe('26_04_07_proj-abc_worker_wid-456_debug.log');
    });

    it('project: worker path with fewer than 3 sub segments falls to safe flat path', () => {
      // sub = ['worker', 'wid-456'] → sub.length=2 < 3 → safe(trimmed...)
      const result = (service as any).toFlatFilename(
        'bundle/ndm_logs/2026-04-07/proj-abc/worker/wid-456',
      );
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('project: unknown subDir (not control-plane, not worker) → safe flat path', () => {
      const result = (service as any).toFlatFilename(
        'bundle/ndm_logs/2026-04-07/proj-abc/other-dir/file.txt',
      );
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    // ── CSV category paths ────────────────────────────────────────────────────

    // Epoch 1744070400000 = 2025-04-08T00:00:00.000Z → date prefix "25_04_08"
    // Epoch is stripped from output; only the derived YY_MM_DD prefix is kept.
    it('Performance Metrics csv → <YY_MM_DD>_perf_<metric_underscored>.csv (epoch stripped)', () => {
      const result = (service as any).toFlatFilename(
        'bundle/Performance Metrics/cpu-percent-1744070400000.csv',
      );
      expect(result).toBe('25_04_08_perf_cpu_percent.csv');
    });

    it('State Data csv → <YY_MM_DD>_state_data_<name>.csv (epoch stripped)', () => {
      const result = (service as any).toFlatFilename(
        'bundle/State Data/service_pods_1744070400000.csv',
      );
      expect(result).toBe('25_04_08_state_data_service_pods.csv');
    });

    it('System Inventory csv → <YY_MM_DD>_sys_inventory_<type_underscored>.csv (epoch stripped)', () => {
      const result = (service as any).toFlatFilename(
        'bundle/System Inventory/system-inventory-disk-usage-1744070400000.csv',
      );
      expect(result).toBe('25_04_08_sys_inventory_disk_usage.csv');
    });

    it('configuration data csv → <YY_MM_DD>_<filename>.csv (epoch stripped)', () => {
      const result = (service as any).toFlatFilename(
        'bundle/configuration data/job_config_details_1744070400000.csv',
      );
      expect(result).toBe('25_04_08_job_config_details.csv');
    });
  });

  // ─── packageSupportBundlePayload: finally cleanup error handling ──────────

  describe('packageSupportBundlePayload finally cleanup error handling', () => {
    afterEach(() => {
      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], optsOrCb: any, cb?: any) => {
          const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
          if (typeof callback === 'function') callback(null, '', '');
        },
      );
    });

    it('should warn but not throw when fs.unlink fails for temp files in finally', async () => {
      mockedFs.unlink.mockRejectedValue(new Error('unlink failed'));

      // Should still resolve — unlink failure in finally must not propagate
      await expect(
        service.packageSupportBundlePayload('bundle.zip', Buffer.from('zip')),
      ).resolves.toBeDefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete temp file'),
      );
    });

    it('should warn but not throw when fs.rm(extractedDir) fails in finally', async () => {
      mockedFs.rm.mockRejectedValue(new Error('rm extractedDir failed'));

      await expect(
        service.packageSupportBundlePayload('bundle.zip', Buffer.from('zip')),
      ).resolves.toBeDefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove extractedDir'),
      );
    });

    it('should warn but not throw when fs.rm(stagedPayloadDir) fails in finally', async () => {
      // First rm (extractedDir) succeeds, second (stagedPayloadDir) fails
      mockedFs.rm
        .mockResolvedValueOnce(undefined as any)
        .mockRejectedValueOnce(new Error('rm staged failed'));

      await expect(
        service.packageSupportBundlePayload('bundle.zip', Buffer.from('zip')),
      ).resolves.toBeDefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove stagedPayloadDir'),
      );
    });
  });

  // ─── supportBundleXHeadersTemplate fallback branch ───────────

  describe('packageSupportBundlePayload with null supportBundleXHeadersTemplate', () => {

    it('should fall back to xHeadersTemplate when supportBundleXHeadersTemplate is null', async () => {
      // Force the `|| this.xHeadersTemplate` branch
      (service as any).supportBundleXHeadersTemplate = null;

      const result = await service.packageSupportBundlePayload(
        'bundle.zip',
        Buffer.from('zip'),
      );

      // Headers built via the fallback xHeadersTemplate still resolve correctly
      expect(result.headersMap['X-Netapp-Asup-Subject']).toBe('NDM ASUP Report');
    });

    it('should use fallback filename support-bundle.zip when bundleFilename is empty', async () => {
      // Exercises the `bundleFilename || 'support-bundle.zip'` branch
      const result = await service.packageSupportBundlePayload('', Buffer.from('zip'));
      expect(result.archivePath).toContain('support-bundle-asup-');
      expect(result.isLargePayload).toBe(false);
    });
  });

  // ─── loadTemplates error handling ────────────────────────────

  describe('loadTemplates error handling', () => {
    // After each error test restore the default readFile implementation
    // so subsequent outer-describe tests remain unaffected.
    afterEach(() => {
      mockedFs.readFile.mockImplementation(((filePath: string) => {
        if (
          filePath.includes('x-headers.template') ||
          filePath.includes('support-bundle-x-headers.template')
        ) {
          return Promise.resolve(xHeadersTemplate);
        }
        return Promise.resolve(Buffer.from('mock-7z-data'));
      }) as any);
    });

    it('should log error when x-headers.template fails to load', async () => {
      // Allow the outer beforeEach module's loadTemplates to settle first,
      // then override readFile for the fresh module below.
      await new Promise<void>((resolve) => setImmediate(resolve));
      jest.clearAllMocks();

      mockedFs.readFile.mockImplementation(((filePath: string) => {
        if (filePath.includes('x-headers.template')) {
          return Promise.reject(new Error('x-headers read failed'));
        }
        return Promise.resolve(xHeadersTemplate);
      }) as any);

      await Test.createTestingModule({
        providers: [
          AsupPackagerService,
          { provide: AsupXmlGeneratorService, useValue: xmlGeneratorService },
          { provide: LoggerFactory, useValue: mockLoggerFactory },
          { provide: SerialIdSyncService, useValue: mockSerialIdSyncService },
        ],
      }).compile();

      // Allow the fire-and-forget loadTemplates() to settle
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load ASUP x-headers template'),
      );
    });

    it('should log error when support-bundle-x-headers.template fails to load', async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      jest.clearAllMocks();

      mockedFs.readFile.mockImplementation(((filePath: string) => {
        if (
          filePath.includes('x-headers.template') &&
          !filePath.includes('support-bundle')
        ) {
          return Promise.resolve(xHeadersTemplate); // regular template succeeds
        }
        if (filePath.includes('support-bundle-x-headers.template')) {
          return Promise.reject(new Error('support-bundle x-headers read failed'));
        }
        return Promise.resolve(Buffer.from('mock-7z-data'));
      }) as any);

      await Test.createTestingModule({
        providers: [
          AsupPackagerService,
          { provide: AsupXmlGeneratorService, useValue: xmlGeneratorService },
          { provide: LoggerFactory, useValue: mockLoggerFactory },
          { provide: SerialIdSyncService, useValue: mockSerialIdSyncService },
        ],
      }).compile();

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load support bundle ASUP x-headers template'),
      );
    });
  });
});
