import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Logger } from "@nestjs/common";
import { InsertResult, Repository } from "typeorm";
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
import { SpeedLogEntity } from "src/entities/speed-test.entity";
import { SpeedLogEntryEntity } from "src/entities/speed-test.entity";

describe("InventoryService", () => {
  let service: InventoryService;
  let inventoryRepo: Repository<InventoryEntity>;
  let taskRepo: Repository<TaskEntity>;
  let operationRepo: Repository<OperationsEntity>;
  let operationErrorRepo: Repository<OperationErrorEntity>;
  let taskErrorRepo: Repository<TaskErrorEntity>;
  let speedLogEntityRepo: Repository<SpeedLogEntity>;
  let speedLogEntryEntityRepo: Repository<SpeedLogEntryEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(TaskEntity),
          useClass: Repository,
        },        
        {
          provide: getRepositoryToken(SpeedLogEntity),
          useClass: Repository,
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SpeedLogEntryEntity),
          useClass: Repository,
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(OperationsEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(OperationErrorEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(TaskErrorEntity),
          useClass: Repository,
        },
        Logger,
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    inventoryRepo = module.get<Repository<InventoryEntity>>(
      getRepositoryToken(InventoryEntity)
    );
    taskRepo = module.get<Repository<TaskEntity>>(
      getRepositoryToken(TaskEntity)
    );
    operationRepo = module.get<Repository<OperationsEntity>>(
      getRepositoryToken(OperationsEntity)
    );
    operationErrorRepo = module.get<Repository<OperationErrorEntity>>(
      getRepositoryToken(OperationErrorEntity)
    );
    taskErrorRepo = module.get<Repository<TaskErrorEntity>>(
      getRepositoryToken(TaskErrorEntity)
    );
  });

  describe("mapSourceToTarget", () => {
    it("should map source file to target object", () => {
      const file = {
        path: "/path/to/file",
        isDirectory: false,
        sourceChecksum: "abc123",
        targetChecksum: "def456",
        parentPath: "/path/to",
        depth: 1,
        fileName: "file.txt",
        uid: 1000,
        gid: 1000,
        fileSize: 1024,
        extension: ".txt",
        fileType: "text",
        modifiedTime: new Date(),
        accessTime: new Date(),
        permission: "rw-r--r--",
        birthTime: new Date(),
      };
      const jobRunId = "jobRunId";
      const pathId = "pathId";

      const result = service.mapSourceToTarget(file, jobRunId, pathId);

      expect(result).toEqual({
        path: "/path/to/file",
        isDirectory: false,
        sourceChecksum: "abc123",
        targetChecksum: "def456",
        parentPath: "/path/to",
        depth: 1,
        fileName: "file.txt",
        uid: "1000",
        gid: "1000",
        fileSize: "1024",
        extension: ".txt",
        fileType: "text",
        modifiedTime: file.modifiedTime,
        accessTime: file.accessTime,
        permission: "rw-r--r--",
        jobRunId: "jobRunId",
        birthTime: file.birthTime,
        pathId: "pathId",
      });
    });

    it("should throw an error if file is null or undefined", () => {
      expect(() =>
        service.mapSourceToTarget(null, "jobRunId", "pathId")
      ).toThrow("Invalid file object: Cannot map undefined or null file");
    });
  });

  describe("createInventory", () => {
    it("should log a warning if no data is provided", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "warn");
      await service.createInventory([], "jobRunId", "pathId");
      expect(loggerSpy).toHaveBeenCalledWith(
        "No inventory data received, skipping insert."
      );
    });

    it("should save inventory records", async () => {
      const data: CreateInventory[] = [{ path: "/path/to/file" } as any];
      const mappedData = [
        { path: "/path/to/file", jobRunId: "jobRunId", pathId: "pathId" },
      ];
      const inventoryRecords = [{ id: 1, path: "/path/to/file" }];

      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(mappedData[0]);
      jest
        .spyOn(inventoryRepo, "create")
        .mockReturnValue(inventoryRecords as any);
      jest
        .spyOn(inventoryRepo, "save")
        .mockResolvedValue(inventoryRecords as any);

      await service.createInventory(data, "jobRunId", "pathId");

      expect(service.mapSourceToTarget).toHaveBeenCalledWith(
        data[0],
        "jobRunId",
        "pathId"
      );
      expect(inventoryRepo.create).toHaveBeenCalledWith(mappedData);
      expect(inventoryRepo.save).toHaveBeenCalledWith(inventoryRecords);
    });


    // failedRecords > 0 
    it("should log an error if saving inventory records fails", async () => {
      const data: CreateInventory[] = [{ path: "/path/to/file" } as any];
      const error = new Error("Database error");
      jest.spyOn(service, "mapSourceToTarget").mockReturnValue(data[0]);
      jest.spyOn(inventoryRepo, "create").mockReturnValue(data as any);
      jest.spyOn(inventoryRepo, "save").mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await service.createInventory(data, "jobRunId", "pathId");

      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to save inventory records in batch: ${error.message}`,
        error.stack
      );
    })
  });

  describe("saveOperationError", () => {
    it("should save operation error records", async () => {
      const data: OperationError = {
        errorCode: "123",
        errorMessage: "Error",
        operationId: "opId",
        errorType: ErrorType.FATAL_ERROR,
        errorFiles: { fileName: "file.txt", filePath: "/path/to/file" },
      };
      const operationError = {
        id: 1,
        errorCode: "123",
        errorMessage: "Error",
        operationId: "opId",
        fileName: "file.txt",
        filePath: "/path/to/file",
        createdAt: new Date(),
      };

      jest
        .spyOn(operationErrorRepo, "create")
        .mockReturnValue(operationError as any);
      jest
        .spyOn(operationErrorRepo, "save")
        .mockResolvedValue(operationError as any);

      await service.saveOperationError(data);

      expect(operationErrorRepo.create).toHaveBeenCalledWith({
        errorCode: "123",
        errorMessage: "Error",
        operationId: "opId",
        fileName: "file.txt",
        filePath: "/path/to/file",
        createdAt: expect.any(Date),
        error_type:'FATAL_ERROR'
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
      jest.spyOn(operationErrorRepo, "create").mockReturnValue(data as any);
      jest.spyOn(operationErrorRepo, "save").mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.saveOperationError(data)).rejects.toThrow(
        "Error while saving operation error records to the database"
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to save operation error records: ${error.message}`,
        error.stack
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

      jest.spyOn(taskErrorRepo, "create").mockReturnValue(taskError as any);
      jest.spyOn(taskErrorRepo, "save").mockResolvedValue(taskError as any);

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
      jest.spyOn(taskErrorRepo, "create").mockReturnValue(data as any);
      jest.spyOn(taskErrorRepo, "save").mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.saveTaskError(data)).rejects.toThrow(
        "Error while saving task error records to the database"
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to save task error records: ${error.message}`,
        error.stack
      );
    });
  });

  describe("saveTasks", () => {
   

    it("should save task and operations", async () => {
      const data = {
        jobRunId: "jobRunId",
        taskType: "taskType",
        status: "status",
        sPathId: "sPathId",
        tPathId: "tPathId",
        commands: [{ commandId: "cmd1", fPath: "/path/to/file" }],
        workerId: "workerId",
        id: "taskId",
      };
    
      const task = {
        id: "taskId",
        jobRunId: "jobRunId",
        status: "status",
        taskType: "taskType",
        workerId: "workerId",
      };
    
      jest.spyOn(taskRepo, "findOne").mockResolvedValue(null);
      const upsertSpy = jest.spyOn(taskRepo, "upsert").mockResolvedValue(task as any);
      jest.spyOn(operationRepo, "upsert").mockResolvedValue({} as InsertResult);
    
      await service.saveTasks(data);
    
      jest.spyOn(operationRepo, "upsert").mockImplementation(async (batch) => {
        console.log("Upserting batch:", batch);
        return {} as InsertResult;
      });
    });
    
    it("should throw an error if task data is invalid", async () => {
      await expect(service.saveTasks(null)).rejects.toThrow("Invalid task data");

    });

  

    // it(!taskId) case
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

  describe("updateTask", () => {
    it("should update task data", async () => {
      const taskId = "taskId";
      const data = { status: TaskStatus.COMPLETED };
      const updateResult = { affected: 1 };

      jest.spyOn(taskRepo, "update").mockResolvedValue(updateResult as any);

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
      jest.spyOn(taskRepo, "update").mockResolvedValue(updateResult as any);
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
      jest.spyOn(taskRepo, "update").mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service["logger"], "error");

      await expect(service.updateTask(taskId, data)).rejects.toThrow(
        "Error while updating task data"
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Failed to update task (ID: ${taskId}): ${error.message}`,
        error.stack
      );
    });
  });
});
