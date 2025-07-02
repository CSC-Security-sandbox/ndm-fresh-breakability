import { Test, TestingModule } from "@nestjs/testing";
import { ErrorLogService } from "./error_log_csv.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import { Repository } from "typeorm";
import * as fs from "fs";
import { PassThrough } from "stream";

jest.mock("fs");

describe("ErrorLogService", () => {
  let service: ErrorLogService;
  let mockOperationErrorRepo: jest.Mocked<Repository<OperationErrorEntity>>;
  let mockWorkerJobRunMapRepo: jest.Mocked<Repository<WorkerJobRunMap>>;
  const fsMock = fs as jest.Mocked<typeof fs>;

  beforeEach(async () => {
    mockOperationErrorRepo = {
      query: jest.fn(),
      count: jest.fn(),
      find: jest.fn(),
    } as any;

    mockWorkerJobRunMapRepo = {
      find: jest.fn(),
      count: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorLogService,
        {
          provide: getRepositoryToken(OperationErrorEntity),
          useValue: mockOperationErrorRepo,
        },
        {
          provide: getRepositoryToken(WorkerJobRunMap),
          useValue: mockWorkerJobRunMapRepo,
        },
      ],
    }).compile();

    service = module.get<ErrorLogService>(ErrorLogService);

    fsMock.existsSync.mockReturnValue(false);
    fsMock.writeFileSync.mockImplementation(() => {});
    fsMock.readdirSync.mockReturnValue([]);
    fsMock.unlinkSync.mockImplementation(() => {});

    fsMock.createWriteStream.mockImplementation(() => {
      const stream = new PassThrough();
      stream.write = jest.fn();
      stream.end = jest.fn();
      stream.pipe = jest.fn();
      stream.on = jest.fn().mockImplementation((event, cb) => {
        if (event === "finish") {
          setTimeout(cb, 10);
        }
        return stream;
      });
      return stream as any;
    });
  });

  it("should generate a file successfully for jobRunId", async () => {
    mockOperationErrorRepo.query.mockImplementation((sql, params) => {
      if (sql.includes("COUNT(*)")) {
        return Promise.resolve([{ count: "2" }]);
      }
      return Promise.resolve([]);
    });

    mockWorkerJobRunMapRepo.count.mockResolvedValue(1);
    mockWorkerJobRunMapRepo.find.mockResolvedValue([]);

    const result = await service.createCsvFileForJob("run123", undefined);
    expect(result).toEqual({ message: "CSV generation started" });
  });

  it("should generate a file successfully for jobConfigId", async () => {
    mockOperationErrorRepo.query.mockImplementation((sql, params) => {
      if (sql.includes("SELECT id FROM datamigrator.jobrun")) {
        return Promise.resolve([{ id: "jr1" }, { id: "jr2" }]);
      } else if (sql.includes("COUNT(*)")) {
        return Promise.resolve([{ count: "4" }]);
      }
      return Promise.resolve([]);
    });

    mockWorkerJobRunMapRepo.count.mockResolvedValue(2);
    mockWorkerJobRunMapRepo.find.mockResolvedValue([]);

    const result = await service.createCsvFileForJob(undefined, "cfg123");
    expect(result).toEqual({ message: "CSV generation started" });
  });

  it("should throw if both jobRunId and jobConfigId are provided", async () => {
    await expect(
      service.createCsvFileForJob("run123", "cfg123")
    ).rejects.toThrow("Provide either jobRunId or jobConfigId, not both.");
  });

  it("should throw if neither jobRunId nor jobConfigId is provided", async () => {
    await expect(
      service.createCsvFileForJob(undefined, undefined)
    ).rejects.toThrow("jobRunId or jobConfigId is required.");
  });

  it("should return file ready state", async () => {
    mockOperationErrorRepo.query.mockResolvedValue([{ count: "1" }]);
    mockWorkerJobRunMapRepo.count.mockResolvedValue(1);

    fsMock.existsSync.mockImplementation((path) => {
      if (typeof path === "string" && path.endsWith(".processing"))
        return false;
      return true;
    });

    const result = await service.isCsvFileReady("run456");
    expect(result).toEqual({ ready: true, processing: false });
  });

  it("should return file processing state", async () => {
    mockOperationErrorRepo.query.mockResolvedValue([{ count: "1" }]);
    mockWorkerJobRunMapRepo.count.mockResolvedValue(1);

    fsMock.existsSync.mockImplementation((p) => {
      if (typeof p === "string" && p.endsWith(".processing")) return true;
      return false;
    });

    const result = await service.isCsvFileReady("run456");
    expect(result).toEqual({ ready: false, processing: true });
  });

  it("should clean up old files except the one being created", async () => {
    mockOperationErrorRepo.query.mockImplementation((sql, params) => {
      if (sql.includes("COUNT(*)")) {
        return Promise.resolve([{ count: "2" }]);
      }
      return Promise.resolve([]);
    });
    mockWorkerJobRunMapRepo.count.mockResolvedValue(0);
    mockWorkerJobRunMapRepo.find.mockResolvedValue([]);

    fsMock.existsSync.mockImplementation((filePath) => {
      if (typeof filePath === "string" && filePath.endsWith(".csv"))
        return false;
      if (typeof filePath === "string" && filePath.endsWith("error-logs"))
        return true;
      return false;
    });

    const unlinkSpy = jest.spyOn(fs, "unlinkSync");
    await service.createCsvFileForJob("run123", undefined);
    expect(unlinkSpy).toHaveBeenCalled();
  });

  it("should throw BadRequestException if error occurs in getPaginatedErrors", async () => {
    jest.spyOn(service, "handleError").mockResolvedValue(undefined as any);
    mockOperationErrorRepo.query.mockRejectedValue(new Error("DB error"));
    await expect(
      service.getPaginatedErrors({
        jobConfigId: undefined,
        jobRunId: "run999",
        pageSize: 10,
        offset: 0,
      })
    ).rejects.toThrow("DB error");
  });

  it("should fetch formatted setup errors", async () => {
    mockWorkerJobRunMapRepo.find.mockResolvedValue([
      {
        id: "w1",
        jobRunId: "run1",
        workerResponse: {
          createdAt: "2024-01-01",
          message: "fail",
          origin: "origin",
          operation: "op",
          code: "SETUP_WORKER_FAILURE",
          occurrence: 2,
        },
      } as any,
    ]);
    const result = await (service as any).fetchFormattedSetupErrors("run1");
    expect(result[0]["Error Id"]).toBe("w1");
    expect(result[0]["Occurrence"]).toBe(2);
  });

  it("should throw BadRequestException if error occurs in getWorkerSetupErrors", async () => {
    mockWorkerJobRunMapRepo.find.mockRejectedValue(new Error("find error"));
    await expect(service.getWorkerSetupErrors("run1")).rejects.toThrow(
      "find error"
    );
  });

  it("should throw BadRequestException if error occurs in getWorkerSetupCount", async () => {
    mockWorkerJobRunMapRepo.count.mockRejectedValue(new Error("count error"));
    await expect((service as any).getWorkerSetupCount("run1")).rejects.toThrow(
      "count error"
    );
  });

  it("should throw BadRequestException if error occurs in getJobRunIds", async () => {
    mockOperationErrorRepo.query.mockRejectedValue(new Error("ids error"));
    await expect(service.getJobRunIds("cfg1")).rejects.toThrow("ids error");
  });

  it("should throw BadRequestException if error occurs in getTotalErrorCountForJobRun", async () => {
    mockOperationErrorRepo.query.mockRejectedValue(new Error("count error"));
    await expect(service.getTotalErrorCountForJobRun("run1")).rejects.toThrow(
      "count error"
    );
  });

  it("should throw BadRequestException if error occurs in getTotalErrorCountForConfig", async () => {
    mockOperationErrorRepo.query.mockImplementation((sql) => {
      if (sql.includes("SELECT id FROM datamigrator.jobrun")) {
        return Promise.resolve([{ id: "jr1" }]);
      }
      throw new Error("count error");
    });
    await expect(service.getTotalErrorCountForConfig("cfg1")).rejects.toThrow(
      "count error"
    );
  });

  it("should return 0 if getJobRunIds returns empty in getTotalErrorCountForConfig", async () => {
    mockOperationErrorRepo.query.mockResolvedValue([]);
    const result = await service.getTotalErrorCountForConfig("cfg1");
    expect(result).toBe(0);
  });

  it("should return a StreamableFile in downloadErrorLogCsvFile", async () => {
    mockOperationErrorRepo.query.mockResolvedValue([{ count: "1" }]);
    mockWorkerJobRunMapRepo.count.mockResolvedValue(0);

    fsMock.existsSync.mockReturnValue(true);
    fsMock.createReadStream.mockReturnValue(new PassThrough() as any);

    const result = await service.downloadErrorLogCsvFile("run1");
    expect(result).toBeInstanceOf(Object);
    expect((result as any).stream).toBeDefined();
  });

  it("should call createCsvFileForJob if file does not exist in downloadErrorLogCsvFile", async () => {
    mockOperationErrorRepo.query.mockResolvedValue([{ count: "1" }]);
    mockWorkerJobRunMapRepo.count.mockResolvedValue(0);

    fsMock.existsSync.mockReturnValue(false);
    fsMock.createReadStream.mockReturnValue(new PassThrough() as any);

    const createSpy = jest
      .spyOn(service, "createCsvFileForJob")
      .mockResolvedValue({ message: "CSV generation started" });

    await service.downloadErrorLogCsvFile("run1");
    expect(createSpy).toHaveBeenCalled();
  });

  it("should throw BadRequestException if error occurs in downloadErrorLogCsvFile", async () => {
    mockOperationErrorRepo.query.mockRejectedValue(new Error("fail"));
    await expect(service.downloadErrorLogCsvFile("run1")).rejects.toThrow(
      "fail"
    );
  });

  it("should escape regex metacharacters in escapeRegex", () => {
    const input = "foo.bar*baz?";
    const result = (service as any).escapeRegex(input);
    expect(result).toBe("foo\\.bar\\*baz\\?");
  });
});
