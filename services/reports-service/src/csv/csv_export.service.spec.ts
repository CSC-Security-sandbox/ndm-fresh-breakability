import { Test, TestingModule } from "@nestjs/testing";
import { CsvService } from "./csv_export.service";
import { DataSource } from "typeorm";
import * as fs from "fs";
import * as fastCsv from "fast-csv";
import exp from "constants";
import * as validation from '../utils/utils';
import { InternalServerErrorException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";

jest.mock("fs");
jest.mock("fast-csv");
jest.mock("typeorm");

describe("CsvService", () => {
  let service: CsvService;
  let mockDataSource: jest.Mocked<DataSource>;
  let loggerMock: any;

  beforeEach(async () => {
    loggerMock = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };
    process.env.SCHEMA = 'test_schema';

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
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(loggerMock),
          },
        },
      ],
    }).compile();

    service = module.get<CsvService>(CsvService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("constructor", () => {
    it("should use fallback logger when LoggerFactory is not provided", () => {
      const serviceWithFallback = new CsvService(mockDataSource);
      expect(serviceWithFallback).toBeDefined();
    });

    it("should use LoggerFactory when provided", () => {
      const mockLoggerFactory = {
        create: jest.fn().mockReturnValue(loggerMock),
      };
      const serviceWithLogger = new CsvService(mockDataSource, mockLoggerFactory as any);
      expect(serviceWithLogger).toBeDefined();
      expect(mockLoggerFactory.create).toHaveBeenCalledWith(CsvService.name);
    });
  });

  describe("generateCsv", () => {
    beforeEach(() => {
      // Mock validateFilePath to avoid validation errors on paths
      jest.spyOn(validation, 'validateFilePath').mockImplementation((filePath: string) => true || false);
    });

    it("should throw BadRequestException for invalid file path", async () => {
      const filePath = "invalid/path/../test.csv";
      const jobRunId = "12345";
      
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(false);

      await expect(service.generateCsv(filePath, jobRunId)).rejects.toThrow(
        'File path contains invalid characters.'
      );
      expect(loggerMock.error).toHaveBeenCalledWith(
        `File path contains invalid characters: ${filePath}`
      );
    });

    it("should log successful file path validation", async () => {
      const filePath = "valid/path/test.csv";
      const jobRunId = "12345";
      
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      jest.spyOn(service, "getInventoryData").mockResolvedValue([]);
      
      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      const mockCsvStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      
      jest.spyOn(fs, "createWriteStream").mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockCsvStream as any);

      await service.generateCsv(filePath, jobRunId);
      
      expect(loggerMock.log).toHaveBeenCalledWith(
        `File path validation passed: ${filePath}`
      );
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

      // Set up all necessary mocks
      jest.spyOn(service, "getInventoryData").mockResolvedValueOnce(mockData).mockResolvedValueOnce([]);

      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
      };

      const mockCsvStream = {
        pipe: jest.fn().mockReturnValue(mockWriteStream),
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
      };

      jest
        .spyOn(fs, "createWriteStream")
        .mockReturnValue(mockWriteStream as any);

      jest.spyOn(fastCsv, "format").mockReturnValue(mockCsvStream as any);

      await service.generateCsv(filePath, jobRunId);

      expect(mockCsvStream.write).toHaveBeenCalledTimes(mockData.length);
      expect(mockCsvStream.pipe).toHaveBeenCalledWith(mockWriteStream);
    });

    it("should handle BadRequestException and re-throw it", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";
      
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      
      const badRequestError = new BadRequestException("Invalid request");
      jest.spyOn(service, "getInventoryData").mockRejectedValue(badRequestError);
      
      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      const mockCsvStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      
      jest.spyOn(fs, "createWriteStream").mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockCsvStream as any);

      await expect(service.generateCsv(filePath, jobRunId)).rejects.toThrow(BadRequestException);
      expect(loggerMock.error).toHaveBeenCalledWith('Bad request in generateCsv:', badRequestError);
    });

    it("should handle database connection errors", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";
      
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      
      const dbError = new Error("Connection refused") as any;
      dbError.code = "ECONNREFUSED";
      jest.spyOn(service, "getInventoryData").mockRejectedValue(dbError);
      
      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      const mockCsvStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      
      jest.spyOn(fs, "createWriteStream").mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockCsvStream as any);

      await expect(service.generateCsv(filePath, jobRunId)).rejects.toThrow(
        'Database connection failed.'
      );
      expect(loggerMock.error).toHaveBeenCalledWith('Database connection failed in generateCsv:', dbError);
    });

    it("should handle QueryFailedError", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";
      
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      
      const queryError = new Error("Query failed");
      queryError.name = "QueryFailedError";
      jest.spyOn(service, "getInventoryData").mockRejectedValue(queryError);
      
      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      const mockCsvStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      
      jest.spyOn(fs, "createWriteStream").mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockCsvStream as any);

      await expect(service.generateCsv(filePath, jobRunId)).rejects.toThrow(
        'Database connection failed.'
      );
      expect(loggerMock.error).toHaveBeenCalledWith('Database connection failed in generateCsv:', queryError);
    });

    it("should handle TypeError", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";
      
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      
      const typeError = new TypeError("Type error");
      jest.spyOn(service, "getInventoryData").mockRejectedValue(typeError);
      
      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      const mockCsvStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      
      jest.spyOn(fs, "createWriteStream").mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockCsvStream as any);

      await expect(service.generateCsv(filePath, jobRunId)).rejects.toThrow(
        'Invalid input for CSV generation.'
      );
      expect(loggerMock.error).toHaveBeenCalledWith('Type error in generateCsv:', typeError);
    });

    it("should handle unknown errors", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";
      
      jest.spyOn(validation, 'validateFilePath').mockReturnValue(true);
      
      const unknownError = new Error("Unknown error");
      jest.spyOn(service, "getInventoryData").mockRejectedValue(unknownError);
      
      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      const mockCsvStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      
      jest.spyOn(fs, "createWriteStream").mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockCsvStream as any);

      await expect(service.generateCsv(filePath, jobRunId)).rejects.toThrow(
        'Failed to generate CSV file.'
      );
      expect(loggerMock.error).toHaveBeenCalledWith('Unknown error in generateCsv:', unknownError);
    });

    it("should handle error in generateCsv method and not crash", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";

      jest.spyOn(fs, "createWriteStream").mockImplementationOnce(() => {
        throw new Error("File error");
      });

      const result = service.generateCsv(filePath, jobRunId);

      await expect(result).rejects.toThrow(InternalServerErrorException);
    });

    it("should handle error in fastCsv.format and not crash", async () => {
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
        write: jest.fn(),
        end: jest.fn(),
      } as any);

      jest.spyOn(fastCsv, "format").mockImplementationOnce(() => {
        throw new Error("CSV format error");
      });

      const result = service.generateCsv(filePath, jobRunId);

      await expect(result).rejects.toThrow(InternalServerErrorException);
    });

    it("should handle error in mockDataSource.query and not crash", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";

      mockDataSource.query.mockRejectedValueOnce(new Error("Query error"));

      const result = service.generateCsv(filePath, jobRunId);

      await expect(result).rejects.toThrow(InternalServerErrorException);
    });

    it("should call release on queryRunner after completing generateCsv", async () => {
      const filePath = "test.csv";
      const jobRunId = "12345";
      const mockData = [{ "source path": "path1", "target path": "path2" }];

      // Set up all necessary mocks  
      jest.spyOn(service, "getInventoryData").mockResolvedValueOnce(mockData).mockResolvedValueOnce([]);

      const mockWriteStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
      };

      const mockCsvStream = {
        pipe: jest.fn().mockReturnValue(mockWriteStream),
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
      };

      jest
        .spyOn(fs, "createWriteStream")
        .mockReturnValue(mockWriteStream as any);
      jest.spyOn(fastCsv, "format").mockReturnValue(mockCsvStream as any);

      await service.generateCsv(filePath, jobRunId);

      expect(mockDataSource.createQueryRunner().release).toHaveBeenCalled();
    });

    it("should generate CSV and call csvStream.end()", async () => {
      const writeStreamMock = {
        pipe: jest.fn(),
        on: jest.fn(),
        end: jest.fn(), 
      };
      const csvStreamMock = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
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
      expect(csvStreamMock.end).toHaveBeenCalledTimes(1);
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

    it("should handle empty array from mockDataSource.query", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;

      mockDataSource.query.mockResolvedValue([]);

      const result = await service.getInventoryData(jobRunId, limit, offset);

      expect(result).toEqual([]);
      expect(mockDataSource.query).toHaveBeenCalledWith(expect.any(String), [
        jobRunId,
        limit,
        offset,
      ]);
    });

    it("should handle InternalServerErrorException and re-throw it", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;
      
      const internalError = new InternalServerErrorException("Internal server error");
      jest.spyOn(service, "getInventoryDataQuery").mockRejectedValue(internalError);

      await expect(service.getInventoryData(jobRunId, limit, offset)).rejects.toThrow(InternalServerErrorException);
    });

    it("should handle TypeError and throw BadRequestException", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;
      
      const typeError = new TypeError("Type error");
      jest.spyOn(service, "getInventoryDataQuery").mockRejectedValue(typeError);

      await expect(service.getInventoryData(jobRunId, limit, offset)).rejects.toThrow(
        'Invalid input for inventory data query.'
      );
    });

    it("should handle database connection errors", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;
      
      const dbError = new Error("Connection refused") as any;
      dbError.code = "ECONNREFUSED";
      jest.spyOn(service, "getInventoryDataQuery").mockRejectedValue(dbError);

      await expect(service.getInventoryData(jobRunId, limit, offset)).rejects.toThrow(
        'Database connection failed.'
      );
    });

    it("should handle QueryFailedError", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;
      
      const queryError = new Error("Query failed");
      queryError.name = "QueryFailedError";
      jest.spyOn(service, "getInventoryDataQuery").mockRejectedValue(queryError);

      await expect(service.getInventoryData(jobRunId, limit, offset)).rejects.toThrow(
        'Database connection failed.'
      );
    });

    it("should handle unknown errors", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;
      
      const unknownError = new Error("Unknown error");
      jest.spyOn(service, "getInventoryDataQuery").mockRejectedValue(unknownError);

      await expect(service.getInventoryData(jobRunId, limit, offset)).rejects.toThrow(
        'Failed to get inventory data.'
      );
    });
  });
  
  describe("getInventoryDataQuery", () => {
    it("should build the correct SQL query and values", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;

      const result = await service.getInventoryDataQuery(
        jobRunId,
        limit,
        offset
      );

      expect(result.query).toContain("SELECT");
      expect(result.values).toEqual([jobRunId, limit, offset]);
    });

    it("should include the correct schema in the query", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;
      process.env.SCHEMA = "testSchema";

      const result = await service.getInventoryDataQuery(
        jobRunId,
        limit,
        offset
      );

      expect(result.query).toContain("FROM testSchema.inventory");
    });

    it("should throw InternalServerErrorException when SCHEMA is not defined", async () => {
      const jobRunId = "12345";
      const limit = 10000;
      const offset = 1;
      
      // Remove SCHEMA from environment
      delete process.env.SCHEMA;

      await expect(service.getInventoryDataQuery(jobRunId, limit, offset)).rejects.toThrow(
        'Database schema (SCHEMA) is not defined in environment variables.'
      );
    });
  });
});
