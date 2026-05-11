import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Logger } from "@nestjs/common";
import { DataSource, Repository, QueryRunner, InsertResult } from "typeorm";
import { InventoryService } from "./inventory.service";
import { InventoryEntity } from "../entities/inventory.entity";
import { TaskEntity } from "../entities/task.entity";
import { OperationsEntity } from "../entities/operation.entity";
import { OperationErrorEntity } from "../entities/operation-error.entity";
import { TaskErrorEntity } from "../entities/task-error.entity";
import {
  ErrorType,
  OperationError,
  TaskError,
  TaskStatus,
  CommandStatus,
  ItemInfo,
  ItemMeta,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { CreateInventory, FileType } from "./inventory.types";
import { OperationStatus } from "../enum/queues.enum";
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";
import { DatabaseError, ValidationError } from '../errors/custom-errors';

describe("InventoryService", () => {
  let service: InventoryService;
  let inventoryRepo: jest.Mocked<Repository<InventoryEntity>>;
  let taskRepo: jest.Mocked<Repository<TaskEntity>>;
  let operationRepo: jest.Mocked<Repository<OperationsEntity>>;
  let operationErrorRepo: jest.Mocked<Repository<OperationErrorEntity>>;
  let taskErrorRepo: jest.Mocked<Repository<TaskErrorEntity>>;
  let speedLogRepo: jest.Mocked<Repository<SpeedLogEntity>>;
  let speedLogEntryRepo: jest.Mocked<Repository<SpeedLogEntryEntity>>;
  let dataSource: jest.Mocked<DataSource>;
  let queryRunner: jest.Mocked<QueryRunner>;

  beforeEach(async () => {
    // Create mocked query runner
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOne: jest.fn(),
        upsert: jest.fn(),
      },
    } as any;

    // Create mocked data source (query used by getInventoryEntryTypesForPaths for update_type)
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
      query: jest.fn().mockResolvedValue([]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            upsert: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TaskEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            upsert: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(OperationsEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            upsert: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(OperationErrorEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            upsert: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TaskErrorEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            upsert: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeedLogEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            upsert: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeedLogEntryEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            upsert: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              log: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    inventoryRepo = module.get(getRepositoryToken(InventoryEntity));
    taskRepo = module.get(getRepositoryToken(TaskEntity));
    operationRepo = module.get(getRepositoryToken(OperationsEntity));
    operationErrorRepo = module.get(getRepositoryToken(OperationErrorEntity));
    taskErrorRepo = module.get(getRepositoryToken(TaskErrorEntity));
    speedLogRepo = module.get(getRepositoryToken(SpeedLogEntity));
    speedLogEntryRepo = module.get(getRepositoryToken(SpeedLogEntryEntity));

    // Mock logger
    jest.spyOn(service['logger'], 'log').mockImplementation();
    jest.spyOn(service['logger'], 'error').mockImplementation();
    jest.spyOn(service['logger'], 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper function to create valid ItemInfo objects
  const createMockItemInfo = (overrides: Partial<ItemInfo> = {}): ItemInfo => {
    const defaultSourceMeta: ItemMeta = {
      birthTime: new Date('2024-01-01T10:00:00Z'),
      modifiedTime: new Date('2024-01-01T12:00:00Z'),
      accessTime: new Date('2024-01-02T12:00:00Z'),
      permission: 'rw-r--r--',
      uid: 1001,
      gid: 1002,
      checksum: 'abc123',
    };

    const defaultTargetMeta: ItemMeta = {
      birthTime: new Date('2024-01-01T10:00:00Z'),
      modifiedTime: new Date('2024-01-01T12:00:00Z'),
      accessTime: new Date('2024-01-02T12:00:00Z'),
      permission: 'rw-r--r--',
      uid: 1001,
      gid: 1002,
      checksum: 'xyz456',
    };

    return new ItemInfo(
      overrides.fileName || '/test/path/file.txt',
      overrides.isDirectory || false,
      overrides.isSymbolicLink || false,
      overrides.depth || 2,
      overrides.extension || '.txt',
      overrides.fileType || 'text',
      overrides.sourceMeta || defaultSourceMeta,
      overrides.targetMeta || defaultTargetMeta,
      overrides.size || 1024,
      overrides.inode || 0
    );
  };

  describe('mapSourceToTarget', () => {
    const jobRunId = 'test-job-123';
    const pathId = 'test-path-456';

    it('should correctly map a valid file object', () => {
        const file = createMockItemInfo();

        const result = service.mapSourceToTarget(file, jobRunId, pathId);

        expect(result).toEqual({
            path: '/test/path/file.txt',
            isDirectory: false,
            sourceChecksum: 'abc123',
            targetChecksum: 'xyz456',
            parentPath: '/test/path',
            depth: 2,
            fileName: 'file.txt',
            uid: '1001',
            gid: '1002',
            fileSize: '1024',
            extension: '.txt',
            fileType: 'text',
            modifiedTime: new Date('2024-01-01T12:00:00Z'),
            accessTime: new Date('2024-01-02T12:00:00Z'),
            permission: 'rw-r--r--',
            jobRunId: 'test-job-123',
            birthTime: new Date('2024-01-01T10:00:00Z'),
            pathId: 'test-path-456',
            sourceMeta: expect.any(Object),
            targetMeta: expect.any(Object),
            inode: 0,
            isDeleted: false,
            checksumTime: null,
            copyContentStatus: null,
            stampMetaDataStatus: null,
            entryType: 'inventory',
            updateType: null
        });
    });

    it('should handle Windows-style paths', () => {
      const file = createMockItemInfo({
        fileName: '\\mnt\\C:\\Users\\test\\file.txt'
      });

      const result = service.mapSourceToTarget(file, jobRunId, pathId);

      expect(result.path).toBe('\\mnt\\C:\\Users\\test\\file.txt');
      expect(result.fileName).toBe('file.txt');
      expect(result.parentPath).toBe('\\mnt\\C:\\Users\\test');
    });

    it('should handle file with missing metadata', () => {
        // Create a file with completely null sourceMeta and targetMeta
        const file = new ItemInfo(
          '/test/path/file.txt',
          false,
          false,
          2,
          '.txt',
          'text',
          null, // sourceMeta is null
          null, // targetMeta is null
          1024,
          0
        );

        const result = service.mapSourceToTarget(file, jobRunId, pathId);

        expect(result.sourceChecksum).toBeNull();
        expect(result.targetChecksum).toBeNull();
        expect(result.uid).toBe('');
        expect(result.gid).toBe('');
        expect(result.modifiedTime).toBeInstanceOf(Date);
        expect(result.accessTime).toBeInstanceOf(Date);
        expect(result.permission).toBeNull();
        expect(result.birthTime).toBeInstanceOf(Date);
    });

    it('should throw an error if file is null or undefined', () => {
        expect(() => service.mapSourceToTarget(null, jobRunId, pathId)).toThrow('Invalid file object: Cannot map undefined or null file');
        expect(() => service.mapSourceToTarget(undefined, jobRunId, pathId)).toThrow('Invalid file object: Cannot map undefined or null file');
    });

    it('should set entryType from payload when excluded or skipped', () => {
      const fileExcluded = createMockItemInfo();
      (fileExcluded as any).entryType = 'excluded';
      expect(service.mapSourceToTarget(fileExcluded, jobRunId, pathId).entryType).toBe('excluded');

      const fileSkipped = createMockItemInfo();
      (fileSkipped as any).entryType = 'skipped';
      expect(service.mapSourceToTarget(fileSkipped, jobRunId, pathId).entryType).toBe('skipped');
    });
  });

  describe("createInventory", () => {
    it("returns empty array when input array is empty", async () => {
      const result = await service.createInventory([], "jobRunId", "pathId");
      expect(result).toEqual([]);
      expect(inventoryRepo.upsert).not.toHaveBeenCalled();
    });

    it("returns empty array when input is null", async () => {
      const result = await service.createInventory(null, "jobRunId", "pathId");
      expect(result).toEqual([]);
      expect(inventoryRepo.upsert).not.toHaveBeenCalled();
    });

    it("persists inventory rows and returns empty array on full success", async () => {
      const data = [createMockItemInfo()];
      const mappedData = {
        path: "/test/path/file.txt",
        jobRunId: "jobRunId",
        pathId: "pathId",
        fileName: "/test/path/file.txt",
        isDirectory: false,
        fileSize: "1024",
      };

      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(mappedData);
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [{ id: 1 }] } as any);

      const result = await service.createInventory(data, "jobRunId", "pathId");

      expect(result).toEqual([]);
      expect(service.mapSourceToTarget).toHaveBeenCalledWith(data[0], "jobRunId", "pathId");
      expect(inventoryRepo.upsert).toHaveBeenCalled();
    });

    it("logs batch error, logs summary, and returns failed records when upsert rejects", async () => {
      const data = [createMockItemInfo()];
      const error = new Error("Database error");

      jest.spyOn(service, "mapSourceToTarget").mockReturnValue({} as any);
      inventoryRepo.upsert.mockRejectedValue(error);
      const errorSpy = jest.spyOn(service["logger"], "error");
      const logSpy = jest.spyOn(service["logger"], "log");

      const result = await service.createInventory(data, "jobRunId", "pathId");

      expect(errorSpy).toHaveBeenCalledWith(
        `Failed to save inventory batch: ${error.message}`,
        error?.stack || error,
      );
      expect(logSpy).toHaveBeenCalledWith(
        `Failed to save ${data.length} of ${data.length} inventory records`,
      );
      expect(result).toEqual(data);
    });

    it("maps Junction fileType through to upsert payload", async () => {
      const data = [
        createMockItemInfo({ fileName: "/junction/path", fileType: FileType.JUNCTION }),
      ];
      const mappedData = {
        path: "/junction/path",
        jobRunId: "jobRunId",
        pathId: "pathId",
        fileName: "/junction/path",
        isDirectory: false,
        fileSize: "1024",
        fileType: FileType.JUNCTION,
      };

      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(mappedData);
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [{ id: 1 }] } as any);

      const result = await service.createInventory(data, "jobRunId", "pathId");

      expect(result).toEqual([]);
      expect(service.mapSourceToTarget).toHaveBeenCalledWith(data[0], "jobRunId", "pathId");
      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ fileType: FileType.JUNCTION })]),
        ["path", "jobRunId", "isDirectory"],
      );
    });

    it("chunks upserts by DB_UPSERT_BATCH_SIZE", async () => {
      const data = Array.from({ length: 3000 }, () => createMockItemInfo());

      jest.spyOn(service, "mapSourceToTarget").mockReturnValue({} as any);
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [] } as any);

      const result = await service.createInventory(data, "jobRunId", "pathId");

      expect(result).toEqual([]);
      expect(inventoryRepo.upsert).toHaveBeenCalledTimes(3);
    });

    it("deduplicates same path within a batch before upsert", async () => {
      const data = [
        createMockItemInfo({ fileName: "/same/path.txt" }),
        createMockItemInfo({ fileName: "/same/path.txt" }),
        createMockItemInfo({ fileName: "/different/path.txt" }),
      ];

      jest.spyOn(service, "mapSourceToTarget").mockImplementation((item) => ({
        path: item.fileName,
        jobRunId: "jobRunId",
        isDirectory: item.isDirectory,
      }));

      inventoryRepo.upsert.mockResolvedValue({ identifiers: [] } as any);

      const result = await service.createInventory(data, "jobRunId", "pathId");

      expect(result).toEqual([]);
      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: "/same/path.txt" }),
          expect.objectContaining({ path: "/different/path.txt" }),
        ]),
        ["path", "jobRunId", "isDirectory"],
      );
    });

    it("runs markDirectoryTreeAsDeleted for deleted-directory markers only", async () => {
      const deletedDirectoryMarker = createMockItemInfo({
        fileName: "/test/deleted/directory",
        isDirectory: true,
      });
      (deletedDirectoryMarker as any).isDeleted = true;
      dataSource.query = jest.fn().mockResolvedValue([]);
      jest.spyOn(service, "markDirectoryTreeAsDeleted").mockResolvedValue([]);

      const result = await service.createInventory([deletedDirectoryMarker], "jobRunId", "pathId");

      expect(result).toEqual([]);
      expect(service.markDirectoryTreeAsDeleted).toHaveBeenCalledWith(
        deletedDirectoryMarker,
        "jobRunId",
        "pathId",
        '"datamigrator"',
      );
    });

    it("returns deletedDir in failedRecords when markDirectoryTreeAsDeleted fails", async () => {
      const deletedDirectoryMarker = createMockItemInfo({
        fileName: "/test/deleted/directory",
        isDirectory: true,
      });
      (deletedDirectoryMarker as any).isDeleted = true;
      dataSource.query = jest.fn().mockResolvedValue([]);
      jest.spyOn(service, "markDirectoryTreeAsDeleted").mockResolvedValue([deletedDirectoryMarker]);

      const result = await service.createInventory([deletedDirectoryMarker], "jobRunId", "pathId");

      expect(result).toEqual([deletedDirectoryMarker]);
    });

    it("collects failures from both regular upsert and markDirectoryTreeAsDeleted into failedRecords", async () => {
      const regularFile = createMockItemInfo({ fileName: "/test/file.txt", isDirectory: false });
      const deletedDir = createMockItemInfo({ fileName: "/test/deleted/dir", isDirectory: true });
      (deletedDir as any).isDeleted = true;

      jest.spyOn(service, "mapSourceToTarget").mockReturnValue({ path: "/test/file.txt", jobRunId: "jobRunId", isDirectory: false } as any);
      inventoryRepo.upsert.mockRejectedValue(new Error("DB error"));
      dataSource.query = jest.fn().mockResolvedValue([]);
      jest.spyOn(service, "markDirectoryTreeAsDeleted").mockResolvedValue([deletedDir]);

      const result = await service.createInventory([regularFile, deletedDir], "jobRunId", "pathId");

      expect(result).toContain(regularFile);
      expect(result).toContain(deletedDir);
      expect(result).toHaveLength(2);
    });

    it("returns empty array when markDirectoryTreeAsDeleted succeeds", async () => {
      const deletedDir = createMockItemInfo({ fileName: "/test/deleted/dir", isDirectory: true });
      (deletedDir as any).isDeleted = true;
      dataSource.query = jest.fn().mockResolvedValue([]);
      jest.spyOn(service, "markDirectoryTreeAsDeleted").mockResolvedValue([]);

      const result = await service.createInventory([deletedDir], "jobRunId", "pathId");

      expect(result).toEqual([]);
    });

    it("skips markDirectoryTreeAsDeleted when directory is already marked deleted in DB", async () => {
      const deletedDir = createMockItemInfo({ fileName: "/test/already-deleted", isDirectory: true });
      (deletedDir as any).isDeleted = true;
      // dataSource.query returns a row with is_deleted = true → skip
      dataSource.query = jest.fn().mockResolvedValue([{ is_deleted: true }]);
      jest.spyOn(service, "markDirectoryTreeAsDeleted");

      const result = await service.createInventory([deletedDir], "jobRunId", "pathId");

      expect(service.markDirectoryTreeAsDeleted).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("sets updateType to 'content_updated' for a path that already exists in DB", async () => {
      const file = createMockItemInfo({ fileName: "/existing/file.txt", isDirectory: false });
      const mappedRow = {
        path: "/existing/file.txt",
        jobRunId: "jobRunId",
        isDirectory: false,
        entryType: "inventory",
        updateType: null,
      };
      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(mappedRow);
      // getInventoryEntryTypesForPaths returns a map that contains the key → "existing"
      jest.spyOn(service, "getInventoryEntryTypesForPaths").mockResolvedValue(
        new Map([["/existing/file.txt|jobRunId|false", "inventory"]]),
      );
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [] } as any);

      await service.createInventory([file], "jobRunId", "pathId");

      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: "/existing/file.txt", updateType: "content_updated" }),
        ]),
        ["path", "jobRunId", "isDirectory"],
      );
    });

    it("sets updateType to 'new' for a path that does not yet exist in DB", async () => {
      const file = createMockItemInfo({ fileName: "/new/file.txt", isDirectory: false });
      const mappedRow = {
        path: "/new/file.txt",
        jobRunId: "jobRunId",
        isDirectory: false,
        entryType: "inventory",
        updateType: null,
      };
      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(mappedRow);
      jest.spyOn(service, "getInventoryEntryTypesForPaths").mockResolvedValue(new Map());
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [] } as any);

      await service.createInventory([file], "jobRunId", "pathId");

      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: "/new/file.txt", updateType: "new" }),
        ]),
        ["path", "jobRunId", "isDirectory"],
      );
    });

    it("does not overwrite updateType when entryType is 'excluded'", async () => {
      const file = createMockItemInfo({ fileName: "/excluded/file.txt", isDirectory: false });
      const mappedRow = {
        path: "/excluded/file.txt",
        jobRunId: "jobRunId",
        isDirectory: false,
        entryType: "excluded",
        updateType: null,
      };
      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(mappedRow);
      jest.spyOn(service, "getInventoryEntryTypesForPaths").mockResolvedValue(new Map());
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [] } as any);

      await service.createInventory([file], "jobRunId", "pathId");

      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ entryType: "excluded", updateType: null }),
        ]),
        ["path", "jobRunId", "isDirectory"],
      );
    });
  });

  describe("saveOperationError", () => {
    it("should save operation error records", async () => {
      const data: OperationError = {
        errorCode: "123",
        errorMessage: "Error",
        operationId: "opId",
        errorType: ErrorType.FATAL_ERROR,
        errorFiles: { fileName: "file.txt", filePath: "/path/to/file" },
        operationName: "SCAN",
        origin: "source",
      };
      const operationError = {
        id: 1,
        errorCode: "123",
        errorMessage: "Error",
        operationId: "opId",
        fileName: "file.txt",
        filePath: "/path/to/file",
        createdAt: new Date(),
        operationName: "SCAN",
        origin: "source",
      };

      operationErrorRepo.create.mockReturnValue(operationError as any);
      operationErrorRepo.save.mockResolvedValue(operationError as any);

      await service.saveOperationError(data);

      expect(operationErrorRepo.create).toHaveBeenCalledWith({
        createdAt: expect.any(Date),
        errorCode: "123",
        errorMessage: "Error",
        operationId: "opId",
        fileName: "file.txt",
        filePath: "/path/to/file",
        error_type:'FATAL_ERROR',
        operationType: "SCAN",
        origin: "source" as any,
      });
      expect(operationErrorRepo.save).toHaveBeenCalledWith(operationError);
    });

    it("should throw an error if operation error data is invalid", async () => {
      await expect(service.saveOperationError(null)).rejects.toThrow(
        "Error while saving operation error records to the database"
      );
    });

    it("should log an error if saving operation error records fails", async () => {
      const data: OperationError = {
        errorCode: "123",
        errorMessage: "Error",
        errorType: ErrorType.FATAL_ERROR,
        operationId: "opId",
        errorFiles: { fileName: "file.txt", filePath: "/path/to/file" },
      };
      const error = new Error("Database error");
      
      operationErrorRepo.create.mockReturnValue(data as any);
      operationErrorRepo.save.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.saveOperationError(data)).rejects.toThrow(
        "Error while saving operation error records to the database"
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to save operation error: ${error.message}`,
        error?.stack || error
      );
    });

    it("should call syncErrorToOriginalJobRun when originalJobRunId is present", async () => {
      const data: OperationError = {
        errorCode: "ERR001",
        errorMessage: "File not found",
        operationId: "opId-retry",
        errorType: ErrorType.FATAL_ERROR,
        errorFiles: { fileName: "file.txt", filePath: "/path/to/file.txt" },
        operationName: "COPY",
        origin: "source",
        originalJobRunId: "original-job-run-123",
      };

      operationErrorRepo.create.mockReturnValue({} as any);
      operationErrorRepo.save.mockResolvedValue({} as any);
      // Mock operation not existing in original job run
      operationRepo.findOne.mockResolvedValue(null);
      operationRepo.create.mockReturnValue({ id: "new-op-id" } as any);
      operationRepo.save.mockResolvedValue({ id: "new-op-id" } as any);
      operationErrorRepo.upsert.mockResolvedValue({} as any);

      await service.saveOperationError(data);

      // Verify syncErrorToOriginalJobRun was triggered
      // Uses fileName (relative fPath / basename), not the full filePath
      expect(operationRepo.findOne).toHaveBeenCalledWith({
        where: {
          fPath: "file.txt",
          jobRunId: "original-job-run-123"
        }
      });
    });

    it("should not sync to original job when originalJobRunId is not present", async () => {
      const data: OperationError = {
        errorCode: "ERR001",
        errorMessage: "File not found",
        operationId: "opId",
        errorType: ErrorType.FATAL_ERROR,
        errorFiles: { fileName: "file.txt", filePath: "/path/to/file.txt" },
        operationName: "COPY",
        origin: "source",
        // No originalJobRunId
      };

      operationErrorRepo.create.mockReturnValue({} as any);
      operationErrorRepo.save.mockResolvedValue({} as any);

      await service.saveOperationError(data);

      // Should not attempt to find operation in original job run
      expect(operationRepo.findOne).not.toHaveBeenCalled();
    });

    it("should create operation in original job run for new files during retry", async () => {
      const data: OperationError = {
        errorCode: "ERR001",
        errorMessage: "Permission denied",
        operationId: "opId-retry",
        errorType: ErrorType.FATAL_ERROR,
        errorFiles: { fileName: "newfile.txt", filePath: "/new/path/newfile.txt" },
        operationName: "COPY",
        origin: "source",
        originalJobRunId: "original-job-run-456",
      };

      operationErrorRepo.create.mockReturnValue({} as any);
      operationErrorRepo.save.mockResolvedValue({} as any);
      // No existing operation in original job
      operationRepo.findOne
        .mockResolvedValueOnce(null) // Check if operation exists - it doesn't
        .mockResolvedValueOnce({ sPathId: "src-path", tPathId: "tgt-path" } as any); // Get path IDs
      operationRepo.create.mockReturnValue({ id: "new-op-id" } as any);
      operationRepo.save.mockResolvedValue({ id: "new-op-id" } as any);
      operationErrorRepo.upsert.mockResolvedValue({} as any);
      const loggerSpy = jest.spyOn(service["logger"], "log");

      await service.saveOperationError(data);

      // Uses fileName (relative fPath / basename), not the full filePath
      expect(operationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fPath: "newfile.txt",
          jobRunId: "original-job-run-456",
          status: OperationStatus.ERROR,
        })
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Synced new error to original job run")
      );
    });

    it("should not create operation when file already exists in original job run", async () => {
      const data: OperationError = {
        errorCode: "ERR001",
        errorMessage: "File not found",
        operationId: "opId-retry",
        errorType: ErrorType.FATAL_ERROR,
        errorFiles: { fileName: "existingfile.txt", filePath: "/existing/path/existingfile.txt" },
        operationName: "COPY",
        origin: "source",
        originalJobRunId: "original-job-run-789",
      };

      operationErrorRepo.create.mockReturnValue({} as any);
      operationErrorRepo.save.mockResolvedValue({} as any);
      // Operation already exists in original job run
      operationRepo.findOne.mockResolvedValue({ id: "existing-op-id", fPath: "/existing/path/existingfile.txt" } as any);

      await service.saveOperationError(data);

      // Should not create a new operation
      expect(operationRepo.create).not.toHaveBeenCalled();
    });

    it("should handle errors in syncErrorToOriginalJobRun gracefully without throwing", async () => {
      const data: OperationError = {
        errorCode: "ERR001",
        errorMessage: "File error",
        operationId: "opId-retry",
        errorType: ErrorType.FATAL_ERROR,
        errorFiles: { fileName: "file.txt", filePath: "/path/file.txt" },
        operationName: "COPY",
        origin: "source",
        originalJobRunId: "original-job-run-error",
      };

      operationErrorRepo.create.mockReturnValue({} as any);
      operationErrorRepo.save.mockResolvedValue({} as any);
      // Simulate error in finding operation
      operationRepo.findOne.mockRejectedValue(new Error("Database connection failed"));
      const loggerSpy = jest.spyOn(service["logger"], "error");

      // Should not throw - the main error save should succeed
      await expect(service.saveOperationError(data)).resolves.not.toThrow();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to sync error to original job run"),
        expect.anything()
      );
    });
  });

  describe("resolveOperationErrors", () => {
    it("should resolve operation errors for completed retry commands", async () => {
      const errors = [
        { operationId: "op-1", filePath: "/path/file1.txt" },
        { operationId: "op-2", filePath: "/path/file2.txt" },
      ];

      operationErrorRepo.query = jest.fn().mockResolvedValue([[], 2]);

      await service.resolveOperationErrors(errors);

      expect(operationErrorRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE datamigrator.operation_errors"),
        ["op-1", "/path/file1.txt", "op-2", "/path/file2.txt"]
      );
    });

    it("should return early for empty errors array", async () => {
      operationErrorRepo.query = jest.fn();
      await service.resolveOperationErrors([]);

      expect(operationErrorRepo.query).not.toHaveBeenCalled();
    });

    it("should return early for null errors", async () => {
      operationErrorRepo.query = jest.fn();
      await service.resolveOperationErrors(null as any);

      expect(operationErrorRepo.query).not.toHaveBeenCalled();
    });

    it("should call query with correct params for single error pair", async () => {
      const errors = [
        { operationId: "op-1", filePath: "/path/file1.txt" },
      ];

      operationErrorRepo.query = jest.fn().mockResolvedValue(undefined);

      await service.resolveOperationErrors(errors);

      expect(operationErrorRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE datamigrator.operation_errors"),
        ["op-1", "/path/file1.txt"]
      );
    });

    it("should handle database errors gracefully", async () => {
      const errors = [
        { operationId: "op-1", filePath: "/path/file1.txt" },
      ];

      operationErrorRepo.query = jest.fn().mockRejectedValue(new Error("Database error"));
      const loggerSpy = jest.spyOn(service["logger"], "error");

      // Should not throw
      await expect(service.resolveOperationErrors(errors)).resolves.not.toThrow();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to resolve operation errors"),
        expect.anything()
      );
    });

    it("should build correct SQL query joining operations table for f_path matching", async () => {
      const errors = [
        { operationId: "op-a", filePath: "/path/a.txt" },
        { operationId: "op-b", filePath: "/path/b.txt" },
      ];

      operationErrorRepo.query = jest.fn().mockResolvedValue([[], 2]);

      await service.resolveOperationErrors(errors);

      // Verify the query joins to operations table and uses o.f_path
      expect(operationErrorRepo.query).toHaveBeenCalledWith(
        expect.stringMatching(/INNER JOIN datamigrator\.operations o ON oe\.operation_id = o\.id/),
        expect.arrayContaining(["op-a", "/path/a.txt", "op-b", "/path/b.txt"])
      );
      // Verify it matches on o.f_path (operations.f_path) not oe.file_path
      expect(operationErrorRepo.query).toHaveBeenCalledWith(
        expect.stringMatching(/o\.f_path = \$\d+/),
        expect.anything()
      );
    });
  });

  describe("saveTaskError", () => {
    it("should save task error records", async () => {
      const data = {
        errorCode: "123",
        errorMessage: "Error",
        taskId: "taskId",
        errorType: ErrorType.FATAL_ERROR,
      };
      const taskError = {
        id: 1,
        errorCode: "123",
        errorMessage: "Error",
        taskId: "taskId",
        createdAt: new Date(),
        error_type: ErrorType.FATAL_ERROR
      };

      taskErrorRepo.create.mockReturnValue(taskError as any);
      taskErrorRepo.save.mockResolvedValue(taskError as any);

      await service.saveTaskError(data);

      expect(taskErrorRepo.create).toHaveBeenCalledWith({
        errorCode: "123",
        errorMessage: "Error",
        taskId: "taskId",
        createdAt: expect.any(Date),
        error_type:ErrorType.FATAL_ERROR
      });
      expect(taskErrorRepo.save).toHaveBeenCalledWith(taskError);
    });

    it("should throw an error if task error data is invalid", async () => {
      await expect(service.saveTaskError(null)).rejects.toThrow(
        "Error while saving task error records to the database"
      );
    });

    it("should log an error if saving task error records fails", async () => {
      const data: TaskError = {
        errorCode: "123",
        errorMessage: "Error",
        taskId: "taskId",
        errorType: ErrorType.FATAL_ERROR,
      };
      const error = new Error("Database error");
      
      taskErrorRepo.create.mockReturnValue(data as any);
      taskErrorRepo.save.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.saveTaskError(data)).rejects.toThrow(
        "Error while saving task error records to the database"
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to save task error: ${error.message}`,
        error?.stack || error
      );
    });
  });

  describe("saveTasks", () => {
    it("should save task and operations", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: "IN_PROGRESS",
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [{ commandId: "cmd1", fPath: "/path/to/file" }],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: "IN_PROGRESS" };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);

      await service.saveTasks(data);

      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.findOne).toHaveBeenCalledWith(TaskEntity, {
        where: { id: "taskId" },
        lock: { mode: "pessimistic_write" },
      });
      expect(queryRunner.manager.upsert).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      
      expect(operationRepo.upsert).toHaveBeenCalled();
    });
    
    it("should throw an error if task data is invalid", async () => {
      await expect(service.saveTasks(null)).rejects.toThrow("Invalid task data");
    });

    it("should not save operations if commands array is empty", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: "IN_PROGRESS",
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [], 
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: "IN_PROGRESS" };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);

      await service.saveTasks(data);

      expect(queryRunner.manager.upsert).toHaveBeenCalled();
      expect(operationRepo.upsert).not.toHaveBeenCalled(); 
    });

    it("should skip task upsert if task already exists with completed status", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: "IN_PROGRESS",
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [{ commandId: "cmd1", fPath: "/path/to/file" }],
        workerId: "workerId",
        id: "taskId",
      };

      
      const mockTask = { id: "taskId", status: TaskStatus.COMPLETED };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);

      await service.saveTasks(data);

      expect(queryRunner.manager.findOne).toHaveBeenCalled();
      expect(queryRunner.manager.upsert).not.toHaveBeenCalled(); 
      expect(operationRepo.upsert).toHaveBeenCalled(); 
    });

    it("should handle transaction errors and rollback", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: "IN_PROGRESS",
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [{ commandId: "cmd1", fPath: "/path/to/file" }],
        workerId: "workerId",
        id: "taskId",
      };

      const error = new Error("Transaction error");
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(null);
      (queryRunner.manager.upsert as jest.Mock).mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await service.saveTasks(data);

      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith("Failed to save task:", error?.stack || error);
    });

    it("should log an error if taskId is not found", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: "status",
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [{ commandId: "cmd1", fPath: "/path/to/file" }],
        workerId: "workerId",
        id: null,
      };
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await service.saveTasks(data);

      expect(loggerSpy).toHaveBeenCalledWith("Task ID not found");
    });

    it("should resolve operation errors when retry commands complete successfully", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: TaskStatus.COMPLETED,
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [
          { id: "retry-cmd-1", fPath: "/path/to/file1.txt", originalCmdId: "original-cmd-1", status: CommandStatus.COMPLETED },
          { id: "retry-cmd-2", fPath: "/path/to/file2.txt", originalCmdId: "original-cmd-2", status: CommandStatus.COMPLETED },
        ],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: TaskStatus.RUNNING };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);
      operationErrorRepo.query = jest.fn().mockResolvedValue(undefined);

      await service.saveTasks(data);

      // Should call resolveOperationErrors via raw query with completed retry commands
      expect(operationErrorRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE datamigrator.operation_errors"),
        ["original-cmd-1", "/path/to/file1.txt", "original-cmd-2", "/path/to/file2.txt"]
      );
    });

    it("should not resolve errors for retry commands that did not complete", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: TaskStatus.COMPLETED,
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [
          { id: "retry-cmd-1", fPath: "/path/to/file1.txt", originalCmdId: "original-cmd-1", status: CommandStatus.COMPLETED },
          { id: "retry-cmd-2", fPath: "/path/to/file2.txt", originalCmdId: "original-cmd-2", status: CommandStatus.ERROR },
        ],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: TaskStatus.RUNNING };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);
      operationErrorRepo.query = jest.fn().mockResolvedValue(undefined);

      await service.saveTasks(data);

      // Should only resolve the completed command (original-cmd-1); one (operationId, filePath) pair
      expect(operationErrorRepo.query).toHaveBeenCalledWith(
        expect.stringMatching(/oe\.operation_id = \$1 AND o\.f_path = \$2/),
        ["original-cmd-1", "/path/to/file1.txt"]
      );
    });

    it("should not resolve errors for non-retry commands (no originalCmdId)", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: TaskStatus.COMPLETED,
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [
          { id: "cmd-1", fPath: "/path/to/file1.txt", status: CommandStatus.COMPLETED },
          { id: "cmd-2", fPath: "/path/to/file2.txt", status: CommandStatus.COMPLETED },
        ],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: TaskStatus.RUNNING };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);
      operationErrorRepo.query = jest.fn();

      await service.saveTasks(data);

      // Should not call resolveOperationErrors since no commands have originalCmdId
      expect(operationErrorRepo.query).not.toHaveBeenCalled();
    });

    it("should only resolve errors when task status is COMPLETED or COMPLETED_WITH_ERROR", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: TaskStatus.RUNNING,
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [
          { id: "retry-cmd-1", fPath: "/path/to/file1.txt", originalCmdId: "original-cmd-1", status: CommandStatus.COMPLETED },
        ],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: TaskStatus.RUNNING };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);
      operationErrorRepo.query = jest.fn();

      await service.saveTasks(data);

      // Should not call resolveOperationErrors for IN_PROGRESS status
      expect(operationErrorRepo.query).not.toHaveBeenCalled();
    });

    it("should map command statuses to operation statuses via getOperationStatusFor when upserting operations", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: TaskStatus.RUNNING,
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [
          { id: "cmd-ready",      fPath: "/path/ready.txt",      status: CommandStatus.READY },
          { id: "cmd-in-process", fPath: "/path/in-process.txt", status: CommandStatus.IN_PROCESS },
          { id: "cmd-completed",  fPath: "/path/completed.txt",  status: CommandStatus.COMPLETED },
          { id: "cmd-error",      fPath: "/path/error.txt",      status: CommandStatus.ERROR },
        ],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: TaskStatus.RUNNING };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);

      await service.saveTasks(data);

      expect(operationRepo.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: "cmd-ready",      status: OperationStatus.READY }),
          expect.objectContaining({ id: "cmd-in-process", status: OperationStatus.IN_PROCESS }),
          expect.objectContaining({ id: "cmd-completed",  status: OperationStatus.COMPLETED }),
          expect.objectContaining({ id: "cmd-error",      status: OperationStatus.ERROR }),
        ]),
        ["id"]
      );
    });

    it("should resolve errors for COMPLETED_WITH_ERROR task status", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: TaskStatus.COMPLETED_WITH_ERROR,
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [
          { id: "retry-cmd-1", fPath: "/path/to/file1.txt", originalCmdId: "original-cmd-1", status: CommandStatus.COMPLETED },
          { id: "retry-cmd-2", fPath: "/path/to/file2.txt", originalCmdId: "original-cmd-2", status: CommandStatus.ERROR },
        ],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: TaskStatus.RUNNING };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);
      operationErrorRepo.query = jest.fn().mockResolvedValue(undefined);

      await service.saveTasks(data);

      // Should resolve errors for COMPLETED_WITH_ERROR status via raw query (one completed retry command)
      expect(operationErrorRepo.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE datamigrator.operation_errors"),
        ["original-cmd-1", "/path/to/file1.txt"]
      );
    });

    // Tests for bug fix: "Fix task error count, operation error count mismatch" (commit 7eeabe99f)
    // Bug fix removed TaskStatus.ERRORED from terminal states to allow successful retries to update tasks
    it("should allow task update when existing task status is ERRORED", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: TaskStatus.RUNNING,
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [{ commandId: "cmd1", fPath: "/path/to/file" }],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: TaskStatus.ERRORED };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);

      await service.saveTasks(data);

      expect(queryRunner.manager.upsert).toHaveBeenCalledWith(
        TaskEntity,
        expect.objectContaining({
          id: "taskId",
          status: TaskStatus.RUNNING,
          updatedAt: null,
        }),
        ['id']
      );
    });

    it("should allow task to transition from ERRORED to COMPLETED after retry", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: TaskStatus.COMPLETED,
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [{ commandId: "cmd1", fPath: "/path/to/file" }],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: TaskStatus.ERRORED };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);

      await service.saveTasks(data);

      expect(queryRunner.manager.upsert).toHaveBeenCalledWith(
        TaskEntity,
        expect.objectContaining({
          id: "taskId",
          status: TaskStatus.COMPLETED,
          updatedAt: expect.any(Date),
        }),
        ['id']
      );
    });

    it("should allow task to remain ERRORED when retry fails again", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: TaskStatus.ERRORED,
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [{ commandId: "cmd1", fPath: "/path/to/file" }],
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: TaskStatus.ERRORED };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);

      await service.saveTasks(data);

      expect(queryRunner.manager.upsert).toHaveBeenCalledWith(
        TaskEntity,
        expect.objectContaining({
          id: "taskId",
          status: TaskStatus.ERRORED,
          updatedAt: expect.any(Date),
        }),
        ['id']
      );
    });
  });

  describe("updateTask", () => {
    it("should update task data", async () => {
      const taskId = "taskId";
      const data = { status: TaskStatus.COMPLETED };
      const updateResult = { affected: 1 };

      taskRepo.update.mockResolvedValue(updateResult as any);

      const result = await service.updateTask(taskId, data);

      expect(taskRepo.update).toHaveBeenCalledWith(taskId, data);
      expect(result).toBe(updateResult);
    });

    it("should throw an error if taskId or data is invalid", async () => {
      await expect(service.updateTask(null, {})).rejects.toThrow(
        "Error while updating task data"
      );
    });

    it("should log an error if no task is found", async () => {
      const taskId = "taskId";
      const data = { status: TaskStatus.COMPLETED };
      const updateResult = { affected: 0 };
      
      taskRepo.update.mockResolvedValue(updateResult as any);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await service.updateTask(taskId, data);

      expect(loggerSpy).toHaveBeenCalledWith(
        `No task found with id: ${taskId}`
      );
    });

    it("should log an error if updating task data fails", async () => {
      const taskId = "taskId";
      const data = { status: TaskStatus.COMPLETED };
      const error = new Error("Database error");
      
      taskRepo.update.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.updateTask(taskId, data)).rejects.toThrow(
        "Error while updating task data"
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to update task (ID: ${taskId}): ${error.message}`,
        error?.stack || error
      );
    });
  });

  describe("saveSpeedLogsEntries", () => {
    it("should save speed log entries successfully", async () => {
      const data = {
        testType: "read-test",
        timeStamp: new Date(),
        speed: 150.5
      };
      const speedLogEntry = {
        id: 1,
        speedLogId: "read-test",
        timeStamp: data.timeStamp,
        speed: 150.5
      };

      speedLogEntryRepo.create.mockReturnValue(speedLogEntry as any);
      speedLogEntryRepo.save.mockResolvedValue(speedLogEntry as any);

      await service.saveSpeedLogsEntries(data);

      expect(speedLogEntryRepo.create).toHaveBeenCalledWith({
        speedLogId: "read-test",
        timeStamp: data.timeStamp,
        speed: 150.5
      });
      expect(speedLogEntryRepo.save).toHaveBeenCalledWith(speedLogEntry);
    });

    it("should handle string speed values by converting to number", async () => {
      const data = {
        testType: "write-test",
        timeStamp: new Date(),
        speed: "125.75"
      };

      speedLogEntryRepo.create.mockReturnValue({} as any);
      speedLogEntryRepo.save.mockResolvedValue({} as any);

      await service.saveSpeedLogsEntries(data);

      expect(speedLogEntryRepo.create).toHaveBeenCalledWith({
        speedLogId: "write-test",
        timeStamp: data.timeStamp,
        speed: 125.75
      });
    });

    it("should log an error and throw if saving speed log entries fails", async () => {
      const data = {
        testType: "read-test",
        timeStamp: new Date(),
        speed: 100
      };
      const error = new Error("Database connection failed");
      
      speedLogEntryRepo.create.mockReturnValue({} as any);
      speedLogEntryRepo.save.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.saveSpeedLogsEntries(data)).rejects.toThrow(
        "Error while saving Speed Log records to the database"
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        "Error saving Speed Log records:",
        error?.stack || error
      );
    });

    it("should handle missing testType field", async () => {
      const data = {
        testType: undefined,
        timeStamp: new Date(),
        speed: 100
      };

      speedLogEntryRepo.create.mockReturnValue({} as any);
      speedLogEntryRepo.save.mockResolvedValue({} as any);

      await service.saveSpeedLogsEntries(data);

      expect(speedLogEntryRepo.create).toHaveBeenCalledWith({
        speedLogId: undefined,
        timeStamp: data.timeStamp,
        speed: 100
      });
    });

    it("should handle NaN speed values", async () => {
      const data = {
        testType: "test",
        timeStamp: new Date(),
        speed: "invalid-number"
      };

      speedLogEntryRepo.create.mockReturnValue({} as any);
      speedLogEntryRepo.save.mockResolvedValue({} as any);

      await service.saveSpeedLogsEntries(data);

      expect(speedLogEntryRepo.create).toHaveBeenCalledWith({
        speedLogId: "test",
        timeStamp: data.timeStamp,
        speed: NaN
      });
    });
  });

  describe("createPartitionInventoryTableByJobRunId", () => {
    const validJobRunId = "12345678-1234-4123-8123-123456789012";
    
    beforeEach(() => {
      dataSource.query = jest.fn();
      process.env.SCHEMA = 'datamigrator';
    });

    afterEach(() => {
      delete process.env.SCHEMA;
    });

    it("should create partition using stored procedure successfully", async () => {
      (dataSource.query as jest.Mock).mockResolvedValue(undefined);

      await service.createPartitionInventoryTableByJobRunId(validJobRunId);

      expect(dataSource.query).toHaveBeenCalledWith(
        'CALL "datamigrator".create_inventory_partition($1, $2);',
        [validJobRunId, 'datamigrator']
      );
    });

    it("should throw ValidationError for null jobRunId", async () => {
      await expect(
        service.createPartitionInventoryTableByJobRunId(null as any)
      ).rejects.toThrow(ValidationError);
      
      await expect(
        service.createPartitionInventoryTableByJobRunId(null as any)
      ).rejects.toThrow("JobRunId is required to create partition table");
    });

    it("should throw ValidationError for empty jobRunId", async () => {
      await expect(
        service.createPartitionInventoryTableByJobRunId("")
      ).rejects.toThrow(ValidationError);
      
      await expect(
        service.createPartitionInventoryTableByJobRunId("")
      ).rejects.toThrow("JobRunId is required to create partition table");
    });

    it("should throw DatabaseError when stored procedure fails", async () => {
      const procedureError = new Error("Stored procedure failed");
      (dataSource.query as jest.Mock).mockRejectedValue(procedureError);

      await expect(
        service.createPartitionInventoryTableByJobRunId(validJobRunId)
      ).rejects.toThrow(DatabaseError);
      
      await expect(
        service.createPartitionInventoryTableByJobRunId(validJobRunId)
      ).rejects.toThrow("Error while creating partition inventory table");
    });

    it("should handle undefined SCHEMA environment variable", async () => {
      delete process.env.SCHEMA;
      (dataSource.query as jest.Mock).mockResolvedValue(undefined);

      await service.createPartitionInventoryTableByJobRunId(validJobRunId);

      expect(dataSource.query).toHaveBeenCalledWith(
        'CALL "datamigrator".create_inventory_partition($1, $2);',
        [validJobRunId, 'datamigrator']
      );
    });

    it("should log success message when partition creation succeeds", async () => {
      (dataSource.query as jest.Mock).mockResolvedValue(undefined);
      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.createPartitionInventoryTableByJobRunId(validJobRunId);

      expect(logSpy).toHaveBeenCalledWith(
        `Partition table  created or already exists for job run ID: ${validJobRunId}`
      );
    });

    it("should log error message when partition creation fails", async () => {
      const procedureError = new Error("Database connection failed");
      (dataSource.query as jest.Mock).mockRejectedValue(procedureError);
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(
        service.createPartitionInventoryTableByJobRunId(validJobRunId)
      ).rejects.toThrow(DatabaseError);

      expect(errorSpy).toHaveBeenCalledWith(
        `Failed to create partition table for jobRunId ${validJobRunId}: Database connection failed`,
        procedureError?.stack || procedureError
      );
    });
  });

  describe("markDirectoryTreeAsDeleted", () => {
    const jobRunId = "test-job-123";
    const directoryPath = "/test/directory";

    const makeDeletedDirMarker = (p: string): ItemInfo => {
      const m = createMockItemInfo({ fileName: p, isDirectory: true });
      (m as any).isDeleted = true;
      return m;
    };

    beforeEach(() => {
      dataSource.query = jest.fn();
    });

    it("should mark directory tree as deleted successfully", async () => {
      const mockResults = [
        {
          path: "/test/directory/file1.txt",
          is_directory: false,
          file_permission: "rw-r--r--",
          file_size: "1024",
          source_checksum: "abc123",
          target_checksum: "def456",
          parent_path: "/test/directory",
          depth: 3,
          file_name: "file1.txt",
          uid: "1001",
          gid: "1002",
          extension: ".txt",
          file_type: "text",
          modified_time: new Date(),
          access_time: new Date(),
          birth_time: new Date(),
          path_id: "path-123",
          source_meta: {},
          target_meta: {},
          inode: 12345
        },
        {
          path: "/test/directory/subdir",
          is_directory: true,
          file_permission: "rwxr-xr-x",
          file_size: "0",
          source_checksum: null,
          target_checksum: null,
          parent_path: "/test/directory",
          depth: 3,
          file_name: "subdir",
          uid: "1001",
          gid: "1002",
          extension: "",
          file_type: "directory",
          modified_time: new Date(),
          access_time: new Date(),
          birth_time: new Date(),
          path_id: "path-123",
          source_meta: {},
          target_meta: {},
          inode: 12346
        }
      ];

      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce(mockResults) 
        .mockResolvedValueOnce([]) 
        .mockResolvedValueOnce([]); // dirSelf: no parent directory row yet → ensure tombstone
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);
      await service.markDirectoryTreeAsDeleted(makeDeletedDirMarker(directoryPath), jobRunId, 'pathId', 'datamigrator');
      expect(dataSource.query).toHaveBeenCalledTimes(4);
      expect(inventoryRepo.upsert).toHaveBeenCalledTimes(2);
      expect(inventoryRepo.upsert).toHaveBeenNthCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            path: "/test/directory/file1.txt",
            isDeleted: true,
            jobRunId: jobRunId
          }),
          expect.objectContaining({
            path: "/test/directory/subdir",
            isDeleted: true,
            jobRunId: jobRunId
          })
        ]),
        ['path', 'jobRunId', 'isDirectory']
      );
      expect(inventoryRepo.upsert).toHaveBeenNthCalledWith(
        2,
        expect.arrayContaining([
          expect.objectContaining({
            path: "/test/directory",
            isDirectory: true,
            isDeleted: true,
            jobRunId: jobRunId,
          }),
        ]),
        ['path', 'jobRunId', 'isDirectory'],
      );
    });

    it("should handle empty query results gracefully", async () => {
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce([]) // Empty tree batch
        .mockResolvedValueOnce([]); // dirSelf: ensure deleted row for parent path
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);
      await service.markDirectoryTreeAsDeleted(makeDeletedDirMarker(directoryPath), jobRunId, 'pathId', 'datamigrator');
      expect(dataSource.query).toHaveBeenCalledTimes(3);
      expect(inventoryRepo.upsert).toHaveBeenCalledTimes(1);
      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            path: directoryPath,
            isDirectory: true,
            isDeleted: true,
            jobRunId,
          }),
        ]),
        ['path', 'jobRunId', 'isDirectory'],
      );
    });

    it("should handle null query results gracefully", async () => {
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce([]) // Empty tree batch
        .mockResolvedValueOnce([]); // dirSelf
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);
      await service.markDirectoryTreeAsDeleted(makeDeletedDirMarker(directoryPath), jobRunId, 'pathId', 'datamigrator');
      expect(dataSource.query).toHaveBeenCalledTimes(3);
      expect(inventoryRepo.upsert).toHaveBeenCalledTimes(1);
    });

    it("should return early when no related jobs are found", async () => {
      (dataSource.query as jest.Mock).mockResolvedValueOnce([]);
      const result = await service.markDirectoryTreeAsDeleted(makeDeletedDirMarker(directoryPath), jobRunId, 'pathId', 'datamigrator');
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(inventoryRepo.upsert).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("should process large result sets in batches", async () => {
      const mockResults1000 = Array(1000).fill(null).map((_, index) => ({
        path: `/test/directory/file${index}.txt`,
        is_directory: false,
        file_permission: "rw-r--r--",
        file_size: "1024",
        source_checksum: "abc123",
        target_checksum: "def456",
        parent_path: "/test/directory",
        depth: 3,
        file_name: `file${index}.txt`,
        uid: "1001",
        gid: "1002",
        extension: ".txt",
        file_type: "text",
        modified_time: new Date(),
        access_time: new Date(),
        birth_time: new Date(),
        path_id: "path-123",
        source_meta: {},
        target_meta: {},
        inode: 12345 + index
      }));
      
      const mockResults500 = Array(500).fill(null).map((_, index) => ({
        path: `/test/directory/file${1000 + index}.txt`,
        is_directory: false,
        file_permission: "rw-r--r--",
        file_size: "1024",
        source_checksum: "abc123",
        target_checksum: "def456",
        parent_path: "/test/directory",
        depth: 3,
        file_name: `file${1000 + index}.txt`,
        uid: "1001",
        gid: "1002",
        extension: ".txt",
        file_type: "text",
        modified_time: new Date(),
        access_time: new Date(),
        birth_time: new Date(),
        path_id: "path-123",
        source_meta: {},
        target_meta: {},
        inode: 13345 + index
      }));

      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce(mockResults1000) 
        .mockResolvedValueOnce(mockResults500)
        .mockResolvedValueOnce([]) // Empty to end pagination
        .mockResolvedValueOnce([]); // dirSelf → ensure parent tombstone
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);

      await service.markDirectoryTreeAsDeleted(makeDeletedDirMarker(directoryPath), jobRunId, 'pathId', 'datamigrator');

      expect(inventoryRepo.upsert).toHaveBeenCalledTimes(3);
    });

    it("should handle database query errors", async () => {
      const queryError = new Error("Database connection failed");
      (dataSource.query as jest.Mock).mockRejectedValue(queryError);
      const loggerSpy = jest.spyOn(service["logger"], "error");
      const deletedDir = makeDeletedDirMarker(directoryPath);
      const result = await service.markDirectoryTreeAsDeleted(deletedDir, jobRunId, 'pathId', 'datamigrator');
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to mark directory tree as deleted ${directoryPath}: ${queryError.message}`,
        queryError.stack
      );
      expect(result).toEqual([deletedDir]);
    });

    it("should handle upsert errors gracefully", async () => {
      const mockResults = [
        {
          path: "/test/directory/file1.txt",
          is_directory: false,
          file_permission: "rw-r--r--",
          file_size: "1024",
          source_checksum: "abc123",
          target_checksum: "def456",
          parent_path: "/test/directory",
          depth: 3,
          file_name: "file1.txt",
          uid: "1001",
          gid: "1002",
          extension: ".txt",
          file_type: "text",
          modified_time: new Date(),
          access_time: new Date(),
          birth_time: new Date(),
          path_id: "path-123",
          source_meta: {},
          target_meta: {},
          inode: 12345
        }
      ];

      const upsertError = new Error("Upsert failed");
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([]) // Empty to end pagination
        .mockResolvedValueOnce([]); // dirSelf
      inventoryRepo.upsert.mockRejectedValue(upsertError);
      const loggerSpy = jest.spyOn(service["logger"], "error");
      const deletedDir = makeDeletedDirMarker(directoryPath);
      const result = await service.markDirectoryTreeAsDeleted(deletedDir, jobRunId, 'pathId', 'datamigrator');
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to process batch`),
        expect.any(String)
      );
      expect(result).toEqual([deletedDir]);
    });

    it("returns [deletedDir] when batch 1 succeeds but batch 2 fails — hadBatchFailure is set mid-loop", async () => {
      const makeRow = (n: number) => ({
        path: `/test/directory/file${n}.txt`,
        is_directory: false,
        file_permission: "rw-r--r--",
        file_size: "1024",
        source_checksum: null,
        target_checksum: null,
        parent_path: "/test/directory",
        depth: 3,
        file_name: `file${n}.txt`,
        uid: "1001",
        gid: "1002",
        extension: ".txt",
        file_type: "text",
        modified_time: new Date(),
        access_time: new Date(),
        birth_time: new Date(),
        inode: n,
      });

      const batch1 = Array.from({ length: 1000 }, (_, i) => makeRow(i));
      const batch2 = Array.from({ length: 1000 }, (_, i) => makeRow(1000 + i));

      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) // related jobs
        .mockResolvedValueOnce(batch1)              // fetch batch 1
        .mockResolvedValueOnce(batch2)              // fetch batch 2
        .mockResolvedValueOnce([])                  // fetch batch 3 → empty → break
        .mockResolvedValueOnce([]);                 // dirSelf

      const batch2Error = new Error("batch 2 DB error");
      inventoryRepo.upsert
        .mockResolvedValueOnce({ identifiers: [], generatedMaps: [] } as any) // batch 1 ✓
        .mockRejectedValueOnce(batch2Error)                                    // batch 2 ✗
        .mockResolvedValueOnce({ identifiers: [], generatedMaps: [] } as any); // tombstone ✓

      const errorSpy = jest.spyOn(service["logger"], "error");
      const marker = makeDeletedDirMarker(directoryPath);

      // call should signal failure — [marker] returned so caller puts it back in failedRecords
      await expect(
        service.markDirectoryTreeAsDeleted(marker, jobRunId, 'pathId', 'datamigrator'),
      ).resolves.toEqual([marker]);

      // All three upserts attempted — loop continued past batch 1 success AND batch 2 failure
      expect(inventoryRepo.upsert).toHaveBeenCalledTimes(3);
      // batch 2 error was logged, not swallowed
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process batch 2'),
        batch2Error.stack,
      );
    });

    it("returns [] immediately when deletedDir.fileName is empty", async () => {
      const emptyMarker = createMockItemInfo({ isDirectory: true });
      (emptyMarker as any).fileName = null; // ?? '' → '' → !'' = true → early return
      (emptyMarker as any).isDeleted = true;
      const warnSpy = jest.spyOn(service["logger"], "warn");

      const result = await service.markDirectoryTreeAsDeleted(emptyMarker, jobRunId, "pathId", '"datamigrator"');

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        "markDirectoryTreeAsDeleted: missing fileName on deleted directory marker",
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it("skips tombstone upsert when directory row is already marked deleted", async () => {
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) // related jobs
        .mockResolvedValueOnce([])                 // tree batch → empty, nothing to upsert
        .mockResolvedValueOnce([{ is_deleted: true }]); // dirSelf → already deleted
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);

      const result = await service.markDirectoryTreeAsDeleted(
        makeDeletedDirMarker(directoryPath), jobRunId, "pathId", '"datamigrator"',
      );

      // Tree batch was empty so upsert for children never ran;
      // tombstone skipped because row already exists with is_deleted = true.
      expect(inventoryRepo.upsert).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("should handle Windows-style directory paths", async () => {
      const windowsPath = "C:\\Users\\test\\directory";
      const mockResults = [
        {
          path: "C:\\Users\\test\\directory\\file.txt",
          is_directory: false,
          file_permission: "rw-r--r--",
          file_size: "1024",
          source_checksum: "abc123",
          target_checksum: "def456",
          parent_path: "C:\\Users\\test\\directory",
          depth: 4,
          file_name: "file.txt",
          uid: "1001",
          gid: "1002",
          extension: ".txt",
          file_type: "text",
          modified_time: new Date(),
          access_time: new Date(),
          birth_time: new Date(),
          path_id: "path-123",
          source_meta: {},
          target_meta: {},
          inode: 12345
        }
      ];

      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([]) // Empty result to end pagination
        .mockResolvedValueOnce([]); // dirSelf
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);

      await service.markDirectoryTreeAsDeleted(makeDeletedDirMarker(windowsPath), jobRunId, 'pathId', 'datamigrator');

      expect(dataSource.query).toHaveBeenCalledTimes(4);
    });

    it("should preserve existing metadata when marking as deleted", async () => {
      const mockResults = [
        {
          path: "/test/directory/file1.txt",
          is_directory: false,
          file_permission: "rw-r--r--",
          file_size: "2048",
          source_checksum: "source123",
          target_checksum: "target456",
          parent_path: "/test/directory",
          depth: 3,
          file_name: "file1.txt",
          uid: "1001",
          gid: "1002",
          extension: ".txt",
          file_type: "text",
          modified_time: new Date("2024-01-01T12:00:00Z"),
          access_time: new Date("2024-01-02T12:00:00Z"),
          birth_time: new Date("2024-01-01T10:00:00Z"),
          path_id: "path-123",
          source_meta: { custom: "data" },
          target_meta: { other: "info" },
          inode: 98765
        }
      ];

      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([]) // Empty to end pagination
        .mockResolvedValueOnce([]); // dirSelf
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);

      await service.markDirectoryTreeAsDeleted(makeDeletedDirMarker(directoryPath), jobRunId, 'pathId', 'datamigrator');

      expect(inventoryRepo.upsert).toHaveBeenNthCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            path: "/test/directory/file1.txt",
            isDeleted: true,
            fileSize: "2048",
            permission: "rw-r--r--",
            uid: "1001",
            gid: "1002",
            extension: ".txt",
            fileType: "text",
            sourceMeta: null,
            targetMeta: null,
            inode: null
          })
        ]),
        ['path', 'jobRunId', 'isDirectory']
      );
    });

    it("should handle mixed file types (files and directories)", async () => {
      const mockResults = [
        {
          path: "/test/directory/file.txt",
          is_directory: false,
          file_permission: "rw-r--r--",
          file_size: "1024",
          source_checksum: "abc123",
          target_checksum: "def456",
          parent_path: "/test/directory",
          depth: 3,
          file_name: "file.txt",
          uid: "1001",
          gid: "1002",
          extension: ".txt",
          file_type: "text",
          modified_time: new Date(),
          access_time: new Date(),
          birth_time: new Date(),
          path_id: "path-123",
          source_meta: {},
          target_meta: {},
          inode: 12345
        },
        {
          path: "/test/directory/subdir",
          is_directory: true,
          file_permission: "rwxr-xr-x",
          file_size: "0",
          source_checksum: null,
          target_checksum: null,
          parent_path: "/test/directory",
          depth: 3,
          file_name: "subdir",
          uid: "1001",
          gid: "1002",
          extension: "",
          file_type: "directory",
          modified_time: new Date(),
          access_time: new Date(),
          birth_time: new Date(),
          path_id: "path-123",
          source_meta: {},
          target_meta: {},
          inode: 12346
        }
      ];

      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([]) 
        .mockResolvedValueOnce([]); // dirSelf
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);
      await service.markDirectoryTreeAsDeleted(makeDeletedDirMarker(directoryPath), jobRunId, 'pathId', 'datamigrator');
      const upsertCall = (inventoryRepo.upsert as jest.Mock).mock.calls[0][0];
      
      expect(upsertCall).toContainEqual(
        expect.objectContaining({
          path: "/test/directory/file.txt",
          isDirectory: false,
          isDeleted: true
        })
      );
      expect(upsertCall).toContainEqual(
        expect.objectContaining({
          path: "/test/directory/subdir",
          isDirectory: true,
          isDeleted: true
        })
      );
    });

    it("should log successful deletion operations", async () => {
      const mockResults = [
        {
          path: "/test/directory/file1.txt",
          is_directory: false,
          file_permission: "rw-r--r--",
          file_size: "1024",
          source_checksum: "abc123",
          target_checksum: "def456",
          parent_path: "/test/directory",
          depth: 3,
          file_name: "file1.txt",
          uid: "1001",
          gid: "1002",
          extension: ".txt",
          file_type: "text",
          modified_time: new Date(),
          access_time: new Date(),
          birth_time: new Date(),
          path_id: "path-123",
          source_meta: {},
          target_meta: {},
          inode: 12345
        }
      ];

      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([]) 
        .mockResolvedValueOnce([]); // dirSelf → tombstone for parent path
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);
      const loggerSpy = jest.spyOn(service["logger"], "log");
      await service.markDirectoryTreeAsDeleted(makeDeletedDirMarker(directoryPath), jobRunId, 'pathId', 'datamigrator');
      expect(loggerSpy).toHaveBeenCalledWith(
        `Successfully marked 2 items (files and directories) as deleted for directory: ${directoryPath}`
      );
    });
  });

  describe("getInventoryEntryTypesForPaths", () => {
    it("returns an empty map when paths array is empty", async () => {
      const result = await service.getInventoryEntryTypesForPaths("job-1", []);
      expect(result.size).toBe(0);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it("returns an empty map when paths is null", async () => {
      const result = await service.getInventoryEntryTypesForPaths("job-1", null as any);
      expect(result.size).toBe(0);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it("queries the DB and builds the result map using the supplied schemaOverride", async () => {
      dataSource.query = jest.fn().mockResolvedValue([
        { path: "/a/file.txt", is_directory: false, entry_type: "inventory" },
        { path: "/a/dir",      is_directory: true,  entry_type: null },
      ]);

      const result = await service.getInventoryEntryTypesForPaths(
        "job-1",
        [
          { path: "/a/file.txt", isDirectory: false },
          { path: "/a/dir",      isDirectory: true },
        ],
        '"datamigrator"',
      );

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(result.get("/a/file.txt|job-1|false")).toBe("inventory");
      expect(result.get("/a/dir|job-1|true")).toBeNull();
    });

    it("falls back to the default schema when schemaOverride is omitted", async () => {
      dataSource.query = jest.fn().mockResolvedValue([]);

      await service.getInventoryEntryTypesForPaths("job-1", [
        { path: "/f.txt", isDirectory: false },
      ]);

      const callArg: string = (dataSource.query as jest.Mock).mock.calls[0][0];
      expect(callArg).toContain('"datamigrator"');
    });
  });

  describe("computeInventoryDelta", () => {
    it("returns zeros when items array is empty", async () => {
      const result = await service.computeInventoryDelta("job-1", []);
      expect(result).toEqual({ fileCount: 0, dirCount: 0, totalSize: BigInt(0) });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it("returns zeros when items is null", async () => {
      const result = await service.computeInventoryDelta("job-1", null as any);
      expect(result).toEqual({ fileCount: 0, dirCount: 0, totalSize: BigInt(0) });
    });

    it("queries the DB and maps the returned row to the delta shape", async () => {
      dataSource.query = jest.fn().mockResolvedValue([
        { new_file_count: "3", new_dir_count: "1", new_total_size: "4096" },
      ]);

      const result = await service.computeInventoryDelta("job-1", [
        { path: "/a.txt", isDirectory: false, size: 1024 },
        { path: "/b.txt", isDirectory: false, size: 2048 },
        { path: "/c.txt", isDirectory: false, size: 1024 },
        { path: "/d",     isDirectory: true,  size: 0 },
      ]);

      expect(result).toEqual({ fileCount: 3, dirCount: 1, totalSize: BigInt(4096) });
    });

    it("defaults size to 0 when item.size is undefined", async () => {
      dataSource.query = jest.fn().mockResolvedValue([
        { new_file_count: "1", new_dir_count: "0", new_total_size: "0" },
      ]);

      const items = [{ path: "/f.txt", isDirectory: false, size: undefined as any }];
      await service.computeInventoryDelta("job-1", items);

      const sizeArr = (dataSource.query as jest.Mock).mock.calls[0][1][3];
      expect(sizeArr).toEqual([0]);
    });
  });

  describe("getOperationStatusFor", () => {
    it("should map CommandStatus.READY to OperationStatus.READY", () => {
      const result = (service as any).getOperationStatusFor(CommandStatus.READY);
      expect(result).toBe(OperationStatus.READY);
    });

    it("should map CommandStatus.IN_PROCESS to OperationStatus.IN_PROCESS", () => {
      const result = (service as any).getOperationStatusFor(CommandStatus.IN_PROCESS);
      expect(result).toBe(OperationStatus.IN_PROCESS);
    });

    it("should map CommandStatus.COMPLETED to OperationStatus.COMPLETED", () => {
      const result = (service as any).getOperationStatusFor(CommandStatus.COMPLETED);
      expect(result).toBe(OperationStatus.COMPLETED);
    });

    it("should map CommandStatus.ERROR to OperationStatus.ERROR", () => {
      const result = (service as any).getOperationStatusFor(CommandStatus.ERROR);
      expect(result).toBe(OperationStatus.ERROR);
    });
  });

  describe("validateAndQuoteSchema", () => {
    it("should validate and quote a valid schema name", () => {
      const result = (service as any).validateAndQuoteSchema('datamigrator');
      expect(result).toBe('"datamigrator"');
    });

    it("should handle schema names with underscores and hyphens", () => {
      const result1 = (service as any).validateAndQuoteSchema('data_migrator');
      const result2 = (service as any).validateAndQuoteSchema('data-migrator');
      expect(result1).toBe('"data_migrator"');
      expect(result2).toBe('"data-migrator"');
    });

    it("should throw error for empty schema name", () => {
      expect(() => (service as any).validateAndQuoteSchema('')).toThrow('Schema name is required');
      expect(() => (service as any).validateAndQuoteSchema(null)).toThrow('Schema name is required');
    });

    it("should throw error for invalid characters in schema name", () => {
      expect(() => (service as any).validateAndQuoteSchema('data;DROP TABLE')).toThrow(
        'Invalid schema name: data;DROP TABLE. Only alphanumeric characters, underscores, and hyphens are allowed.'
      );
      expect(() => (service as any).validateAndQuoteSchema('data\'migrator')).toThrow(
        'Invalid schema name: data\'migrator. Only alphanumeric characters, underscores, and hyphens are allowed.'
      );
    });

    it("should prevent SQL injection attempts", () => {
      const maliciousInputs = [
        'schema"; DROP TABLE users; --',
        'schema\'; DELETE FROM inventory; --',
        'schema/**/UNION/**/SELECT/**/',
        'schema OR 1=1',
      ];

      maliciousInputs.forEach(input => {
        expect(() => (service as any).validateAndQuoteSchema(input)).toThrow();
      });
    });
  });
});
