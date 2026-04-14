import { Test, TestingModule } from "@nestjs/testing";
import { CsvService } from "./csv_export.service";
import { DataSource } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";
import * as fs from "fs";
import * as fastCsv from "fast-csv";
import exp from "constants";
import * as validation from '../utils/utils';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';
import { JobRunEntity } from 'src/entities/jobrun.entity';

jest.mock("fs");
jest.mock("fast-csv");
// Keep actual TypeORM decorators so entity classes load without errors;
// only mock DataSource to avoid real DB connections.
jest.mock("typeorm", () => ({
  ...jest.requireActual("typeorm"),
  DataSource: jest.fn(),
}));

describe("CsvService", () => {
  let service: CsvService;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockLogger: any;

  beforeEach(async () => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        release: jest.fn(),
      }),
      query: jest.fn().mockResolvedValue([]), // Default to empty array
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CsvService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: getRepositoryToken(JobRunEntity), useValue: { findOne: jest.fn() } },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLogger),
          },
        },
        {
          provide: ProjectIdCacheService,
          useValue: {
            getProjectIdFromCache: jest.fn().mockResolvedValue('project-123'),
          },
        },
      ],
    }).compile();

    service = module.get<CsvService>(CsvService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("generateCsv", () => {
    beforeEach(() => {
      // Mock validateFilePath to avoid validation errors on paths
      jest.spyOn(validation, 'validateFilePath').mockImplementation((filePath: string) => true || false);
    });

    it("should throw error for invalid file path", async () => {
      const invalidFilePath = "../../malicious/path.csv";
      const jobRunId = "job-123";
      
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(false);
      
      await expect(service.generateCsv(invalidFilePath, jobRunId))
        .rejects.toThrow('File path contains invalid characters.');
    });
    
    it("should generate CSV file and write data in batches", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";
      const mockData = [
        {
          "source path": "path1",
          "target path": "path2",
          "Migration Type": "type1",
        },
        {
          "source path": "path3",
          "target path": "path4",
          "Migration Type": "type2",
        },
      ];

      mockDataSource.query.mockResolvedValueOnce([{ protocol: 'NFS' }]);
      jest
        .spyOn(service, "getInventoryData")
        .mockResolvedValueOnce(mockData)
        .mockResolvedValueOnce([]);

      mockDataSource.query.mockResolvedValueOnce([]);

      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        once: jest.fn().mockImplementation((event, cb) => { if (event === 'finish') cb(); }),
        destroy: jest.fn(),
      };

      jest
        .spyOn(fs, "createWriteStream")
        .mockReturnValue(mockWriteStream as any);

      jest.spyOn(fastCsv, "format").mockReturnValue(mockWriteStream as any);

      await service.generateCsv(filePath, jobRunId);

      expect(mockWriteStream.write).toHaveBeenCalledTimes(mockData.length);
    });

    it("should handle error in generateCsv method and properly throw", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";

      jest.spyOn(fs, "createWriteStream").mockImplementationOnce(() => {
        throw new Error("File error");
      });

      const result = service.generateCsv(filePath, jobRunId);

      await expect(result).rejects.toThrow("File error");
    });

    it("should handle error in fastCsv.format and properly throw", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";
      const mockData = [
        {
          "source path": "path1",
          "target path": "path2",
          "Migration Type": "type1",
        },
      ];

      mockDataSource.query.mockResolvedValueOnce(mockData);

      jest.spyOn(fs, "createWriteStream").mockReturnValue({
        pipe: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        once: jest.fn().mockImplementation((event, cb) => { if (event === 'finish') cb(); }),
        destroy: jest.fn(),
      } as any);

      jest.spyOn(fastCsv, "format").mockImplementationOnce(() => {
        throw new Error("CSV format error");
      });

      const result = service.generateCsv(filePath, jobRunId);

      await expect(result).rejects.toThrow("CSV format error");
    });

    it("should handle error in mockDataSource.query and properly throw", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";

      mockDataSource.query.mockRejectedValueOnce(new Error("Query error"));

      const result = service.generateCsv(filePath, jobRunId);

      await expect(result).rejects.toThrow("Query error");
    });

    it("should complete generateCsv without errors when data is available", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";
      const mockData = [{ _cursor_path: "/a", "source path": "path1", "target path": "path2" }];

      mockDataSource.query.mockResolvedValueOnce(mockData).mockResolvedValueOnce([]);

      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        once: jest.fn().mockImplementation((event, cb) => { if (event === 'finish') cb(); }),
        destroy: jest.fn(),
      };

      jest
        .spyOn(fs, "createWriteStream")
        .mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockWriteStream as any);

      await service.generateCsv(filePath, jobRunId);

      expect(mockDataSource.query).toHaveBeenCalled();
    });
    it("should generate CSV and call csvStream.end()", async () => {
      const writeStreamMock = {
        pipe: jest.fn(),
        on: jest.fn(),
        once: jest.fn().mockImplementation((event, cb) => { if (event === 'finish') cb(); }),
        destroy: jest.fn(),
      };
      const csvStreamMock = {
        pipe: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        once: jest.fn(),
        destroy: jest.fn(),
      };
      jest.spyOn(fs, 'createWriteStream').mockReturnValue(writeStreamMock as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(csvStreamMock as any);
      jest
        .spyOn(service, "getInventoryData")
        .mockResolvedValueOnce([{ id: 1, name: "File1" }])
        .mockResolvedValueOnce([]);
      await service.generateCsv("/test/path.csv", "job123", 10000);

      expect(fs.createWriteStream).toHaveBeenCalledWith("/test/path.csv");
      expect(csvStreamMock.pipe).toHaveBeenCalledWith(writeStreamMock);
      expect(csvStreamMock.write).toHaveBeenCalledWith({
        id: 1,
        name: "File1",
      });
      expect(csvStreamMock.end).toHaveBeenCalledTimes(1); // ✅ Ensures end() is covered
    });
  });

  describe("getInventoryData", () => {
    it("should return inventory data from the database", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const cursor: string | null = null;
      const mockData = [{ "source path": "path1", "target path": "path2" }];

      mockDataSource.query.mockResolvedValue(mockData);

      const result = await service.getInventoryData(jobRunId, limit, cursor);

      expect(result).toEqual(mockData);
      expect(mockDataSource.query).toHaveBeenCalledWith(expect.any(String), [
        jobRunId,
        cursor,
        limit,
      ]);
    });

    it("should handle empty array from mockDataSource.query", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const cursor: string | null = null;

      mockDataSource.query.mockResolvedValue([]);

      const result = await service.getInventoryData(jobRunId, limit, cursor);

      expect(result).toEqual([]);
      expect(mockDataSource.query).toHaveBeenCalledWith(expect.any(String), [
        jobRunId,
        cursor,
        limit,
      ]);
    });
  });
  describe("getInventoryDataQuery", () => {
    it("should build the correct SQL query and values", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const cursor: string | null = null;

      const result = await service.getInventoryDataQuery(
        jobRunId,
        limit,
        cursor
      );

      expect(result.query).toContain("SELECT");
      // values order: [jobRunId, cursor, limit]
      expect(result.values).toEqual([jobRunId, cursor, limit]);
    });

    it("should include the correct schema in the query", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const cursor: string | null = null;
      process.env.SCHEMA = "testSchema";

      const result = await service.getInventoryDataQuery(
        jobRunId,
        limit,
        cursor
      );

      expect(result.query).toContain("FROM testSchema.inventory");
      expect(result.query).toContain(
        "(i.entry_type IS NULL OR i.entry_type = 'inventory')"
      );
    });
  });

  describe('constructor fallback', () => {
    it('should use fallback logger when LoggerFactory is not provided', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CsvService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: getRepositoryToken(JobRunEntity), useValue: { findOne: jest.fn() } },
          {
            provide: ProjectIdCacheService,
            useValue: { getProjectIdFromCache: jest.fn().mockResolvedValue('project-123') },
          },
          // Note: LoggerFactory is NOT provided, triggering fallback
        ],
      }).compile();

      const fallbackService = module.get<CsvService>(CsvService);
      expect(fallbackService).toBeDefined();
    });
  });

  describe("getMigrationCoCColumns", () => {
    it("should return SMB-specific columns when protocol is SMB", () => {
      const protocol = "SMB";
      const result = service.getMigrationCoCColumns(protocol);

      expect(result).toContain("Source Owner SID");
      expect(result).toContain("Source Group SID");
      expect(result).toContain("Target Owner SID");
      expect(result).toContain("Target Group SID");
      expect(result).toContain("Source ACE Details");
      expect(result).toContain("Target ACE Details");
    });

    it("should return NFS-specific columns when protocol is NFS", () => {
      const protocol = "NFS";
      const result = service.getMigrationCoCColumns(protocol);

      expect(result).toContain("Source UID");
      expect(result).toContain("Source GID");
      expect(result).toContain("Destination UID");
      expect(result).toContain("Destination GID");
      expect(result).toContain("Source Unix Permissions");
      expect(result).toContain("Destination Unix Permissions");
    });

    it("should handle case-insensitive protocol matching", () => {
      const protocols = ["SMB", "smb", "Smb", "sMb"];
    
      protocols.forEach(protocol => {
        const result = service.getMigrationCoCColumns(protocol);
          expect(result).toContain("Source Owner SID");
          expect(result).toContain("Source Group SID");
          expect(result).toContain("Target Owner SID");
          expect(result).toContain("Target Group SID");
          expect(result).toContain("Source ACE Details");
          expect(result).toContain("Target ACE Details");
      });
    });

    it("should return SQL columns with proper SQL formatting for both protocols", () => {
      // Test with SMB
      let result = service.getMigrationCoCColumns("SMB");
      expect(result).toContain("AS");
      expect(result).toContain('"');
      expect(result).not.toContain("undefined");
      expect(result.length).toBeGreaterThan(0);

      // Test with NFS 
      result = service.getMigrationCoCColumns("NFS");
      expect(result).toContain("AS");
      expect(result).toContain('"');
      expect(result).not.toContain("undefined");
      expect(result.length).toBeGreaterThan(0);

      // Both should return valid SQL but different columns
      const smbColumns = service.getMigrationCoCColumns("SMB");
      const nfsColumns = service.getMigrationCoCColumns("NFS");
      expect(smbColumns).not.toEqual(nfsColumns);
    });
    it("should use ACE pattern constants in SMB columns", () => {
      const result = service.getMigrationCoCColumns("SMB");
      
      // Verify the ACE pattern constants are included in the SQL query
      expect(result).toContain("ACE in source:");
      expect(result).toContain("ACE in target:");
    });

    it("should default to NFS columns when protocol is null or empty", () => {
      const resultNull = service.getMigrationCoCColumns(null as any);
      const resultEmpty = service.getMigrationCoCColumns("");
      
      // Both should return NFS columns (default)
      expect(resultNull).toContain("Source UID");
      expect(resultNull).toContain("Source Unix Permissions");
      
      expect(resultEmpty).toContain("Source UID");
      expect(resultEmpty).toContain("Source Unix Permissions");
    });

    it("should include Type column with softlink for SYMBOLIC_LINK file_type", () => {
      const result = service.getMigrationCoCColumns("NFS");

      expect(result).toContain('"Type"');
      expect(result).toContain("softlink");
      expect(result).toContain("SYMBOLIC_LINK");
      expect(result).toContain("directory");
      expect(result).toContain("file");
    });

    it("should include Type column with softlink for SMB protocol", () => {
      const result = service.getMigrationCoCColumns("SMB");

      expect(result).toContain('"Type"');
      expect(result).toContain("softlink");
      expect(result).toContain("SYMBOLIC_LINK");
    });
  });

  describe("getCutoverInventoryDataQuery", () => {
    it("should include Type column in the query", async () => {
      const jobRunId = "job-123";
      const limit = 100;
      const cursor: string | null = null;
      process.env.SCHEMA = "testSchema";

      const result = await service.getCutoverInventoryDataQuery(jobRunId, limit, cursor);

      expect(result.query).toContain('"Type"');
      expect(result.query).toContain("softlink");
      expect(result.query).toContain("SYMBOLIC_LINK");
      expect(result.query).toContain("directory");
      expect(result.query).toContain("file");
      // values order: [jobRunId, cursor, limit]
      expect(result.values).toEqual([jobRunId, cursor, limit]);
    });

    it("should include Type in the outer SELECT with other cutover columns", async () => {
      const result = await service.getCutoverInventoryDataQuery("job-1", 10, null);

      expect(result.query).toContain('"Source Path"');
      expect(result.query).toContain('"Destination Path"');
      expect(result.query).toContain('"Checksum Generated Timestamp (UTC)"');
      expect(result.query).toContain('"Type"');
      expect(result.query).toContain("FROM latest_file_versions");
      expect(result.query).toContain(
        "(i.entry_type IS NULL OR i.entry_type = 'inventory')"
      );
    });
  });

  describe("Cutover CSV - Query Selection Logic", () => {
    it("should call cutover query for CUT_OVER jobType", async () => {
      const jobRunId = "test-job-run-id";
      const limit = 100;
      const cursor: string | null = null;

      // Spy on getCutoverInventoryDataQuery
      const cutoverSpy = jest.spyOn(service as any, 'getCutoverInventoryDataQuery').mockResolvedValue({
        query: "SELECT * FROM cutover",
        values: [jobRunId, limit, cursor]
      });

      mockDataSource.query.mockResolvedValue([{ test: 'data' }]);

      await service.getInventoryData(jobRunId, limit, cursor, 'CUT_OVER');

      expect(cutoverSpy).toHaveBeenCalledWith(jobRunId, limit, cursor);
      expect(cutoverSpy).toHaveBeenCalledTimes(1);

      cutoverSpy.mockRestore();
    });

    it("should call cutover query for lowercase cutover jobType", async () => {
      const cutoverSpy = jest.spyOn(service as any, 'getCutoverInventoryDataQuery').mockResolvedValue({
        query: "SELECT * FROM cutover",
        values: ["test-id", 100, null]
      });

      mockDataSource.query.mockResolvedValue([]);

      await service.getInventoryData("test-id", 100, null, 'cut_over');

      expect(cutoverSpy).toHaveBeenCalled();
      cutoverSpy.mockRestore();
    });

    it("should call regular migration query when jobType is MIGRATE", async () => {
      const migrationSpy = jest.spyOn(service, 'getInventoryDataQuery').mockResolvedValue({
        query: "SELECT * FROM migration",
        values: ["test-id", 100, null]
      });

      mockDataSource.query.mockResolvedValue([]);

      await service.getInventoryData("test-id", 100, null, 'MIGRATE');

      expect(migrationSpy).toHaveBeenCalledWith("test-id", 100, null, "MIGRATE", undefined);
      migrationSpy.mockRestore();
    });

    it("should call regular migration query when jobType is undefined", async () => {
      const migrationSpy = jest.spyOn(service, 'getInventoryDataQuery').mockResolvedValue({
        query: "SELECT * FROM migration",
        values: ["test-id", 100, null]
      });

      mockDataSource.query.mockResolvedValue([]);

      await service.getInventoryData("test-id", 100, null);

      expect(migrationSpy).toHaveBeenCalledWith("test-id", 100, null, undefined, undefined);
      migrationSpy.mockRestore();
    });

    it("should return data from database after query selection", async () => {
      const mockData = [{ path: '/test/file.txt' }];
      mockDataSource.query.mockResolvedValue(mockData);

      const result = await service.getInventoryData("test-id", 100, null, 'CUT_OVER');

      expect(result).toEqual(mockData);
      expect(mockDataSource.query).toHaveBeenCalled();
    });
  });

  describe("Cutover CSV - generateCsv with jobType", () => {
    beforeEach(() => {
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
    });

    it("should call cutover query when jobType is CUT_OVER", async () => {
      const filePath = "/path/to/report.csv";
      const jobRunId = "test-job-run-id";
      const jobType = "CUT_OVER";

      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        once: jest.fn().mockImplementation((event, cb) => { if (event === 'finish') cb(); }),
        destroy: jest.fn(),
      };

      jest.spyOn(fs, "createWriteStream").mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockWriteStream as any);
      jest.spyOn(service, "getInventoryData").mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await service.generateCsv(filePath, jobRunId, 10000, jobType);

      // cursor starts as null; protocol resolved to default NFS from jobRunRepository mock
      expect(service.getInventoryData).toHaveBeenCalledWith(jobRunId, 10000, null, jobType, 'NFS');
    });

    it("should call regular query when jobType is MIGRATE", async () => {
      const filePath = "/path/to/report.csv";
      const jobRunId = "test-job-run-id";
      const jobType = "MIGRATE";

      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        once: jest.fn().mockImplementation((event, cb) => { if (event === 'finish') cb(); }),
        destroy: jest.fn(),
      };

      jest.spyOn(fs, "createWriteStream").mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockWriteStream as any);
      jest.spyOn(service, "getInventoryData").mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await service.generateCsv(filePath, jobRunId, 10000, jobType);

      // cursor starts as null; protocol resolved to default NFS from jobRunRepository mock
      expect(service.getInventoryData).toHaveBeenCalledWith(jobRunId, 10000, null, jobType, 'NFS');
    });
  });

  describe('generateListCsv', () => {
    beforeEach(() => {
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      const mockStream = {
        pipe: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        once: jest.fn().mockImplementation((event: string, cb: () => void) => {
          if (event === 'finish' || event === 'drain') queueMicrotask(() => cb());
        }),
        destroy: jest.fn(),
      };
      jest.spyOn(fs, 'createWriteStream').mockReturnValue(mockStream as any);
      jest.spyOn(fastCsv, 'format').mockReturnValue(mockStream as any);
    });

    it('should throw on invalid file path', async () => {
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(false);

      await expect(
        service.generateListCsv('/bad/path.csv', 'job-1', 'excluded', 10),
      ).rejects.toThrow('File path contains invalid characters.');
    });

    it('should generate excluded list csv with cursor pagination', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ 'Source Path': '/vol/a', Path: '/a' }])
        .mockResolvedValueOnce([]);

      await service.generateListCsv('/tmp/excluded.csv', 'job-1', 'excluded', 1);

      expect(mockDataSource.query).toHaveBeenCalledTimes(2);
      expect(mockDataSource.query.mock.calls[0][0]).toContain("entry_type = 'excluded'");
      expect(mockDataSource.query.mock.calls[0][1]).toEqual(['job-1', null, 1]);
      expect(mockDataSource.query.mock.calls[1][1]).toEqual(['job-1', '/a', 1]);
    });

    it('should select skipped query type', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);

      await service.generateListCsv('/tmp/skipped.csv', 'job-2', 'skipped', 5);
      expect(mockDataSource.query.mock.calls[0][0]).toContain("entry_type = 'skipped'");
    });

    it('should select deleted query type including directories', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);

      await service.generateListCsv('/tmp/deleted.csv', 'job-3', 'deleted', 5);
      expect(mockDataSource.query.mock.calls[0][0]).toContain(
        '(i.is_deleted = true)',
      );
      expect(mockDataSource.query.mock.calls[0][0]).not.toContain(
        'NOT COALESCE(i.is_directory',
      );
    });
  });

  describe('getListEntriesQuery', () => {
    beforeEach(() => { process.env.SCHEMA = 'testSchema'; });

    it('should build excluded query with correct filter and values', async () => {
      const result = await service.getListEntriesQuery('job-1', 50, '/cursor', 'excluded');
      expect(result.query).toContain('FROM testSchema.inventory');
      expect(result.query).toContain("entry_type = 'excluded'");
      expect(result.query).toContain('"Source Path"');
      expect(result.query).toContain('AS "Path"');
      expect(result.query).toContain('v_source.volume_path');
      expect(result.values).toEqual(['job-1', '/cursor', 50]);
    });

    it('should build skipped query with correct filter', async () => {
      const result = await service.getListEntriesQuery('job-1', 25, null, 'skipped');
      expect(result.query).toContain("entry_type = 'skipped'");
      expect(result.values).toEqual(['job-1', null, 25]);
    });

    it('should build deleted query including both files and directories', async () => {
      const result = await service.getListEntriesQuery('job-1', 10, '/p', 'deleted');
      expect(result.query).toContain('(i.is_deleted = true)');
      expect(result.values).toEqual(['job-1', '/p', 10]);
    });
  });

  describe('legacy list query builders (delegates to getListEntriesQuery)', () => {
    beforeEach(() => { process.env.SCHEMA = 'testSchema'; });

    it('should build excluded query with expected values', async () => {
      const result = await service.getExcludedEntriesQuery('job-1', 50, '/cursor');
      expect(result.query).toContain("entry_type = 'excluded'");
      expect(result.values).toEqual(['job-1', '/cursor', 50]);
    });

    it('should build skipped query with expected values', async () => {
      const result = await service.getSkippedEntriesQuery('job-1', 25, null);
      expect(result.query).toContain("entry_type = 'skipped'");
      expect(result.values).toEqual(['job-1', null, 25]);
    });

    it('should build deleted query with expected values', async () => {
      const result = await service.getDeletedEntriesQuery('job-1', 10, '/p');
      expect(result.query).toContain('(i.is_deleted = true)');
      expect(result.values).toEqual(['job-1', '/p', 10]);
    });
  });

  describe('getMigrationCoCColumns include status columns', () => {
    it('should include CopyContentStatus and StampMetaDataStatus columns when enabled', () => {
      const result = service.getMigrationCoCColumns('NFS', true);
      expect(result).toContain('"CopyContentStatus"');
      expect(result).toContain('"StampMetaDataStatus"');
    });
  });
});
