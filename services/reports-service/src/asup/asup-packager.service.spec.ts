import { Test, TestingModule } from '@nestjs/testing';
import { AsupPackagerService } from './asup-packager.service';
import { AsupXmlGeneratorService } from './asup-xml-generator.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

jest.mock('fs/promises');
jest.mock('node-7z', () => ({
  add: jest.fn(),
}));
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Seven = require('node-7z');

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
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

      // Mock Seven.add to emit 'end' event
      Seven.add.mockImplementation(() => {
        const EventEmitter = require('events');
        const emitter = new EventEmitter();
        process.nextTick(() => emitter.emit('end'));
        return emitter;
      });
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

    it('should write temp files before compression', async () => {
      await service.packageAsupPayload();

      // migration-projects.xml, manifest.xml, x-header.txt
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(3);
      const writeArgs = mockedFs.writeFile.mock.calls.map(c => c[0] as string);
      expect(writeArgs.some(p => p.includes('migration-projects.xml'))).toBe(true);
      expect(writeArgs.some(p => p.includes('manifest.xml'))).toBe(true);
      expect(writeArgs.some(p => p.includes('x-header.txt'))).toBe(true);
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

    it('should throw when 7z compression fails', async () => {
      Seven.add.mockImplementation(() => {
        const EventEmitter = require('events');
        const emitter = new EventEmitter();
        process.nextTick(() => emitter.emit('error', new Error('7z failed')));
        return emitter;
      });

      await expect(service.packageAsupPayload()).rejects.toThrow('7z failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create .7z archive'),
        expect.any(String),
      );
    });

    it('should pass manifest XML size metadata from migration XML', async () => {
      const migrationXml = '<xml>test migration data for sizing</xml>';
      xmlGeneratorService.buildMigrationProjectXml.mockResolvedValue(migrationXml);

      await service.packageAsupPayload();

      const manifestCall = xmlGeneratorService.buildManifestXml.mock.calls[0];
      const expectedSize = Buffer.byteLength(migrationXml, 'utf-8');
      expect(manifestCall[0]).toBe(expectedSize); // migrationXmlSize
      expect(manifestCall[1]).toBeGreaterThanOrEqual(0); // collectionTimeMs
      expect(manifestCall[2]).toBe(expectedSize); // sizeCompressed = migrationXmlSize
    });
  });

  // ─── packageSupportBundlePayload ────────────────────────────

  describe('packageSupportBundlePayload', () => {
    beforeEach(() => {
      Seven.add.mockImplementation(() => {
        const EventEmitter = require('events');
        const emitter = new EventEmitter();
        process.nextTick(() => emitter.emit('end'));
        return emitter;
      });
    });

    it('should return isLargePayload=false and skip ISF archive update for archive ≤ 200MB', async () => {
      // Default readFile mock returns a tiny buffer, well below 200MB threshold
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

    it('should append ISF fields to x-header.txt inside .7z and return isLargePayload=true when archive > 200MB', async () => {
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
      Seven.add.mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const EventEmitter = require('events');
        const emitter = new EventEmitter();
        process.nextTick(() => emitter.emit('error', new Error('compression failed')));
        return emitter;
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

      Seven.add.mockImplementation(() => {
        const EventEmitter = require('events');
        const emitter = new EventEmitter();
        process.nextTick(() => emitter.emit('end'));
        return emitter;
      });

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

  // ─── toFlatFilename branch: empty safe string ────────────────

  describe('toFlatFilename', () => {
    it('should return a fallback filename when relativePath is empty string', () => {
      const result = (service as any).toFlatFilename('');
      expect(result).toMatch(/^file-\d+$/);
    });
  });

  // ─── supportBundleXHeadersTemplate fallback branch ───────────

  describe('packageSupportBundlePayload with null supportBundleXHeadersTemplate', () => {
    beforeEach(() => {
      Seven.add.mockImplementation(() => {
        const EventEmitter = require('events');
        const emitter = new EventEmitter();
        process.nextTick(() => emitter.emit('end'));
        return emitter;
      });
    });

    it('should fall back to xHeadersTemplate when supportBundleXHeadersTemplate is null', async () => {
      // Force the `|| this.xHeadersTemplate` branch on line 171
      (service as any).supportBundleXHeadersTemplate = null;

      const result = await service.packageSupportBundlePayload(
        'bundle.zip',
        Buffer.from('zip'),
      );

      // Headers built via the fallback xHeadersTemplate still resolve correctly
      expect(result.headersMap['X-Netapp-Asup-Subject']).toBe('NDM ASUP Report');
    });

    it('should use fallback filename support-bundle.zip when bundleFilename is empty', async () => {
      // Exercises the `bundleFilename || 'support-bundle.zip'` branch (line 145)
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
      // Make the outer beforeEach module's loadTemplates settle first,
      // then override readFile for the fresh module below.
      await new Promise<void>((resolve) => setImmediate(resolve));
      jest.clearAllMocks(); // clear any logger calls from the outer beforeEach module

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
        ],
      }).compile();

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load support bundle ASUP x-headers template'),
      );
    });
  });
});
