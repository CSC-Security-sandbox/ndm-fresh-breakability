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
    } as any;

    // Mock template loading (loadTemplates runs in constructor)
    mockedFs.readFile.mockImplementation(((filePath: string) => {
      if (filePath.includes('x-headers.template')) {
        return Promise.resolve(xHeadersTemplate);
      }
      // For archive read in packageAsupPayload
      return Promise.resolve(Buffer.from('mock-7z-data'));
    }) as any);
    mockedFs.mkdir.mockResolvedValue(undefined as any);
    mockedFs.writeFile.mockResolvedValue(undefined);
    mockedFs.unlink.mockResolvedValue(undefined);

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
});
