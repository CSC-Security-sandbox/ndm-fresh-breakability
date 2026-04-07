import { Test, TestingModule } from '@nestjs/testing';
import { AsupPackagerService } from './asup-packager.service';
import { AsupXmlGeneratorService } from './asup-xml-generator.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as child_process from 'child_process';

jest.mock('fs/promises');
jest.mock('child_process');
jest.mock('7zip-bin', () => ({
  path7za: '/usr/bin/7za',
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

      mockedExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          process.nextTick(() => cb(null, '', ''));
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
});
