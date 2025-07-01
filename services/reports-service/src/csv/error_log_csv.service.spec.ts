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

  // describe("writeLargeCsvToDisk", () => {
  //   beforeEach(() => {
  //     (fs.createWriteStream as any).mockReturnValue({
  //       on: jest.fn((event, cb) => {
  //         if (event === "finish") setTimeout(cb, 0);
  //       }),
  //     });
  //     (fs.writeFileSync as any).mockImplementation(() => {});
  //     (fs.unlinkSync as any).mockImplementation(() => {});
  //   });

  //   // it("writes paginated errors and setup errors to CSV", async () => {
  //   //   jest
  //   //     .spyOn(service, "getPaginatedErrors")
  //   //     .mockResolvedValueOnce([{ id: "1" }])
  //   //     .mockResolvedValueOnce([]);
  //   //   jest.spyOn(service, "getJobRunIds").mockResolvedValue(["run1"]);
  //   //   jest
  //   //     .spyOn(service as any, "fetchFormattedSetupErrors")
  //   //     .mockResolvedValue([{ id: "setup1" }]);
  //   //   await service.writeLargeCsvToDisk("file.csv", "run1", undefined, 1);
  //   //   expect(fs.createWriteStream).toHaveBeenCalled();
  //   //   expect(fs.writeFileSync).toHaveBeenCalled();
  //   //   expect(fs.unlinkSync).toHaveBeenCalled();
  //   // });
  // });

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

    // it("returns filePath if file exists", async () => {
    //   (fs.existsSync as any).mockImplementation((filePath) =>
    //     filePath.includes("job1-error-5.csv")
    //   );
    //   jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(5);
    //   const filePath = path.join(
    //     service.getErrorLogsDirectory,
    //     "job1-error-5.csv"
    //   );
    //   const result = await service.createCsvFileForJob("job1");
    //   expect(result).toBe(filePath);
    // });

    // it("cleans up old files and creates new file", async () => {
    //   (fs.existsSync as any)
    //     .mockReturnValueOnce(false)
    //     .mockReturnValueOnce(true);
    //   jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(3);
    //   const filePath = path.join(
    //     service.getErrorLogsDirectory,
    //     "job1-error-3.csv"
    //   );
    //   const result = await service.createCsvFileForJob("job1");
    //   expect(service.writeLargeCsvToDisk).toHaveBeenCalled();
    //   expect(result).toBe(filePath);
    // });
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

      // it("returns filePath if file already exists (jobRunId)", async () => {
      //   jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(5);
      //   const filePath = path.join(
      //     service.getErrorLogsDirectory,
      //     "job1-error-5.csv"
      //   );
      //   (fs.existsSync as any).mockImplementation((p) => p === filePath);
      //   const result = await service.createCsvFileForJob("job1");
      //   expect(result).toBe(filePath);
      //   expect(service.writeLargeCsvToDisk).not.toHaveBeenCalled();
      // });

      // it("returns filePath if file already exists (jobConfigId)", async () => {
      //   jest.spyOn(service, "getTotalErrorCountForConfig").mockResolvedValue(7);
      //   const filePath = path.join(
      //     service.getErrorLogsDirectory,
      //     "cfg1-error-7.csv"
      //   );
      //   (fs.existsSync as any).mockImplementation((p) => p === filePath);
      //   const result = await service.createCsvFileForJob(undefined, "cfg1");
      //   expect(result).toBe(filePath);
      //   expect(service.writeLargeCsvToDisk).not.toHaveBeenCalled();
      // });

      // it("cleans up old files and creates new file (jobRunId)", async () => {
      //   jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(3);
      //   const dir = service.getErrorLogsDirectory;
      //   const fileName = "job1-error-3.csv";
      //   const filePath = path.join(dir, fileName);
      //   (fs.existsSync as any).mockImplementation((p) => {
      //     if (p === filePath) return false;
      //     if (p === dir) return true;
      //     return false;
      //   });
      //   (fs.readdirSync as any).mockReturnValue([
      //     "job1-error-2.csv",
      //     "job1-error-1.csv",
      //     fileName,
      //   ]);
      //   (fs.unlinkSync as any).mockImplementation(() => {});
      //   const result = await service.createCsvFileForJob("job1");
      //   expect(fs.unlinkSync).toHaveBeenCalledWith(
      //     path.join(dir, "job1-error-2.csv")
      //   );
      //   expect(fs.unlinkSync).toHaveBeenCalledWith(
      //     path.join(dir, "job1-error-1.csv")
      //   );
      //   expect(service.writeLargeCsvToDisk).toHaveBeenCalledWith(
      //     filePath,
      //     "job1",
      //     undefined
      //   );
      //   expect(result).toBe(filePath);
      // });

      // it("cleans up old files and creates new file (jobConfigId)", async () => {
      //   jest.spyOn(service, "getTotalErrorCountForConfig").mockResolvedValue(4);
      //   const dir = service.getErrorLogsDirectory;
      //   const fileName = "cfg1-error-4.csv";
      //   const filePath = path.join(dir, fileName);
      //   (fs.existsSync as any).mockImplementation((p) => {
      //     if (p === filePath) return false;
      //     if (p === dir) return true;
      //     return false;
      //   });
      //   (fs.readdirSync as any).mockReturnValue([
      //     "cfg1-error-2.csv",
      //     "cfg1-error-4.csv",
      //   ]);
      //   (fs.unlinkSync as any).mockImplementation(() => {});
      //   const result = await service.createCsvFileForJob(undefined, "cfg1");
      //   expect(fs.unlinkSync).toHaveBeenCalledWith(
      //     path.join(dir, "cfg1-error-2.csv")
      //   );
      //   expect(service.writeLargeCsvToDisk).toHaveBeenCalledWith(
      //     filePath,
      //     undefined,
      //     "cfg1"
      //   );
      //   expect(result).toBe(filePath);
      // });

      // it("does not delete the file being created", async () => {
      //   jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(2);
      //   const dir = service.getErrorLogsDirectory;
      //   const fileName = "job2-error-2.csv";
      //   const filePath = path.join(dir, fileName);
      //   (fs.existsSync as any).mockImplementation((p) => {
      //     if (p === filePath) return false;
      //     if (p === dir) return true;
      //     return false;
      //   });
      //   (fs.readdirSync as any).mockReturnValue([fileName, "job2-error-1.csv"]);
      //   (fs.unlinkSync as any).mockImplementation(() => {});
      //   await service.createCsvFileForJob("job2");
      //   expect(fs.unlinkSync).toHaveBeenCalledWith(
      //     path.join(dir, "job2-error-1.csv")
      //   );
      //   expect(fs.unlinkSync).not.toHaveBeenCalledWith(
      //     path.join(dir, fileName)
      //   );
      // });

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

      // it("creates the file if it does not exist (jobRunId)", async () => {
      //   jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(8);
      //   const dir = service.getErrorLogsDirectory;
      //   const fileName = "job4-error-8.csv";
      //   const filePath = path.join(dir, fileName);
      //   (fs.existsSync as any).mockImplementation((p) => {
      //     if (p === filePath) return false;
      //     if (p === dir) return true;
      //     return false;
      //   });
      //   (fs.readdirSync as any).mockReturnValue([]);
      //   const result = await service.createCsvFileForJob("job4");
      //   expect(service.writeLargeCsvToDisk).toHaveBeenCalledWith(
      //     filePath,
      //     "job4",
      //     undefined
      //   );
      //   expect(result).toBe(filePath);
      // });

      // it("creates the file if it does not exist (jobConfigId)", async () => {
      //   jest.spyOn(service, "getTotalErrorCountForConfig").mockResolvedValue(9);
      //   const dir = service.getErrorLogsDirectory;
      //   const fileName = "cfg9-error-9.csv";
      //   const filePath = path.join(dir, fileName);
      //   (fs.existsSync as any).mockImplementation((p) => {
      //     if (p === filePath) return false;
      //     if (p === dir) return true;
      //     return false;
      //   });
      //   (fs.readdirSync as any).mockReturnValue([]);
      //   const result = await service.createCsvFileForJob(undefined, "cfg9");
      //   expect(service.writeLargeCsvToDisk).toHaveBeenCalledWith(
      //     filePath,
      //     undefined,
      //     "cfg9"
      //   );
      //   expect(result).toBe(filePath);
      // });

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
