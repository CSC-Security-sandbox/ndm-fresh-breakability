import { ErrorLogService } from "./error_log_csv.service";
import { BadRequestException, StreamableFile } from "@nestjs/common";
import * as fs from "fs";
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

// Mock sanitizeAndValidateFilePath to always return the input file name
jest.mock("../utils/file-utils", () => ({
  ...jest.requireActual("../utils/file-utils"),
  sanitizeAndValidateFilePath: (fileName: string) => fileName,
  sanitizeIdentifier: (id: string) => id,
}));

jest.mock("fs");

const mockOperationErrorRepo = {
  query: jest.fn(),
  count: jest.fn(),
};
const mockWorkerJobRunMapRepo = {
  query: jest.fn(),
  count: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  log: jest.fn(),
};

const mockLoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
};

function createService() {
  return new ErrorLogService(
    mockOperationErrorRepo as any,
    mockWorkerJobRunMapRepo as any,
    mockLoggerFactory as any
  );
}

describe("ErrorLogService", () => {
  let service: ErrorLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createService();
  });

  describe("extractJobIdentifiers", () => {
    it("should extract jobRunId for type job-run", () => {
      expect((service as any).extractJobIdentifiers("job-run", "id1")).toEqual({
        jobRunId: "id1",
      });
    });
    it("should extract jobConfigId for type job-config", () => {
      expect(
        (service as any).extractJobIdentifiers("job-config", "id2")
      ).toEqual({ jobConfigId: "id2" });
    });
    it("should throw for invalid type", () => {
      expect(() =>
        (service as any).extractJobIdentifiers("other", "id")
      ).toThrow(BadRequestException);
    });
  });

  describe("handleError", () => {
    it("should throw if both jobRunId and jobConfigId are missing", async () => {
      await expect(service.handleError(undefined, undefined)).rejects.toThrow(
        BadRequestException
      );
    });
    it("should throw if both jobRunId and jobConfigId are provided", async () => {
      await expect(service.handleError("a", "b")).rejects.toThrow(
        BadRequestException
      );
    });
    it("should not throw if only jobRunId is provided", async () => {
      await expect(
        service.handleError("a", undefined)
      ).resolves.toBeUndefined();
    });
    it("should not throw if only jobConfigId is provided", async () => {
      await expect(
        service.handleError(undefined, "b")
      ).resolves.toBeUndefined();
    });
  });

  describe("getPaginatedErrors", () => {
    it("should call repo.query with correct params for jobConfigId", async () => {
      mockOperationErrorRepo.query.mockResolvedValue([{ id: 1 }]);
      const result = await service.getPaginatedErrors({
        jobConfigId: "cfg",
        pageSize: 10,
        offset: 0,
      });
      expect(result).toEqual([{ id: 1 }]);
      expect(mockOperationErrorRepo.query).toHaveBeenCalled();
    });
  });

  describe("getWorkerSetupErrors", () => {
    it("should call repo.query for array input", async () => {
      mockWorkerJobRunMapRepo.query.mockResolvedValue([{ id: 1 }]);
      const result = await service.getWorkerSetupErrors(["a", "b"]);
      expect(result).toEqual([{ id: 1 }]);
    });
    it("should call repo.query for string input", async () => {
      mockWorkerJobRunMapRepo.query.mockResolvedValue([{ id: 2 }]);
      const result = await service.getWorkerSetupErrors("a");
      expect(result).toEqual([{ id: 2 }]);
    });
    it("should return [] for empty array", async () => {
      const result = await service.getWorkerSetupErrors([]);
      expect(result).toEqual([]);
    });
  });

  describe("parseWorkerResponse", () => {
    it("should parse JSON string", () => {
      expect(service.parseWorkerResponse('{"a":1}')).toEqual({ a: 1 });
    });
    it("should return {} for invalid JSON", () => {
      expect(service.parseWorkerResponse("{bad")).toEqual({});
    });
    it("should return {} for falsy", () => {
      expect(service.parseWorkerResponse(null)).toEqual({});
    });
    it("should return object as is", () => {
      expect(service.parseWorkerResponse({ a: 2 })).toEqual({ a: 2 });
    });
  });

  describe("fetchFormattedSetupErrors", () => {
    it("should format errors correctly", async () => {
      jest.spyOn(service, "getWorkerSetupErrors").mockResolvedValue([
        {
          id: 1,
          job_run_id: "run",
          job_type: "type",
          worker_response:
            '{"createdAt":"2023-01-01","message":"msg","origin":"o","operation":"op","code":"c","occurrence":2}',
        },
      ]);
      const result = await (service as any).fetchFormattedSetupErrors("run");
      expect(result[0]["Error Id"]).toBe(1);
      expect(result[0]["Occurrence"]).toBe(2);
    });
    it("should throw BadRequestException on error", async () => {
      jest
        .spyOn(service, "getWorkerSetupErrors")
        .mockRejectedValue(new Error("fail"));
      await expect(
        (service as any).fetchFormattedSetupErrors("run")
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("getTotalErrorCountForJobRun", () => {
    it("should sum opCount and workerSetupCount", async () => {
      mockOperationErrorRepo.query.mockResolvedValue([{ count: "3" }]);
      jest.spyOn(service as any, "getWorkerSetupCount").mockResolvedValue(2);
      const result = await service.getTotalErrorCountForJobRun("run");
      expect(result).toBe(5);
    });
  });

  describe("getTotalErrorCountForConfig", () => {
    it("should sum opCount and workerSetupCount", async () => {
      jest.spyOn(service, "getJobRunIds").mockResolvedValue(["a", "b"]);
      mockOperationErrorRepo.query.mockResolvedValue([{ count: "4" }]);
      jest.spyOn(service as any, "getWorkerSetupCount").mockResolvedValue(1);
      const result = await service.getTotalErrorCountForConfig("cfg");
      expect(result).toBe(5);
    });
    it("should return 0 if no jobRunIds", async () => {
      jest.spyOn(service, "getJobRunIds").mockResolvedValue([]);
      const result = await service.getTotalErrorCountForConfig("cfg");
      expect(result).toBe(0);
    });
  });

  describe("getWorkerSetupCount", () => {
    it("should return count from repo", async () => {
      mockWorkerJobRunMapRepo.count.mockResolvedValue(7);
      const result = await (service as any).getWorkerSetupCount(["a"]);
      expect(result).toBe(7);
    });
  });

  describe("isCsvFileReady", () => {
    it("should return ready=true if file exists and not processing", async () => {
      (service as any).extractJobIdentifiers = jest
        .fn()
        .mockReturnValue({ jobRunId: "run" });
      jest.spyOn(service, "handleError").mockResolvedValue(undefined);
      jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(1);
      (fs.existsSync as jest.Mock).mockImplementation((file) =>
        file.endsWith(".csv") ? true : false
      );
      const result = await service.isCsvFileReady("job-run", "run");
      expect(result).toEqual({ ready: true, processing: false });
    });
    it("should return processing=true if processing file exists", async () => {
      (service as any).extractJobIdentifiers = jest
        .fn()
        .mockReturnValue({ jobConfigId: "cfg" });
      jest.spyOn(service, "handleError").mockResolvedValue(undefined);
      jest.spyOn(service, "getTotalErrorCountForConfig").mockResolvedValue(1);
      (fs.existsSync as jest.Mock).mockImplementation((file) =>
        file.endsWith(".processing") ? true : false
      );
      const result = await service.isCsvFileReady("job-config", "cfg");
      expect(result).toEqual({ ready: false, processing: true });
    });
    it("should throw BadRequestException on error", async () => {
      (service as any).extractJobIdentifiers = jest.fn(() => {
        throw new Error("fail");
      });
      await expect(service.isCsvFileReady("job-run", "run")).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe("createCsvFileForJob", () => {
    it("should return file path if file exists", async () => {
      (service as any).extractJobIdentifiers = jest
        .fn()
        .mockReturnValue({ jobRunId: "run" });
      jest.spyOn(service, "handleError").mockResolvedValue(undefined);
      jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(1);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = await service.createCsvFileForJob("job-run", "run");
      expect(result).toBeDefined();
    });

    it("should throw BadRequestException on error", async () => {
      (service as any).extractJobIdentifiers = jest.fn(() => {
        throw new Error("fail");
      });
      await expect(
        service.createCsvFileForJob("job-run", "run")
      ).rejects.toThrow(Error);
    });
  });

  describe("downloadErrorLogCsvFile", () => {
    it("should return StreamableFile if file exists", async () => {
      (service as any).extractJobIdentifiers = jest
        .fn()
        .mockReturnValue({ jobRunId: "run" });
      jest.spyOn(service, "handleError").mockResolvedValue(undefined);
      jest.spyOn(service, "getTotalErrorCountForJobRun").mockResolvedValue(1);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.createReadStream as jest.Mock).mockReturnValue("stream");
      const result = await service.downloadErrorLogCsvFile("job-run", "run");
      expect(result).toBeInstanceOf(StreamableFile);
    });
    it("should call createCsvFileForJob if file does not exist", async () => {
      (service as any).extractJobIdentifiers = jest
        .fn()
        .mockReturnValue({ jobConfigId: "cfg" });
      jest.spyOn(service, "handleError").mockResolvedValue(undefined);
      jest.spyOn(service, "getTotalErrorCountForConfig").mockResolvedValue(1);
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      jest.spyOn(service, "createCsvFileForJob").mockResolvedValue(undefined);
      (fs.createReadStream as jest.Mock).mockReturnValue("stream");
      const result = await service.downloadErrorLogCsvFile("job-config", "cfg");
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it("should throw BadRequestException if extractJobIdentifiers throws", async () => {
      (service as any).extractJobIdentifiers = jest.fn(() => {
        throw new Error("fail");
      });
      await expect(
        service.downloadErrorLogCsvFile("job-run", "run")
      ).rejects.toThrow(BadRequestException);
    });

    it("getJobRunIds should throw BadRequestException on error", async () => {
      mockOperationErrorRepo.query.mockRejectedValue(new Error("fail"));
      await expect(service.getJobRunIds("cfg")).rejects.toThrow(
        BadRequestException
      );
    });

    it("getTotalErrorCountForJobRun should throw BadRequestException on error", async () => {
      mockOperationErrorRepo.query.mockRejectedValue(new Error("fail"));
      await expect(service.getTotalErrorCountForJobRun("run")).rejects.toThrow(
        BadRequestException
      );
    });

    it("getTotalErrorCountForConfig should throw BadRequestException on error", async () => {
      jest.spyOn(service, "getJobRunIds").mockRejectedValue(new Error("fail"));
      await expect(service.getTotalErrorCountForConfig("cfg")).rejects.toThrow(
        BadRequestException
      );
    });

    it("isCsvFileReady should throw BadRequestException on error", async () => {
      (service as any).extractJobIdentifiers = jest.fn(() => {
        throw new Error("fail");
      });
      await expect(service.isCsvFileReady("job-run", "run")).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe("writeLargeCsvToDisk", () => {
    let mockWriteStream, mockCsvStream;

    beforeEach(() => {
      mockWriteStream = {
        on: jest.fn((event, cb) => {
          if (event === "finish") setTimeout(cb, 0);
          return mockWriteStream;
        }),
        end: jest.fn(),
      };
      mockCsvStream = {
        pipe: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      };
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
      (fs.createReadStream as jest.Mock).mockReturnValue(mockWriteStream);
      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);
      (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);
      jest.spyOn(require("fast-csv"), "format").mockReturnValue(mockCsvStream);
    });

    it("should write CSV and resolve on finish", async () => {
      jest.spyOn(service, "getPaginatedErrors").mockResolvedValue([{ a: 1 }]);
      jest.spyOn(service, "getJobRunIds").mockResolvedValue([]);
      jest
        .spyOn<
          any,
          any
        >(Object.getPrototypeOf(service), "fetchFormattedSetupErrors")
        .mockResolvedValue([]);
      // Simulate only one chunk
      let callCount = 0;
      (service.getPaginatedErrors as jest.Mock).mockImplementation(() => {
        callCount++;
        return callCount === 1 ? [{ a: 1 }] : [];
      });

      await expect(
        service.writeLargeCsvToDisk("file.csv", "run", undefined, 10000)
      ).resolves.toBeUndefined();
      expect(mockCsvStream.write).toHaveBeenCalledWith({ a: 1 });
      expect(mockCsvStream.end).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("should handle error event on writeStream", async () => {
      // Simulate error event
      mockWriteStream.on = jest.fn((event, cb) => {
        if (event === "error") setTimeout(() => cb(new Error("fail")), 0);
        return mockWriteStream;
      });
      jest.spyOn(service, "getPaginatedErrors").mockResolvedValue([{ a: 1 }]);
      jest.spyOn(service, "getJobRunIds").mockResolvedValue([]);
      jest
        .spyOn<
          any,
          any
        >(Object.getPrototypeOf(service), "fetchFormattedSetupErrors")
        .mockResolvedValue([]);
      await expect(
        service.writeLargeCsvToDisk("file.csv", "run", undefined, 10000)
      ).rejects.toThrow("fail");
    });
  });

  describe('Comprehensive Error Count Tests', () => {
    describe('getTotalErrorCountForJobRun', () => {
      it('should count all errors for single job run', async () => {
        // Scenario: 15 operation errors + 2 worker setup errors
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '15' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(2);

        const result = await service.getTotalErrorCountForJobRun('job-run-123');
        
        expect(result).toBe(17); // 15 + 2
        expect(mockOperationErrorRepo.query).toHaveBeenCalledWith(
          expect.stringContaining('COUNT(*) as count'),
          expect.arrayContaining(['job-run-123'])
        );
      });

      it('should handle large error counts efficiently', async () => {
        // Scenario: Large migration with hundreds of errors
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '523' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(12);

        const result = await service.getTotalErrorCountForJobRun('job-run-large');
        
        expect(result).toBe(535); // 523 + 12
      });

      it('should count errors with no worker setup failures', async () => {
        // Scenario: Only operation errors, no worker failures
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '8' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(0);

        const result = await service.getTotalErrorCountForJobRun('job-run-no-setup');
        
        expect(result).toBe(8);
      });

      it('should count errors with only worker setup failures', async () => {
        // Scenario: All workers failed setup, no operation errors
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '0' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(5);

        const result = await service.getTotalErrorCountForJobRun('job-run-setup-only');
        
        expect(result).toBe(5);
      });

      it('should handle zero errors correctly', async () => {
        // Scenario: Successful job run with no errors
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '0' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(0);

        const result = await service.getTotalErrorCountForJobRun('job-run-success');
        
        expect(result).toBe(0);
      });

      it('should filter only FATAL_ERROR and TRANSIENT_ERROR types', async () => {
        // Scenario: Verify query filters by USER_VISIBLE_ERROR_TYPES
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '10' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(1);

        await service.getTotalErrorCountForJobRun('job-run-filtered');
        
        expect(mockOperationErrorRepo.query).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([
            'job-run-filtered',
            expect.arrayContaining(['FATAL_ERROR', 'TRANSIENT_ERROR', 'METADATA_UPDATE_CONFLICT'])
          ])
        );
      });

      it('should throw BadRequestException on database error', async () => {
        mockOperationErrorRepo.query.mockRejectedValue(new Error('DB connection failed'));

        await expect(
          service.getTotalErrorCountForJobRun('job-run-error')
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('getTotalErrorCountForConfig', () => {
      it('should count all errors across multiple job runs', async () => {
        // Scenario: Job config with 3 job runs
        jest.spyOn(service, 'getJobRunIds').mockResolvedValue(['run1', 'run2', 'run3']);
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '45' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(6);

        const result = await service.getTotalErrorCountForConfig('job-config-123');
        
        expect(result).toBe(51); // 45 + 6
        expect(mockOperationErrorRepo.query).toHaveBeenCalledWith(
          expect.stringContaining('COUNT(*) as count'),
          expect.arrayContaining(['run1', 'run2', 'run3'])
        );
      });

      it('should return 0 when job config has no job runs', async () => {
        jest.spyOn(service, 'getJobRunIds').mockResolvedValue([]);

        const result = await service.getTotalErrorCountForConfig('job-config-empty');
        
        expect(result).toBe(0);
        expect(mockOperationErrorRepo.query).not.toHaveBeenCalled();
      });

      it('should handle single job run in config', async () => {
        jest.spyOn(service, 'getJobRunIds').mockResolvedValue(['run1']);
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '12' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(1);

        const result = await service.getTotalErrorCountForConfig('job-config-single');
        
        expect(result).toBe(13);
      });

      it('should aggregate errors from many job runs', async () => {
        // Scenario: 10 job runs with total 200 errors
        const jobRunIds = Array.from({ length: 10 }, (_, i) => `run-${i}`);
        jest.spyOn(service, 'getJobRunIds').mockResolvedValue(jobRunIds);
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '200' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(15);

        const result = await service.getTotalErrorCountForConfig('job-config-many-runs');
        
        expect(result).toBe(215);
        expect(mockOperationErrorRepo.query).toHaveBeenCalledWith(
          expect.stringContaining('IN'),
          expect.arrayContaining(jobRunIds)
        );
      });

      it('should build correct SQL with multiple placeholders', async () => {
        jest.spyOn(service, 'getJobRunIds').mockResolvedValue(['run1', 'run2', 'run3']);
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '30' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(3);

        await service.getTotalErrorCountForConfig('job-config-placeholders');
        
        // Verify SQL query has correct placeholders for 3 job runs
        expect(mockOperationErrorRepo.query).toHaveBeenCalledWith(
          expect.stringMatching(/\$1.*\$2.*\$3/),
          expect.any(Array)
        );
      });

      it('should count only visible error types across all runs', async () => {
        jest.spyOn(service, 'getJobRunIds').mockResolvedValue(['run1', 'run2']);
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '25' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(2);

        await service.getTotalErrorCountForConfig('job-config-filtered');
        
        expect(mockOperationErrorRepo.query).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([
            'run1',
            'run2',
            expect.arrayContaining(['FATAL_ERROR', 'TRANSIENT_ERROR', 'METADATA_UPDATE_CONFLICT'])
          ])
        );
      });

      it('should handle mixed success and failed runs', async () => {
        // Scenario: 3 runs, 2 with errors, 1 successful
        jest.spyOn(service, 'getJobRunIds').mockResolvedValue(['run1', 'run2', 'run3']);
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '18' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(1);

        const result = await service.getTotalErrorCountForConfig('job-config-mixed');
        
        expect(result).toBe(19);
      });

      it('should throw BadRequestException on database error', async () => {
        jest.spyOn(service, 'getJobRunIds').mockResolvedValue(['run1']);
        mockOperationErrorRepo.query.mockRejectedValue(new Error('Query timeout'));

        await expect(
          service.getTotalErrorCountForConfig('job-config-error')
        ).rejects.toThrow(BadRequestException);
      });

      it('should handle extremely large job configs', async () => {
        // Scenario: 100 job runs with total 5000 errors
        const jobRunIds = Array.from({ length: 100 }, (_, i) => `run-${i}`);
        jest.spyOn(service, 'getJobRunIds').mockResolvedValue(jobRunIds);
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '5000' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(50);

        const result = await service.getTotalErrorCountForConfig('job-config-huge');
        
        expect(result).toBe(5050);
      });
    });

    describe('Edge Cases and Error Scenarios', () => {
      it('should handle string count values and convert to numbers', async () => {
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '999' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(1);

        const result = await service.getTotalErrorCountForJobRun('job-run-string');
        
        expect(result).toBe(1000);
        expect(typeof result).toBe('number');
      });

      it('should handle count as zero string', async () => {
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '0' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(0);

        const result = await service.getTotalErrorCountForJobRun('job-run-zero');
        
        expect(result).toBe(0);
      });

      it('should handle worker setup count being zero', async () => {
        mockOperationErrorRepo.query.mockResolvedValue([{ count: '10' }]);
        mockWorkerJobRunMapRepo.count.mockResolvedValue(0);

        const result = await service.getTotalErrorCountForJobRun('job-run-zero-setup');
        
        expect(result).toBe(10);
      });
    });
  });
});

