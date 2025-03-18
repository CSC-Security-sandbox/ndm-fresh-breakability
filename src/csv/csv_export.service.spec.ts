import { Test, TestingModule } from "@nestjs/testing";
import { CsvService } from "./csv_export.service";
import { DataSource } from "typeorm";
import * as fs from "fs";
import * as fastCsv from "fast-csv";
import { getRepositoryToken } from '@nestjs/typeorm';

jest.mock('../entities/inventory.entity', () => ({
  InventoryEntity: class MockInventoryEntity { }
}));

jest.mock('../entities/jobrun.entity', () => ({
  JobRunEntity: class MockJobRunEntity { }
}));

jest.mock('../entities/task.entity', () => ({
  TaskEntity: class MockTaskEntity { }
}));

import { InventoryEntity } from '../entities/inventory.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { TaskEntity } from '../entities/task.entity';

describe("CsvService", () => {
  let service: CsvService;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockWriteStream: jest.SpyInstance;
  let mockCsvStream;
  const filePath = "./test.csv";

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockStream = {
      write: jest.fn((chunk, encoding, callback) => {
        if (callback) callback();
        return true;
      }),
      end: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      bytesWritten: 0,
      path: filePath,
      pending: false,
      pipe: jest.fn(),
    } as unknown as fs.WriteStream;

    mockWriteStream = jest.spyOn(fs, 'createWriteStream').mockReturnValue(mockStream);

    mockCsvStream = {
      pipe: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    };
    jest.spyOn(fastCsv, 'format').mockReturnValue(mockCsvStream);

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        release: jest.fn(),
      }),
      query: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CsvService,
        { provide: DataSource, useValue: mockDataSource },
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: { createQueryBuilder: jest.fn() },
        },
        {
          provide: getRepositoryToken(JobRunEntity),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(TaskEntity),
          useValue: { createQueryBuilder: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<CsvService>(CsvService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("generateCsv", () => {
    const jobRunId = "12345";

    it("should generate CSV for migration job", async () => {
      const mockData = [{
        "source path": "/test/path",
        "target path": "/dest/path",
        "Migration Type": "MIGRATE",
        "start time": new Date(),
        "End Time": new Date(),
        "status": "success",
        "type": "f",
        "size": "1024",
        "source checksum": "abc",
        "target checksum": "abc"
      }];

      mockDataSource.query.mockResolvedValueOnce(mockData)
        .mockResolvedValueOnce([]);

      await service.generateCsv(filePath, jobRunId);

      expect(mockWriteStream).toHaveBeenCalledWith(filePath);
      expect(mockCsvStream.write).toHaveBeenCalledWith(mockData[0]);
      expect(mockCsvStream.end).toHaveBeenCalled();
    });

    it("should handle empty data", async () => {
      mockDataSource.query.mockResolvedValueOnce([]);

      await service.generateCsv(filePath, jobRunId);

      expect(mockWriteStream).toHaveBeenCalledWith(filePath);
      expect(mockCsvStream.end).toHaveBeenCalled();
    });
  });

  describe("getInventoryData", () => {
    it("should return inventory data from the database", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;
      const mockData = [{ "source path": "path1", "target path": "path2" }];

      mockDataSource.query.mockResolvedValue(mockData);

      const result = await service.getInventoryData(jobRunId, limit, offset);

      expect(result).toEqual(mockData);
      expect(mockDataSource.query).toHaveBeenCalledWith(expect.any(String), [
        jobRunId,
        limit,
        offset,
      ]);
    });
  });

  describe("getInventoryDataQuery", () => {
    it("should build the correct SQL query and values", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;

      const result = await service.getInventoryDataQuery(jobRunId, limit, offset);

      expect(result.query).toContain("SELECT");
      expect(result.values).toEqual([jobRunId, limit, offset]);
    });

    it("should include the correct schema in the query", async () => {
      process.env.SCHEMA = "testSchema";
      const result = await service.getInventoryDataQuery("12345", 10000, 1);

      expect(result.query).toContain("FROM testSchema.inventory");
      delete process.env.SCHEMA;
    });
  });
});
