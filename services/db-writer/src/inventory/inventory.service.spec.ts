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
} from "@netapp-cloud-datamigrate/jobs-lib";
import { CreateInventory } from "./inventory.types";
import { OperationStatus } from "../enum/queues.enum";
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';

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

  describe('mapSourceToTarget', () => {
    const jobRunId = 'test-job-123';
    const pathId = 'test-path-456';

    it('should correctly map a valid file object', () => {
        const file = {
            path: '/test/path/file.txt',
            isDirectory: false,
            sourceChecksum: 'abc123',
            targetChecksum: 'xyz456',
            parentPath: '/test/path',
            depth: 2,
            fileName: 'file.txt',
            uid: 1001,
            gid: 1002,
            fileSize: 1024,
            extension: '.txt',
            fileType: 'text',
            modifiedTime: new Date('2024-01-01T12:00:00Z'),
            accessTime: new Date('2024-01-02T12:00:00Z'),
            permission: 'rw-r--r--',
            birthTime: new Date('2024-01-01T10:00:00Z'),
        };

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
        });
    });

    it('should handle missing properties and assign defaults', () => {
        const file = {}; // Empty file object

        const result = service.mapSourceToTarget(file, jobRunId, pathId);

        expect(result).toEqual({
            path: '',
            isDirectory: false,
            sourceChecksum: null,
            targetChecksum: null,
            parentPath: '',
            depth: 0,
            fileName: '',
            uid: '',
            gid: '',
            fileSize: '0',
            extension: '',
            fileType: null,
            modifiedTime: null,
            accessTime: null,
            permission: '',
            jobRunId: 'test-job-123',
            birthTime: null,
            pathId: 'test-path-456',
        });
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

    it("should save inventory records successfully", async () => {
      const data: CreateInventory[] = [
        { 
          path: "/path/to/file",
          fileName: "test.txt",
          isDirectory: false,
          fileSize: "1024"
        } as any
      ];
      const mappedData = [
        { 
          path: "/path/to/file", 
          jobRunId: "jobRunId", 
          pathId: "pathId",
          fileName: "test.txt",
          isDirectory: false,
          fileSize: "1024"
        },
      ];

      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(mappedData[0]);
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
      const data: CreateInventory[] = [{ path: "/path/to/file" } as any];
      const error = new Error("Database error");
      
      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(data[0]);
      inventoryRepo.upsert.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await service.createInventory(data, "jobRunId", "pathId");

      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to save inventory batch: ${error.message}`
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to save 1 inventory records`
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
        `Failed to save operation error: ${error.message}`
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
        `Failed to save task error: ${error.message}`
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

      // Mock the query runner and its methods
      const mockTask = { id: "taskId", status: "IN_PROGRESS" };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);

      await service.saveTasks(data);

      // Verify query runner transaction methods were called
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.findOne).toHaveBeenCalledWith(TaskEntity, {
        where: { id: "taskId" },
        lock: { mode: "pessimistic_write" },
      });
      expect(queryRunner.manager.upsert).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      
      // Verify operations were saved
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
        commands: [], // Empty commands array
        workerId: "workerId",
        id: "taskId",
      };

      const mockTask = { id: "taskId", status: "IN_PROGRESS" };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      (queryRunner.manager.upsert as jest.Mock).mockResolvedValue(undefined);

      await service.saveTasks(data);

      expect(queryRunner.manager.upsert).toHaveBeenCalled();
      expect(operationRepo.upsert).not.toHaveBeenCalled(); // Should not be called for empty commands
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

      // Mock an existing task with COMPLETED status
      const mockTask = { id: "taskId", status: TaskStatus.COMPLETED };
      (queryRunner.manager.findOne as jest.Mock).mockResolvedValue(mockTask);
      operationRepo.upsert.mockResolvedValue({} as InsertResult);

      await service.saveTasks(data);

      expect(queryRunner.manager.findOne).toHaveBeenCalled();
      expect(queryRunner.manager.upsert).not.toHaveBeenCalled(); // Should skip upsert for completed task
      expect(operationRepo.upsert).toHaveBeenCalled(); // Should still save operations
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
      expect(loggerSpy).toHaveBeenCalledWith("Failed to save task:", error);
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
        `Failed to update task (ID: ${taskId}): ${error.message}`
      );
    });
  });
});
