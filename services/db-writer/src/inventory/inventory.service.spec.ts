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

    // Create mocked data source
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
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
            isDeleted: false
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
        expect(result.modifiedTime).toBeNull();
        expect(result.accessTime).toBeNull();
        expect(result.permission).toBeNull();
        expect(result.birthTime).toBeNull();
    });

    it('should throw an error if file is null or undefined', () => {
        expect(() => service.mapSourceToTarget(null, jobRunId, pathId)).toThrow('Invalid file object: Cannot map undefined or null file');
        expect(() => service.mapSourceToTarget(undefined, jobRunId, pathId)).toThrow('Invalid file object: Cannot map undefined or null file');
    });
  });

  describe("createInventory", () => {
    it("should return early if no data is provided", async () => {
      const result = await service.createInventory([], "jobRunId", "pathId");
      expect(result).toBeUndefined();
      
      // Verify no repository methods were called
      expect(inventoryRepo.upsert).not.toHaveBeenCalled();
    });

    it("should return early if data is null", async () => {
      const result = await service.createInventory(null, "jobRunId", "pathId");
      expect(result).toBeUndefined();
      expect(inventoryRepo.upsert).not.toHaveBeenCalled();
    });

    it("should save inventory records successfully", async () => {
      const data = [createMockItemInfo()];
      const mappedData = { 
        path: "/test/path/file.txt", 
        jobRunId: "jobRunId", 
        pathId: "pathId",
        fileName: "/test/path/file.txt",
        isDirectory: false,
        fileSize: "1024"
      };

      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(mappedData);
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [{ id: 1 }] } as any);

      await service.createInventory(data, "jobRunId", "pathId");

      expect(service.mapSourceToTarget).toHaveBeenCalledWith(
        data[0],
        "jobRunId",
        "pathId"
      );
      expect(inventoryRepo.upsert).toHaveBeenCalled();
    });

    it("should log an error if saving inventory records fails", async () => {
      const data = [createMockItemInfo()];
      const error = new Error("Database error");
      
      jest.spyOn(service, "mapSourceToTarget").mockReturnValue({} as any);
      inventoryRepo.upsert.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await service.createInventory(data, "jobRunId", "pathId");

      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to save inventory batch: ${error.message}`,
        error?.stack || error
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to save 1 inventory records`
      );
    });

    it("should populate file_type as Junction when fileType is Junction", async () => {
      const data = [
      createMockItemInfo({ fileName: '/junction/path', fileType: FileType.JUNCTION }),
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

      await service.createInventory(data, "jobRunId", "pathId");

      expect(service.mapSourceToTarget).toHaveBeenCalledWith(
      data[0],
      "jobRunId",
      "pathId"
      );
      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
      expect.objectContaining({ fileType: FileType.JUNCTION }),
      ]),
      ['path', 'jobRunId', 'isDirectory']
      );
    });

    it("should process large datasets in batches", async () => {
      // Create 1500 items to test batching (batch size is 500)
      const data = Array(1500).fill(null).map(() => createMockItemInfo());
      
      jest.spyOn(service, "mapSourceToTarget").mockReturnValue({} as any);
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [] } as any);

      await service.createInventory(data, "jobRunId", "pathId");

      // Should be called 3 times (1500 / 500 = 3 batches)
      expect(inventoryRepo.upsert).toHaveBeenCalledTimes(3);
    });

    it("should handle duplicate items correctly", async () => {
      const data = [
        createMockItemInfo({ fileName: '/same/path.txt' }),
        createMockItemInfo({ fileName: '/same/path.txt' }),
        createMockItemInfo({ fileName: '/different/path.txt' }),
      ];
      
      jest.spyOn(service, "mapSourceToTarget").mockImplementation((item) => ({
        path: item.fileName,
        jobRunId: "jobRunId",
        isDirectory: item.isDirectory,
      }));
      
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [] } as any);

      await service.createInventory(data, "jobRunId", "pathId");

      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ path: '/same/path.txt' }),
          expect.objectContaining({ path: '/different/path.txt' }),
        ]),
        ['path', 'jobRunId', 'isDirectory']
      );
    });

    it("should process deleted directory markers when isDeleted is true and isDirectory is true", async () => {
      const deletedDirectoryMarker = createMockItemInfo({
        fileName: '/test/deleted/directory',
        isDirectory: true
      });
      (deletedDirectoryMarker as any).isDeleted = true;
      dataSource.query = jest.fn().mockResolvedValue([]);
      jest.spyOn(service, "markDirectoryTreeAsDeleted").mockResolvedValue();

      await service.createInventory([deletedDirectoryMarker], "jobRunId", "pathId");

      expect(service.markDirectoryTreeAsDeleted).toHaveBeenCalledWith(
        '/test/deleted/directory',
        'jobRunId',
        'pathId',
        '"datamigrator"'
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
        .mockResolvedValueOnce([]); 
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);
      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');
      expect(dataSource.query).toHaveBeenCalledTimes(3);
      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
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
    });

    it("should handle empty query results gracefully", async () => {
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce([]); // Empty results
      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');
      expect(dataSource.query).toHaveBeenCalledTimes(2); 
      expect(inventoryRepo.upsert).not.toHaveBeenCalled(); 
    });

    it("should handle null query results gracefully", async () => {
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ id: jobRunId }]) 
        .mockResolvedValueOnce([]); // Empty results
      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');
      expect(dataSource.query).toHaveBeenCalledTimes(2);
      expect(inventoryRepo.upsert).not.toHaveBeenCalled();
    });

    it("should return early when no related jobs are found", async () => {
      (dataSource.query as jest.Mock).mockResolvedValueOnce([]);
      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');
      expect(dataSource.query).toHaveBeenCalledTimes(1); 
      expect(inventoryRepo.upsert).not.toHaveBeenCalled();
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
        .mockResolvedValueOnce([]); // Empty to end pagination
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);

      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');

      expect(inventoryRepo.upsert).toHaveBeenCalledTimes(2);
    });

    it("should handle database query errors", async () => {
      const queryError = new Error("Database connection failed");
      (dataSource.query as jest.Mock).mockRejectedValue(queryError);
      const loggerSpy = jest.spyOn(service["logger"], "error");
      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to mark directory tree as deleted ${directoryPath}: ${queryError.message}`,
        queryError.stack
      );
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
        .mockResolvedValueOnce([]); // Empty to end pagination
      inventoryRepo.upsert.mockRejectedValue(upsertError);
      const loggerSpy = jest.spyOn(service["logger"], "error");
      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to process batch`),
        expect.any(String)
      );
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
        .mockResolvedValueOnce([]); // Empty result to end pagination
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);

      await service.markDirectoryTreeAsDeleted(windowsPath, jobRunId, 'pathId', 'datamigrator');

      expect(dataSource.query).toHaveBeenCalledTimes(3);
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
        .mockResolvedValueOnce([]); // Empty to end pagination
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);

      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');

      expect(inventoryRepo.upsert).toHaveBeenCalledWith(
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
        .mockResolvedValueOnce([]); 
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);
      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');
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
        .mockResolvedValueOnce([]); 
      inventoryRepo.upsert.mockResolvedValue({ identifiers: [], generatedMaps: [] } as any);
      const loggerSpy = jest.spyOn(service["logger"], "log");
      await service.markDirectoryTreeAsDeleted(directoryPath, jobRunId, 'pathId', 'datamigrator');
      expect(loggerSpy).toHaveBeenCalledWith(
        `Successfully marked 1 items (files and directories) as deleted for directory: ${directoryPath}`
      );
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
