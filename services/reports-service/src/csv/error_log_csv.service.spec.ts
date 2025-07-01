import { ErrorLogService } from "./error_log_csv.service";
import { Repository } from "typeorm";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { StreamableFile, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

// Mocks
jest.mock("fs");
jest.mock("fast-csv", () => ({
  format: jest.fn(() => ({
    pipe: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
}));
jest.mock("@nestjs/common", () => ({
  ...jest.requireActual("@nestjs/common"),
  Logger: jest.fn().mockImplementation(() => ({
    warn: jest.fn(),
  })),
}));

describe("ErrorLogService", () => {
  let service: ErrorLogService;
  let operationErrorRepo: jest.Mocked<Repository<OperationErrorEntity>>;
  let workerJobRunMapRepo: jest.Mocked<Repository<WorkerJobRunMap>>;

  beforeEach(() => {
    operationErrorRepo = {
      query: jest.fn(),
      count: jest.fn(),
    } as any;
    workerJobRunMapRepo = {
      find: jest.fn(),
      count: jest.fn(),
    } as any;
    service = new ErrorLogService(operationErrorRepo, workerJobRunMapRepo);
    jest.clearAllMocks();
  });

  describe("getPaginatedErrors", () => {
    it("throws if neither jobConfigId nor jobRunId is provided", async () => {
      await expect(
        service.getPaginatedErrors({ pageSize: 10, offset: 0 })
      ).rejects.toThrow("Either jobConfigId or jobRunId must be provided");
    });

    it("returns [] if jobConfigId yields no jobRunIds", async () => {
      jest.spyOn(service, "getJobRunIds").mockResolvedValue([]);
      const result = await service.getPaginatedErrors({
        jobConfigId: "cfg1",
        pageSize: 10,
        offset: 0,
      });
      expect(result).toEqual([]);
    });

    it("queries with jobConfigId", async () => {
      jest.spyOn(service, "getJobRunIds").mockResolvedValue(["run1", "run2"]);
      operationErrorRepo.query.mockResolvedValue([{ id: "1" }]);
      const result = await service.getPaginatedErrors({
        jobConfigId: "cfg1",
        pageSize: 10,
        offset: 0,
      });
      expect(operationErrorRepo.query).toHaveBeenCalled();
      expect(result).toEqual([{ id: "1" }]);
    });

    it("queries with jobRunId", async () => {
      operationErrorRepo.query.mockResolvedValue([{ id: "2" }]);
      const result = await service.getPaginatedErrors({
        jobRunId: "run1",
        pageSize: 10,
        offset: 0,
      });
      expect(operationErrorRepo.query).toHaveBeenCalled();
      expect(result).toEqual([{ id: "2" }]);
    });
  });

  describe("getWorkerSetupErrors", () => {
    it("calls find with correct where clause for string", async () => {
      workerJobRunMapRepo.find.mockResolvedValue([{ id: "w1" }] as any);
      const result = await service.getWorkerSetupErrors("run1");
      expect(workerJobRunMapRepo.find).toHaveBeenCalled();
      expect(result).toEqual([{ id: "w1" }]);
    });

    it("calls find with correct where clause for array", async () => {
      workerJobRunMapRepo.find.mockResolvedValue([{ id: "w2" }] as any);
      const result = await service.getWorkerSetupErrors(["run1", "run2"]);
      expect(workerJobRunMapRepo.find).toHaveBeenCalled();
      expect(result).toEqual([{ id: "w2" }]);
    });
  });

  describe("fetchFormattedSetupErrors", () => {
    it("formats worker setup errors", async () => {
      jest.spyOn(service, "getWorkerSetupErrors").mockResolvedValue([
        {
          id: "w1",
          workerResponse: {
            message: "fail",
            createdAt: "2024-01-01",
            operation: "op",
            code: "SETUP_WORKER_FAILURE",
            origin: "origin",
            occurrence: 2,
          },
        } as any,
      ]);
      const result = await (service as any).fetchFormattedSetupErrors("run1");
      expect(result).toEqual([
        {
          Id: "w1",
          "Error Message": "fail",
          "Error Type": "FATAL_ERROR",
          "Created At": "2024-01-01",
          "Operation Type": "op",
          "Error Code": "SETUP_WORKER_FAILURE",
          Origin: "origin",
          Occurrence: 2,
        },
      ]);
    });
  });

  describe("getErrorLogsDirectory", () => {
    it("returns env var if set", () => {
      process.env.ERROR_LOGS_DOWNLOAD_LOCATION = "/tmp/logs";
      expect(service.getErrorLogsDirectory).toBe("/tmp/logs");
      delete process.env.ERROR_LOGS_DOWNLOAD_LOCATION;
    });

    it("returns default if env var not set", () => {
      expect(service.getErrorLogsDirectory).toBe("./error-logs");
    });
  });

  describe("createCsvFileForJob", () => {
    beforeEach(() => {
      (fs.existsSync as any).mockReturnValue(false);
      (fs.readdirSync as any).mockReturnValue(["old.csv"]);
      (fs.unlinkSync as any).mockImplementation(() => {});
      jest.spyOn(service, "writeLargeCsvToDisk").mockResolvedValue();
    });

    it("throws if neither jobRunId nor jobConfigId is provided", async () => {
      await expect(service.createCsvFileForJob()).rejects.toThrow(
        "Either jobRunId or jobConfigId must be provided"
      );
    });
  });

  describe("downloadErrorLogCsvFile", () => {
    beforeEach(() => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.createReadStream as any).mockReturnValue("stream");
      jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(2);
      jest.spyOn(service, "getTotalErrorCountForConfig").mockResolvedValue(4);
      jest.spyOn(service, "createCsvFileForJob").mockResolvedValue("file.csv");
    });

    it("throws if neither jobRunId nor jobConfigId is provided", async () => {
      await expect(service.downloadErrorLogCsvFile()).rejects.toThrow(
        "A jobRunId or jobConfigId must be provided."
      );
    });

    it("returns StreamableFile for jobRunId", async () => {
      const result = await service.downloadErrorLogCsvFile("job1");
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it("returns StreamableFile for jobConfigId", async () => {
      const result = await service.downloadErrorLogCsvFile(undefined, "cfg1");
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it("creates file if not exists", async () => {
      (fs.existsSync as any).mockReturnValue(false);
      await service.downloadErrorLogCsvFile("job1");
      expect(service.createCsvFileForJob).toHaveBeenCalled();
    });
  });

  describe("isCsvFileUpToDate", () => {
    it("returns true if file exists", async () => {
      (fs.existsSync as any).mockReturnValue(true);
      jest.spyOn(service, "getTotalErrorCountForConfig").mockResolvedValue(2);
      const result = await service.isCsvFileUpToDate("cfg1");
      expect(result).toBe(true);
    });

    it("returns false if file does not exist", async () => {
      (fs.existsSync as any).mockReturnValue(false);
      jest.spyOn(service, "getTotalErrorCountForConfig").mockResolvedValue(2);
      const result = await service.isCsvFileUpToDate("cfg1");
      expect(result).toBe(false);
    });
  });

  describe("getJobRunIds", () => {
    it("returns mapped ids", async () => {
      operationErrorRepo.query.mockResolvedValue([{ id: "a" }, { id: "b" }]);
      const result = await service.getJobRunIds("cfg1");
      expect(result).toEqual(["a", "b"]);
    });
  });

  describe("getTotalErrorCountForJobRun", () => {
    it("returns sum of opCount and workerSetupCount", async () => {
      operationErrorRepo.query.mockResolvedValue([{ count: "3" }]);
      jest.spyOn(service as any, "getWorkerSetupCount").mockResolvedValue(2);
      const result = await service.getTotalErrorCountForJobRun("run1");
      expect(result).toBe(5);
    });
  });

  describe("getTotalErrorCountForConfig", () => {
    it("returns 0 if no jobRunIds", async () => {
      jest.spyOn(service, "getJobRunIds").mockResolvedValue([]);
      const result = await service.getTotalErrorCountForConfig("cfg1");
      expect(result).toBe(0);
    });

    it("returns sum of opCount and workerSetupCount", async () => {
      jest.spyOn(service, "getJobRunIds").mockResolvedValue(["run1", "run2"]);
      operationErrorRepo.query.mockResolvedValue([{ count: "4" }]);
      jest.spyOn(service as any, "getWorkerSetupCount").mockResolvedValue(1);
      const result = await service.getTotalErrorCountForConfig("cfg1");
      expect(result).toBe(5);
    });
  });

  describe("isCsvFileReady", () => {
    it("throws if neither jobRunId nor jobConfigId is provided", async () => {
      await expect(service.isCsvFileReady()).rejects.toThrow(
        "A jobRunId or jobConfigId must be provided."
      );
    });

    it("returns ready and processing flags", async () => {
      (fs.existsSync as any).mockImplementation((filePath) => {
        if (filePath.endsWith(".processing")) return false;
        return true;
      });
      jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(2);
      const result = await service.isCsvFileReady("job1");
      expect(result).toEqual({ ready: true, processing: false });
    });

    it("returns processing true if processing file exists", async () => {
      (fs.existsSync as any).mockImplementation((filePath) => {
        if (filePath.endsWith(".processing")) return true;
        return false;
      });
      jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(2);
      const result = await service.isCsvFileReady("job1");
      expect(result).toEqual({ ready: false, processing: true });
    });

    describe("createCsvFileForJob", () => {
      beforeEach(() => {
        (fs.existsSync as any).mockReset();
        (fs.readdirSync as any).mockReset();
        (fs.unlinkSync as any).mockReset();
        jest.spyOn(service, "writeLargeCsvToDisk").mockResolvedValue();
      });

      it("throws if neither jobRunId nor jobConfigId is provided", async () => {
        await expect(service.createCsvFileForJob()).rejects.toThrow(
          "Either jobRunId or jobConfigId must be provided"
        );
      });

      it("does not throw if unlinkSync throws, but logs a warning", async () => {
        jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(2);
        const dir = service.getErrorLogsDirectory;
        const fileName = "job3-error-2.csv";
        const filePath = path.join(dir, fileName);
        (fs.existsSync as any).mockImplementation((p) => {
          if (p === filePath) return false;
          if (p === dir) return true;
          return false;
        });
        (fs.readdirSync as any).mockReturnValue(["job3-error-1.csv"]);
        const error = new Error("fail");
        (fs.unlinkSync as any).mockImplementation(() => {
          throw error;
        });
        const loggerWarn = (service as any).logger.warn;
        await service.createCsvFileForJob("job3");
        expect(loggerWarn).toHaveBeenCalledWith(
          expect.stringContaining(
            "Failed to delete old error log file: job3-error-1.csv. Reason: fail"
          )
        );
      });

      it("handles error when writeLargeCsvToDisk rejects", async () => {
        jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(2);
        const dir = service.getErrorLogsDirectory;
        const fileName = "job5-error-2.csv";
        const filePath = path.join(dir, fileName);
        (fs.existsSync as any).mockImplementation((p) => {
          if (p === filePath) return false;
          if (p === dir) return true;
          return false;
        });
        (fs.readdirSync as any).mockReturnValue([]);
        const error = new Error("disk error");
        (service.writeLargeCsvToDisk as jest.Mock).mockRejectedValue(error);
        await expect(service.createCsvFileForJob("job5")).rejects.toThrow(
          "disk error"
        );
      });

      it("throws if file name is invalid in sanitizeAndValidateFilePath", () => {
        expect(() =>
          (service as any).sanitizeAndValidateFilePath("../evil.csv")
        ).toThrow("Invalid file path: Path traversal detected");
        expect(() =>
          (service as any).sanitizeAndValidateFilePath("badfile.txt")
        ).toThrow("Invalid file name");
      });

      it("returns resolved path for valid file name in sanitizeAndValidateFilePath", () => {
        const dir = service.getErrorLogsDirectory;
        const fileName = "job1-error-1.csv";
        const expected = path.resolve(dir, fileName);
        expect((service as any).sanitizeAndValidateFilePath(fileName)).toBe(
          expected
        );
      });
    });
  });
});
