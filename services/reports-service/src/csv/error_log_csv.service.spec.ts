import { ErrorLogService } from "./error_log_csv.service";
import { BadRequestException, StreamableFile } from "@nestjs/common";
import { Repository } from "typeorm";
import * as fs from "fs";
import * as fastCsv from "fast-csv";
import * as path from "path";

// Mocks for file-utils
jest.mock("../utils/file-utils", () => ({
  sanitizeAndValidateFilePath: jest.fn((fileName) => fileName),
  sanitizeIdentifier: jest.fn((id) => id),
}));

jest.mock("fs");
jest.mock("fast-csv", () => ({
  format: jest.fn(() => ({
    pipe: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
}));

const mockOperationErrorRepo = {
  query: jest.fn(),
  count: jest.fn(),
};
const mockWorkerJobRunMapRepo = {
  query: jest.fn(),
  count: jest.fn(),
};

describe("ErrorLogService", () => {
  let service: ErrorLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ErrorLogService(
      mockOperationErrorRepo as any as Repository<any>,
      mockWorkerJobRunMapRepo as any as Repository<any>
    );
  });

  describe("handleError", () => {
    it("throws if both jobRunId and jobConfigId are missing", async () => {
      await expect(service.handleError(undefined, undefined)).rejects.toThrow(
        BadRequestException
      );
    });

    it("throws if both jobRunId and jobConfigId are provided", async () => {
      await expect(service.handleError("run", "config")).rejects.toThrow(
        BadRequestException
      );
    });

    it("does not throw if only jobRunId is provided", async () => {
      await expect(
        service.handleError("run", undefined)
      ).resolves.toBeUndefined();
    });

    it("does not throw if only jobConfigId is provided", async () => {
      await expect(
        service.handleError(undefined, "config")
      ).resolves.toBeUndefined();
    });
  });

  describe("getPaginatedErrors", () => {
    beforeEach(() => {
      jest.spyOn(service, "handleError").mockResolvedValue(undefined as any);
    });

    it("queries by jobConfigId", async () => {
      mockOperationErrorRepo.query.mockResolvedValue([{ id: 1 }]);
      const result = await service.getPaginatedErrors({
        jobConfigId: "config",
        pageSize: 10,
        offset: 0,
      });
      expect(mockOperationErrorRepo.query).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1 }]);
    });

    it("queries by jobRunId", async () => {
      mockOperationErrorRepo.query.mockResolvedValue([{ id: 2 }]);
      const result = await service.getPaginatedErrors({
        jobRunId: "run",
        pageSize: 5,
        offset: 1,
      });
      expect(mockOperationErrorRepo.query).toHaveBeenCalled();
      expect(result).toEqual([{ id: 2 }]);
    });

    // it("throws BadRequestException on error", async () => {
    //   mockOperationErrorRepo.query.mockRejectedValue(new Error("fail"));
    //   await expect(
    //     service.getPaginatedErrors({
    //       jobRunId: "run",
    //       pageSize: 5,
    //       offset: 1,
    //     })
    //   ).rejects.toThrow(BadRequestException);
    // });
  });

  describe("getWorkerSetupErrors", () => {
    it("returns empty array if jobRunIds is empty array", async () => {
      const result = await service.getWorkerSetupErrors([]);
      expect(result).toEqual([]);
    });

    it("queries with array of jobRunIds", async () => {
      mockWorkerJobRunMapRepo.query.mockResolvedValue([{ id: 1 }]);
      const result = await service.getWorkerSetupErrors(["a", "b"]);
      expect(mockWorkerJobRunMapRepo.query).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1 }]);
    });

    it("queries with single jobRunId", async () => {
      mockWorkerJobRunMapRepo.query.mockResolvedValue([{ id: 2 }]);
      const result = await service.getWorkerSetupErrors("run");
      expect(mockWorkerJobRunMapRepo.query).toHaveBeenCalled();
      expect(result).toEqual([{ id: 2 }]);
    });

    // it("throws BadRequestException on error", async () => {
    //   mockWorkerJobRunMapRepo.query.mockRejectedValue(new Error("fail"));
    //   await expect(service.getWorkerSetupErrors("run")).rejects.toThrow(
    //     BadRequestException
    //   );
    // });
  });

  describe("escapeRegex", () => {
    it("escapes regex metacharacters", () => {
      const input = "a.b*c?d+e^f$g(h)i|j[k]l{m}\\";
      const output = service["escapeRegex"](input);
      expect(output).toBe(
        "a\\.b\\*c\\?d\\+e\\^f\\$g\\(h\\)i\\|j\\[k\\]l\\{m\\}\\\\"
      );
    });
  });

  describe("parseWorkerResponse", () => {
    it("returns empty object for falsy", () => {
      expect(service.parseWorkerResponse(null)).toEqual({});
    });
    it("parses JSON string", () => {
      expect(service.parseWorkerResponse('{"a":1}')).toEqual({ a: 1 });
    });
    it("returns empty object for invalid JSON", () => {
      expect(service.parseWorkerResponse("{invalid")).toEqual({});
    });
    it("returns object as is", () => {
      expect(service.parseWorkerResponse({ b: 2 })).toEqual({ b: 2 });
    });
  });

  describe("fetchFormattedSetupErrors", () => {
    it("formats errors correctly", async () => {
      jest.spyOn(service, "getWorkerSetupErrors").mockResolvedValue([
        {
          id: "1",
          job_run_id: "run",
          job_type: "type",
          worker_response:
            '{"createdAt":"now","message":"msg","origin":"o","operation":"op","code":"c"}',
        },
      ]);
      const result = await (service as any).fetchFormattedSetupErrors("run");
      expect(result[0]).toMatchObject({
        "Error Id": "1",
        "Created At": "now",
        "Job Run Id": "run",
        "Job Type": "type",
        "Error Type": "FATAL_ERROR",
        "Error Details": "msg",
        Origin: "o",
        Operation: "op",
        Code: "c",
        Occurrence: 1,
      });
    });

    it("throws BadRequestException on error", async () => {
      jest
        .spyOn(service, "getWorkerSetupErrors")
        .mockRejectedValue(new Error("fail"));
      await expect(
        (service as any).fetchFormattedSetupErrors("run")
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("getErrorLogsDirectory", () => {
    it("returns env var if set", () => {
      process.env.ERROR_LOGS_DOWNLOAD_LOCATION = "/tmp/logs";
      expect(service.getErrorLogsDirectory).toBe("/tmp/logs");
    });
    it("returns default if env var not set", () => {
      delete process.env.ERROR_LOGS_DOWNLOAD_LOCATION;
      expect(service.getErrorLogsDirectory).toBe("./error-logs");
    });
  });

  describe("getJobRunIds", () => {
    it("returns ids from query", async () => {
      mockOperationErrorRepo.query.mockResolvedValue([
        { id: "a" },
        { id: "b" },
      ]);
      const ids = await service.getJobRunIds("config");
      expect(ids).toEqual(["a", "b"]);
    });

    it("throws BadRequestException on error", async () => {
      mockOperationErrorRepo.query.mockRejectedValue(new Error("fail"));
      await expect(service.getJobRunIds("config")).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe("getTotalErrorCountForJobRun", () => {
    it("returns sum of opCount and workerSetupCount", async () => {
      mockOperationErrorRepo.query.mockResolvedValue([{ count: "2" }]);
      jest.spyOn(service as any, "getWorkerSetupCount").mockResolvedValue(3);
      const count = await service.getTotalErrorCountForJobRun("run");
      expect(count).toBe(5);
    });

    it("throws BadRequestException on error", async () => {
      mockOperationErrorRepo.query.mockRejectedValue(new Error("fail"));
      await expect(service.getTotalErrorCountForJobRun("run")).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe("getTotalErrorCountForConfig", () => {
    it("returns 0 if no jobRunIds", async () => {
      jest.spyOn(service, "getJobRunIds").mockResolvedValue([]);
      const count = await service.getTotalErrorCountForConfig("config");
      expect(count).toBe(0);
    });

    it("returns sum of opCount and workerSetupCount", async () => {
      jest.spyOn(service, "getJobRunIds").mockResolvedValue(["a", "b"]);
      mockOperationErrorRepo.query.mockResolvedValue([{ count: "4" }]);
      jest.spyOn(service as any, "getWorkerSetupCount").mockResolvedValue(2);
      const count = await service.getTotalErrorCountForConfig("config");
      expect(count).toBe(6);
    });

    it("throws BadRequestException on error", async () => {
      jest.spyOn(service, "getJobRunIds").mockRejectedValue(new Error("fail"));
      await expect(
        service.getTotalErrorCountForConfig("config")
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("getWorkerSetupCount", () => {
    it("calls count with correct params", async () => {
      mockWorkerJobRunMapRepo.count.mockResolvedValue(7);
      const count = await (service as any).getWorkerSetupCount("run");
      expect(count).toBe(7);
    });

    // it("throws BadRequestException on error", async () => {
    //   mockWorkerJobRunMapRepo.count.mockRejectedValue(new Error("fail"));
    //   await expect((service as any).getWorkerSetupCount("run")).rejects.toThrow(
    //     BadRequestException
    //   );
    // });
  });

  describe("isCsvFileReady", () => {
    beforeEach(() => {
      jest.spyOn(service, "handleError").mockResolvedValue(undefined as any);
      jest
        .spyOn(service, "getTotalErrorCountForJobRun")
        .mockResolvedValue(1 as any);
      jest
        .spyOn(service, "getTotalErrorCountForConfig")
        .mockResolvedValue(2 as any);
      (fs.existsSync as jest.Mock).mockReturnValue(false);
    });

    it("returns ready=false, processing=false if neither file exists", async () => {
      const result = await service.isCsvFileReady("run", undefined);
      expect(result).toEqual({ ready: false, processing: false });
    });

    it("returns processing=true if processing file exists", async () => {
      (fs.existsSync as jest.Mock).mockImplementation((file) =>
        (file as string).endsWith(".processing")
      );
      const result = await service.isCsvFileReady("run", undefined);
      expect(result).toEqual({ ready: false, processing: true });
    });

    it("returns ready=true if file exists and not processing", async () => {
      (fs.existsSync as jest.Mock).mockImplementation(
        (file) => !(file as string).endsWith(".processing")
      );
      const result = await service.isCsvFileReady("run", undefined);
      expect(result).toEqual({ ready: true, processing: false });
    });

    it("throws BadRequestException on error", async () => {
      jest
        .spyOn(service, "getTotalErrorCountForJobRun")
        .mockRejectedValue(new Error("fail"));
      await expect(service.isCsvFileReady("run", undefined)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  // Integration-like tests for createCsvFileForJob and downloadErrorLogCsvFile
  describe("createCsvFileForJob", () => {
    beforeEach(() => {
      jest.spyOn(service, "handleError").mockResolvedValue(undefined as any);
      jest
        .spyOn(service, "getTotalErrorCountForJobRun")
        .mockResolvedValue(1 as any);
      jest
        .spyOn(service, "getTotalErrorCountForConfig")
        .mockResolvedValue(2 as any);
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);
      jest
        .spyOn(service, "writeLargeCsvToDisk")
        .mockResolvedValue(undefined as any);
    });

    it("returns file path if file exists", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = await service.createCsvFileForJob("run", undefined);
      expect(result).toBe("run-error-1.csv");
    });

    it("cleans up old files and starts CSV generation", async () => {
      (fs.existsSync as jest.Mock).mockImplementation(
        (file) => file === "./error-logs"
      );
      (fs.readdirSync as jest.Mock).mockReturnValue([
        "run-error-1.csv",
        "run-error-2.csv",
      ]);
      const unlinkSync = (fs.unlinkSync as jest.Mock).mockImplementation(
        () => {}
      );
      const result = await service.createCsvFileForJob("run", undefined);
      expect(unlinkSync).toHaveBeenCalled();
      expect(result).toEqual({ message: "CSV generation started" });
    });

    it("throws BadRequestException on error", async () => {
      jest
        .spyOn(service, "getTotalErrorCountForJobRun")
        .mockRejectedValue(new Error("fail"));
      await expect(
        service.createCsvFileForJob("run", undefined)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("downloadErrorLogCsvFile", () => {
    beforeEach(() => {
      jest.spyOn(service, "handleError").mockResolvedValue(undefined as any);
      jest
        .spyOn(service, "getTotalErrorCountForJobRun")
        .mockResolvedValue(1 as any);
      jest
        .spyOn(service, "getTotalErrorCountForConfig")
        .mockResolvedValue(2 as any);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.createReadStream as jest.Mock).mockReturnValue("stream");
    });

    it("returns StreamableFile if file exists", async () => {
      const result = await service.downloadErrorLogCsvFile("run", undefined);
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it("calls createCsvFileForJob if file does not exist", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      jest
        .spyOn(service, "createCsvFileForJob")
        .mockResolvedValue(undefined as any);
      (fs.createReadStream as jest.Mock).mockReturnValue("stream");
      const result = await service.downloadErrorLogCsvFile("run", undefined);
      expect(service.createCsvFileForJob).toHaveBeenCalled();
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it("throws BadRequestException on error", async () => {
      jest
        .spyOn(service, "getTotalErrorCountForJobRun")
        .mockRejectedValue(new Error("fail"));
      await expect(
        service.downloadErrorLogCsvFile("run", undefined)
      ).rejects.toThrow(BadRequestException);
    });
  });

  // writeLargeCsvToDisk is complex and involves streams, so only a basic test
  describe("writeLargeCsvToDisk", () => {
    beforeEach(() => {
      (fs.createWriteStream as jest.Mock).mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === "finish") setTimeout(cb, 0);
        }),
        end: jest.fn(),
      });
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      jest.spyOn(service, "getPaginatedErrors").mockResolvedValue([]);
      jest.spyOn(service, "getJobRunIds").mockResolvedValue([]);
      jest
        .spyOn(service as any, "fetchFormattedSetupErrors")
        .mockResolvedValue([]);
    });

    it("writes CSV and resolves", async () => {
      await expect(
        service.writeLargeCsvToDisk("file.csv", "run", undefined, 10)
      ).resolves.toBeUndefined();
    });

    // it("throws BadRequestException on error", async () => {
    //   jest
    //     .spyOn(service, "getPaginatedErrors")
    //     .mockRejectedValue(new Error("fail"));
    //   await expect(
    //     service.writeLargeCsvToDisk("file.csv", "run", undefined, 10)
    //   ).rejects.toThrow(BadRequestException);
    // });
  });
});
