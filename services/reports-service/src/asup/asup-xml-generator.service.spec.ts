import { Test, TestingModule } from '@nestjs/testing';
import { AsupXmlGeneratorService } from './asup-xml-generator.service';
import { AsupStatsService, ProjectStats } from './asup-stats.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');

describe('AsupXmlGeneratorService', () => {
  let service: AsupXmlGeneratorService;
  let asupStatsService: jest.Mocked<AsupStatsService>;
  const mockedFs = fs as jest.Mocked<typeof fs>;

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  // Minimal migration-body template for testing
  const migrationBodyTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<asup>
<table>
<col-time-us>{{COL_TIME_US}}</col-time-us>
{{ROW_TEMPLATE_START}}
<row>
  <col-time-us>{{COL_TIME_US}}</col-time-us>
  <project-id>{{PROJECT_ID}}</project-id>
  <source>{{SOURCE}}</source>
  <destination>{{DESTINATION}}</destination>
  <protocol>{{PROTOCOL}}</protocol>
  <job-type>{{JOB_TYPE}}</job-type>
  <discovered-size>{{DISCOVERED_SIZE}}</discovered-size>
  <migrated-size>{{MIGRATED_SIZE}}</migrated-size>
  <discovered-filecount>{{DISCOVERED_FILECOUNT}}</discovered-filecount>
  <migrated-filecount>{{MIGRATED_FILECOUNT}}</migrated-filecount>
  <jobrun-count>{{JOBRUN_COUNT}}</jobrun-count>
</row>
{{ROW_TEMPLATE_END}}
</table>
</asup>`;

  // Minimal manifest template
  const manifestTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <col-time-us>{{COL_TIME_US}}</col-time-us>
  <size-collected>{{SIZE_COLLECTED}}</size-collected>
  <time-collected-ms>{{TIME_COLLECTED_MS}}</time-collected-ms>
  <size-compressed>{{SIZE_COMPRESSED}}</size-compressed>
</manifest>`;

  // Minimal support-bundle manifest template (mirrors actual template structure)
  const supportBundleManifestTemplate = `<Manifest col_time_us="{{COL_TIME_US}}">
{{ROW_TEMPLATE_START}}
<asup:ROW col_time_us="{{COL_TIME_US}}">
  <seq-num>{{SEQ_NUM}}</seq-num>
  <prio-num>{{PRIO_NUM}}</prio-num>
  <subsys>{{SUBSYS}}</subsys>
  <cmd-tgt>{{CMD_TGT}}</cmd-tgt>
  <body-file>{{BODY_FILE}}</body-file>
  <size-collected>{{SIZE_COLLECTED}}</size-collected>
  <time-collected-ms>{{TIME_COLLECTED_MS}}</time-collected-ms>
  <size-compressed>{{SIZE_COMPRESSED}}</size-compressed>
</asup:ROW>
{{ROW_TEMPLATE_END}}
</Manifest>`;

  beforeEach(async () => {
    asupStatsService = {
      getUntransmittedStatsGroupedByProject: jest.fn(),
      recordJobRunStats: jest.fn(),
      markAsTransmitted: jest.fn(),
      getUntransmittedCount: jest.fn(),
    } as any;

    // Mock template loading
    mockedFs.readFile.mockImplementation(((filePath: string) => {
      const filename = path.basename(filePath);
      if (filename === 'migration-body.xml.template') {
        return Promise.resolve(migrationBodyTemplate);
      }
      if (filename === 'manifest.xml.template') {
        return Promise.resolve(manifestTemplate);
      }
      if (filename === 'support-bundle-manifest.xml.template') {
        return Promise.resolve(supportBundleManifestTemplate);
      }
      return Promise.reject(new Error(`Unknown template: ${filename}`));
    }) as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AsupXmlGeneratorService,
        { provide: AsupStatsService, useValue: asupStatsService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    service = module.get<AsupXmlGeneratorService>(AsupXmlGeneratorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── buildMigrationProjectXml ───────────────────────────────

  describe('buildMigrationProjectXml', () => {
    it('should generate XML with project rows', async () => {
      const mockStats: ProjectStats[] = [
        {
          projectId: 'proj-1',
          projectName: 'Test Project',
          jobs: [
            {
              jobConfigId: 'jc-1',
              projectId: 'proj-1',
              projectName: 'Test Project',
              jobType: 'discovery',
              protocol: 'NFS',
              sourceServerType: 'ONTAP',
              destinationServerType: 'n/a',
              totalFileCount: 500,
              totalSizeBytes: 25000,
              jobRunCount: 2,
            },
          ],
          totals: {
            discoveredFileCount: 500,
            discoveredSizeBytes: 25000,
            migratedFileCount: 0,
            migratedSizeBytes: 0,
            totalJobRuns: 2,
          },
        },
      ];
      asupStatsService.getUntransmittedStatsGroupedByProject.mockResolvedValue(
        mockStats,
      );

      const xml = await service.buildMigrationProjectXml();

      expect(xml).toContain('<project-id>proj-1</project-id>');
      expect(xml).toContain('<source>ONTAP</source>');
      expect(xml).toContain('<protocol>NFS</protocol>');
      expect(xml).toContain('<discovered-size>25000</discovered-size>');
      expect(xml).toContain('<discovered-filecount>500</discovered-filecount>');
      expect(xml).toContain('<jobrun-count>2</jobrun-count>');
      expect(xml).toContain('<?xml version="1.0"');
    });

    it('should generate XML with empty rows when no stats', async () => {
      asupStatsService.getUntransmittedStatsGroupedByProject.mockResolvedValue([]);

      const xml = await service.buildMigrationProjectXml();

      expect(xml).toContain('<asup>');
      expect(xml).toContain('</asup>');
      expect(xml).not.toContain('<project-id>');
    });

    it('should escape XML special characters in project ID', async () => {
      const mockStats: ProjectStats[] = [
        {
          projectId: 'proj<>&"\'test',
          projectName: 'Test',
          jobs: [
            {
              jobConfigId: 'jc-1',
              projectId: 'proj<>&"\'test',
              projectName: 'Test',
              jobType: 'discovery',
              protocol: 'NFS',
              sourceServerType: 'ONTAP',
              destinationServerType: 'n/a',
              totalFileCount: 10,
              totalSizeBytes: 100,
              jobRunCount: 1,
            },
          ],
          totals: {
            discoveredFileCount: 10,
            discoveredSizeBytes: 100,
            migratedFileCount: 0,
            migratedSizeBytes: 0,
            totalJobRuns: 1,
          },
        },
      ];
      asupStatsService.getUntransmittedStatsGroupedByProject.mockResolvedValue(
        mockStats,
      );

      const xml = await service.buildMigrationProjectXml();

      expect(xml).toContain('&amp;');
      expect(xml).toContain('&lt;');
      expect(xml).toContain('&gt;');
      expect(xml).not.toContain('<project-id>proj<>');
    });

    it('should set job_type to mixed when project has discovery and migration', async () => {
      const mockStats: ProjectStats[] = [
        {
          projectId: 'proj-1',
          projectName: 'Mixed Project',
          jobs: [
            {
              jobConfigId: 'jc-1',
              projectId: 'proj-1',
              projectName: 'Mixed Project',
              jobType: 'discovery',
              protocol: 'NFS',
              sourceServerType: 'ONTAP',
              destinationServerType: 'n/a',
              totalFileCount: 100,
              totalSizeBytes: 5000,
              jobRunCount: 1,
            },
            {
              jobConfigId: 'jc-2',
              projectId: 'proj-1',
              projectName: 'Mixed Project',
              jobType: 'migration',
              protocol: 'NFS',
              sourceServerType: 'ONTAP',
              destinationServerType: 'ANF',
              totalFileCount: 50,
              totalSizeBytes: 2000,
              jobRunCount: 1,
            },
          ],
          totals: {
            discoveredFileCount: 100,
            discoveredSizeBytes: 5000,
            migratedFileCount: 50,
            migratedSizeBytes: 2000,
            totalJobRuns: 2,
          },
        },
      ];
      asupStatsService.getUntransmittedStatsGroupedByProject.mockResolvedValue(
        mockStats,
      );

      const xml = await service.buildMigrationProjectXml();

      expect(xml).toContain('<job-type>mixed</job-type>');
    });
  });

  // ─── buildManifestXml ───────────────────────────────────────

  describe('buildManifestXml', () => {
    it('should fill manifest template with values', async () => {
      const xml = await service.buildManifestXml(1024, 150, 800);

      expect(xml).toContain('<size-collected>1024</size-collected>');
      expect(xml).toContain('<time-collected-ms>150</time-collected-ms>');
      expect(xml).toContain('<size-compressed>800</size-compressed>');
      expect(xml).toContain('<?xml version="1.0"');
    });

    it('should replace COL_TIME_US with a numeric timestamp', async () => {
      const xml = await service.buildManifestXml(100, 50, 80);

      // COL_TIME_US should be replaced with a number (microseconds)
      expect(xml).not.toContain('{{COL_TIME_US}}');
      expect(xml).toContain('<col-time-us>');
    });

    it('should use cached manifest template on second call', async () => {
      await service.buildManifestXml(100, 50, 80);
      mockedFs.readFile.mockClear();

      const xml = await service.buildManifestXml(200, 100, 160);

      // Should not read file again (cached)
      const manifestReads = mockedFs.readFile.mock.calls.filter(
        (call) => String(call[0]).includes('manifest.xml.template'),
      );
      expect(manifestReads).toHaveLength(0);
      expect(xml).toContain('<size-collected>200</size-collected>');
    });
  });

  // ─── getMigrationProjectTemplate error branches ─────────────

  describe('getMigrationProjectTemplate error handling', () => {
    it('should throw when ROW_TEMPLATE_START is missing', async () => {
      mockedFs.readFile.mockImplementation(((filePath: string) => {
        const filename = path.basename(filePath);
        if (filename === 'migration-body.xml.template') {
          return Promise.resolve('<asup>{{ROW_TEMPLATE_END}}</asup>');
        }
        return Promise.resolve('');
      }) as any);

      // Create a fresh service to clear the cache
      const module = await Test.createTestingModule({
        providers: [
          AsupXmlGeneratorService,
          { provide: AsupStatsService, useValue: asupStatsService },
          { provide: LoggerFactory, useValue: mockLoggerFactory },
        ],
      }).compile();
      const freshService = module.get<AsupXmlGeneratorService>(AsupXmlGeneratorService);

      await expect(freshService.buildMigrationProjectXml()).rejects.toThrow(
        'migration-body.xml.template must contain {{ROW_TEMPLATE_START}} and {{ROW_TEMPLATE_END}}',
      );
    });

    it('should throw when ROW_TEMPLATE_END is missing', async () => {
      mockedFs.readFile.mockImplementation(((filePath: string) => {
        const filename = path.basename(filePath);
        if (filename === 'migration-body.xml.template') {
          return Promise.resolve('<asup>{{ROW_TEMPLATE_START}}</asup>');
        }
        return Promise.resolve('');
      }) as any);

      const module = await Test.createTestingModule({
        providers: [
          AsupXmlGeneratorService,
          { provide: AsupStatsService, useValue: asupStatsService },
          { provide: LoggerFactory, useValue: mockLoggerFactory },
        ],
      }).compile();
      const freshService = module.get<AsupXmlGeneratorService>(AsupXmlGeneratorService);

      await expect(freshService.buildMigrationProjectXml()).rejects.toThrow(
        'migration-body.xml.template must contain {{ROW_TEMPLATE_START}} and {{ROW_TEMPLATE_END}}',
      );
    });

    it('should throw when ROW_TEMPLATE_END appears before ROW_TEMPLATE_START', async () => {
      mockedFs.readFile.mockImplementation(((filePath: string) => {
        const filename = path.basename(filePath);
        if (filename === 'migration-body.xml.template') {
          return Promise.resolve('<asup>{{ROW_TEMPLATE_END}}{{ROW_TEMPLATE_START}}</asup>');
        }
        return Promise.resolve('');
      }) as any);

      const module = await Test.createTestingModule({
        providers: [
          AsupXmlGeneratorService,
          { provide: AsupStatsService, useValue: asupStatsService },
          { provide: LoggerFactory, useValue: mockLoggerFactory },
        ],
      }).compile();
      const freshService = module.get<AsupXmlGeneratorService>(AsupXmlGeneratorService);

      await expect(freshService.buildMigrationProjectXml()).rejects.toThrow(
        'migration-body.xml.template must contain {{ROW_TEMPLATE_START}} and {{ROW_TEMPLATE_END}}',
      );
    });
  });

  // ─── cache and fallback branches ────────────────────────────

  describe('caching and fallback branches', () => {
    it('should use cached migration template on second call', async () => {
      asupStatsService.getUntransmittedStatsGroupedByProject.mockResolvedValue([]);

      await service.buildMigrationProjectXml();
      mockedFs.readFile.mockClear();

      await service.buildMigrationProjectXml();

      const migrationReads = mockedFs.readFile.mock.calls.filter(
        (call) => String(call[0]).includes('migration-body.xml.template'),
      );
      expect(migrationReads).toHaveLength(0);
    });

    it('should use empty strings when firstJob has no sourceServerType/protocol', async () => {
      const mockStats: ProjectStats[] = [
        {
          projectId: 'proj-empty',
          projectName: 'Empty Fields',
          jobs: [
            {
              jobConfigId: 'jc-1',
              projectId: 'proj-empty',
              projectName: 'Empty Fields',
              jobType: 'discovery',
              protocol: '',
              sourceServerType: '',
              destinationServerType: '',
              totalFileCount: 1,
              totalSizeBytes: 10,
              jobRunCount: 1,
            },
          ],
          totals: {
            discoveredFileCount: 1,
            discoveredSizeBytes: 10,
            migratedFileCount: 0,
            migratedSizeBytes: 0,
            totalJobRuns: 1,
          },
        },
      ];
      asupStatsService.getUntransmittedStatsGroupedByProject.mockResolvedValue(mockStats);

      const xml = await service.buildMigrationProjectXml();

      expect(xml).toContain('<source></source>');
      expect(xml).toContain('<protocol></protocol>');
      expect(xml).toContain('<job-type>discovery</job-type>');
    });

    it('should use "unknown" job type when firstJob has no jobType and no discovery/migration', async () => {
      const mockStats: ProjectStats[] = [
        {
          projectId: 'proj-unknown',
          projectName: 'Unknown Type',
          jobs: [
            {
              jobConfigId: 'jc-1',
              projectId: 'proj-unknown',
              projectName: 'Unknown Type',
              jobType: '' as any,
              protocol: 'NFS',
              sourceServerType: 'ONTAP',
              destinationServerType: 'ANF',
              totalFileCount: 5,
              totalSizeBytes: 500,
              jobRunCount: 1,
            },
          ],
          totals: {
            discoveredFileCount: 0,
            discoveredSizeBytes: 0,
            migratedFileCount: 5,
            migratedSizeBytes: 500,
            totalJobRuns: 1,
          },
        },
      ];
      asupStatsService.getUntransmittedStatsGroupedByProject.mockResolvedValue(mockStats);

      const xml = await service.buildMigrationProjectXml();

      expect(xml).toContain('<job-type>unknown</job-type>');
    });

    it('should use discovery job type when project has only discovery jobs', async () => {

      const mockStats: ProjectStats[] = [
        {
          projectId: 'proj-disc',
          projectName: 'Discovery Only',
          jobs: [
            {
              jobConfigId: 'jc-1',
              projectId: 'proj-disc',
              projectName: 'Discovery Only',
              jobType: 'discovery',
              protocol: 'SMB',
              sourceServerType: 'WindowsFS',
              destinationServerType: 'n/a',
              totalFileCount: 100,
              totalSizeBytes: 1000,
              jobRunCount: 1,
            },
          ],
          totals: {
            discoveredFileCount: 100,
            discoveredSizeBytes: 1000,
            migratedFileCount: 0,
            migratedSizeBytes: 0,
            totalJobRuns: 1,
          },
        },
      ];
      asupStatsService.getUntransmittedStatsGroupedByProject.mockResolvedValue(mockStats);

      const xml = await service.buildMigrationProjectXml();

      expect(xml).toContain('<job-type>discovery</job-type>');
    });
  });

  // ─── buildSupportBundleManifestXml ─────────────────────────

  describe('buildSupportBundleManifestXml', () => {
    it('should replace {{COL_TIME_US}} in the manifest prefix col_time_us attribute (Bug 1 fix)', async () => {
      const xml = await service.buildSupportBundleManifestXml(
        [{ name: 'service.log', size: 1024 }],
        100,
      );

      // The Manifest root element attribute must not contain the raw placeholder
      expect(xml).not.toContain('col_time_us="{{COL_TIME_US}}"');
      // Must be replaced with a numeric microsecond timestamp
      expect(xml).toMatch(/col_time_us="\d{16,}"/);
    });

    it('should assign 1-indexed sequential seq-num and prio-num for each entry (Bug 2 fix)', async () => {
      const entries = [
        { name: 'alpha.log', size: 100 },
        { name: 'beta.log', size: 200 },
        { name: 'gamma.log', size: 300 },
      ];

      const xml = await service.buildSupportBundleManifestXml(entries, 50);

      expect(xml).toContain('<seq-num>1</seq-num>');
      expect(xml).toContain('<seq-num>2</seq-num>');
      expect(xml).toContain('<seq-num>3</seq-num>');
      expect(xml).toContain('<prio-num>1</prio-num>');
      expect(xml).toContain('<prio-num>2</prio-num>');
      expect(xml).toContain('<prio-num>3</prio-num>');
      expect(xml).not.toContain('{{SEQ_NUM}}');
      expect(xml).not.toContain('{{PRIO_NUM}}');
    });

    it('should render body-file, size-collected, and time-collected-ms for each entry', async () => {
      const xml = await service.buildSupportBundleManifestXml(
        [{ name: 'error.log', size: 2048 }],
        200,
      );

      expect(xml).toContain('<body-file>error.log</body-file>');
      expect(xml).toContain('<size-collected>2048</size-collected>');
      expect(xml).toContain('<time-collected-ms>200</time-collected-ms>');
      expect(xml).toContain('<size-compressed>2048</size-compressed>');
    });

    it('should escape XML special characters in entry filenames', async () => {
      const xml = await service.buildSupportBundleManifestXml(
        [{ name: 'log<>&"test.txt', size: 50 }],
        10,
      );

      expect(xml).toContain('<body-file>log&lt;&gt;&amp;&quot;test.txt</body-file>');
      expect(xml).not.toContain('<body-file>log<>');
    });

    it('should use a placeholder entry when bundleEntries is empty', async () => {
      const xml = await service.buildSupportBundleManifestXml([], 0);

      expect(xml).toContain('<body-file>support-bundle-unknown.log</body-file>');
      expect(xml).toContain('<seq-num>1</seq-num>');
    });

    it('should not contain any unreplaced template placeholders in the output', async () => {
      const xml = await service.buildSupportBundleManifestXml(
        [{ name: 'ndm.log', size: 512 }],
        75,
      );

      expect(xml).not.toContain('{{');
      expect(xml).not.toContain('}}');
    });

    it('should replace {{COL_TIME_US}} in asup:ROW col_time_us attribute for every row', async () => {
      const xml = await service.buildSupportBundleManifestXml(
        [{ name: 'a.log', size: 100 }, { name: 'b.log', size: 200 }],
        10,
      );

      // Neither row should keep the raw placeholder
      expect(xml).not.toContain('col_time_us="{{COL_TIME_US}}"');
      // Both rows (2 occurrences) should have a numeric timestamp
      const rowMatches = xml.match(/<asup:ROW col_time_us="\d{16,}">/g);
      expect(rowMatches).toHaveLength(2);
    });

    it('should set subsys=support_bundle and cmd-tgt=dblade in every row', async () => {
      const xml = await service.buildSupportBundleManifestXml(
        [{ name: 'a.log', size: 100 }, { name: 'b.log', size: 200 }],
        10,
      );

      const subsysMatches = xml.match(/<subsys>support_bundle<\/subsys>/g);
      const cmdTgtMatches = xml.match(/<cmd-tgt>dblade<\/cmd-tgt>/g);
      expect(subsysMatches).toHaveLength(2);
      expect(cmdTgtMatches).toHaveLength(2);
    });

    it('should use cached support-bundle-manifest template on subsequent calls', async () => {
      await service.buildSupportBundleManifestXml([{ name: 'first.log', size: 10 }], 5);
      mockedFs.readFile.mockClear();

      const xml = await service.buildSupportBundleManifestXml([{ name: 'second.log', size: 20 }], 10);

      const templateReads = mockedFs.readFile.mock.calls.filter(
        (call) => String(call[0]).includes('support-bundle-manifest.xml.template'),
      );
      expect(templateReads).toHaveLength(0);
      expect(xml).toContain('<body-file>second.log</body-file>');
    });

    it('should throw when support-bundle-manifest.xml.template has invalid structure', async () => {
      mockedFs.readFile.mockImplementation(((filePath: string) => {
        const filename = path.basename(filePath);
        if (filename === 'support-bundle-manifest.xml.template') {
          return Promise.resolve('<Manifest>no row template markers here</Manifest>');
        }
        return Promise.resolve('');
      }) as any);

      const module = await Test.createTestingModule({
        providers: [
          AsupXmlGeneratorService,
          { provide: AsupStatsService, useValue: asupStatsService },
          { provide: LoggerFactory, useValue: mockLoggerFactory },
        ],
      }).compile();
      const freshService = module.get<AsupXmlGeneratorService>(AsupXmlGeneratorService);

      await expect(
        freshService.buildSupportBundleManifestXml([{ name: 'a.log', size: 0 }], 0),
      ).rejects.toThrow('manifest.xml.template must contain {{ROW_TEMPLATE_START}} and {{ROW_TEMPLATE_END}}');
    });
  });
});
