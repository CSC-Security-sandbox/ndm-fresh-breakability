import { Test, TestingModule } from "@nestjs/testing";
import { WorkersService } from "./workers.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { WorkerEntity } from "src/entities/worker.entity";
import { WorkersStatusPageDto } from "./dto/workers.page.dto";
import { WorkerStatus } from "src/constants/enums";
import { ConfigService } from "@nestjs/config";
import { HealthStatus } from "./worker.types";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

describe("WorkersService", () => {
  let service: WorkersService;
  let repository: Repository<WorkerEntity>;
  let configService: jest.Mocked<ConfigService>;
  let workerJobRunMapRepository: Repository<WorkerJobRunMap>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkersService,
        {
          provide: getRepositoryToken(WorkerEntity),
          useValue: {
            find: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(WorkerJobRunMap),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              log: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              verbose: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WorkersService>(WorkersService);
    repository = module.get<Repository<WorkerEntity>>(
      getRepositoryToken(WorkerEntity),
    );
    workerJobRunMapRepository = module.get<Repository<WorkerJobRunMap>>(
      getRepositoryToken(WorkerJobRunMap),
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("findAllWorkers", () => {
    it("should return paginated data with count", async () => {
      const workerStatusPageDto: WorkersStatusPageDto = {
        page: "1",
        limit: "10",
        sort: "name",
        order: "asc",
        workerId: "345678",
        workerName: "test",
        clientId: "asd",
        ipAddress: "121.12.12.2",
        projectId: "234",
        status: WorkerStatus.Online,
        fileServerId: "fs-123",
      };
      const workers = [
        { id: "1", name: "Worker1" },
        { id: "2", name: "Worker2" },
      ];
      const total = 2;

      jest.spyOn(repository, "find").mockResolvedValueOnce(workers as any);
      jest.spyOn(repository, "count").mockResolvedValueOnce(total);

      const result = await service.findAllWorkers(workerStatusPageDto);

      // Assertions
      expect(result).toEqual(workers);
      expect(repository.find).toHaveBeenCalledWith({
        where: {
          workerId: "345678",
          workerName: "test",
          clientId: "asd",
          ipAddress: "121.12.12.2",
          projectId: "234",
          status: WorkerStatus.Online,
          fileServers: { id: "fs-123" },
        },
        order: { name: "asc" },
        relations: ["stats", "fileServers"],
        skip: 0,
        take: 10,
      });
      expect(repository.count).toHaveBeenCalledWith({
        where: {
          workerId: "345678",
          workerName: "test",
          clientId: "asd",
          ipAddress: "121.12.12.2",
          projectId: "234",
          status: WorkerStatus.Online,
        },
      });
    });

    it("should return data without pagination if no page and limit are provided", async () => {
      const workerStatusPageDto: WorkersStatusPageDto = {
        sort: "name",
        order: "asc",
        // additional filters
      };
      const workers = [
        { id: "1", name: "Worker1" },
        { id: "2", name: "Worker2" },
      ];
      const total = 2;

      jest.spyOn(repository, "find").mockResolvedValueOnce(workers as any);
      jest.spyOn(repository, "count").mockResolvedValueOnce(total);

      const result = await service.findAllWorkers(workerStatusPageDto);

      // Assertions
      expect(result).toEqual(workers);
      expect(repository.find).toHaveBeenCalledWith({
        where: {},
        order: { name: "asc" },
        relations: ["stats"],
      });
      expect(repository.count).toHaveBeenCalled();
    });

    it("should return an empty result when no workers are found", async () => {
      const workerStatusPageDto: WorkersStatusPageDto = {
        page: "1",
        limit: "10",
      };
      jest.spyOn(repository, "find").mockResolvedValueOnce([]);
      jest.spyOn(repository, "count").mockResolvedValueOnce(0);

      const result = await service.findAllWorkers(workerStatusPageDto);

      // Assertions
      expect(result).toEqual([]);
      expect(repository.find).toHaveBeenCalled();
      expect(repository.count).toHaveBeenCalled();
    });

    it("should handle repository errors", async () => {
      const workerStatusPageDto: WorkersStatusPageDto = {
        page: "1",
        limit: "10",
      };
      jest
        .spyOn(repository, "find")
        .mockRejectedValueOnce(new Error("Database error"));

      await expect(service.findAllWorkers(workerStatusPageDto)).rejects.toThrow(
        "Database error",
      );
      expect(repository.find).toHaveBeenCalled();
    });

    it("should return paginated data with count for job run id", async () => {
      const workerStatusPageDto: WorkersStatusPageDto = {
        page: "1",
        limit: "10",
        sort: "name",
        order: "asc",
        workerId: "345678",
        workerName: "test",
        clientId: "asd",
        ipAddress: "121.12.12.2",
        projectId: "234",
        jobRunId: "123",
        status: WorkerStatus.Online,
      };
      const workers = [
        { id: "1", name: "Worker1", stats: { healthStatus: "healthy" } },
        { id: "2", name: "Worker2", stats: { healthStatus: "healthy" } },
      ];
      const total = 2;

      jest.spyOn(repository, "find").mockResolvedValueOnce(workers as any);
      jest.spyOn(repository, "count").mockResolvedValueOnce(total);

      const result = await service.findAllWorkers(workerStatusPageDto);

      // Assertions
      expect(result).toEqual(workers);
      expect(repository.find).toHaveBeenCalledWith({
        where: {
          workerId: "345678",
          workerName: "test",
          clientId: "asd",
          ipAddress: "121.12.12.2",
          jobRunMap: { jobRunId: "123" },
          projectId: "234",
          status: WorkerStatus.Online,
        },
        order: { name: "asc" },
        relations: ["stats"],
        skip: 0,
        take: 10,
      });
      expect(repository.count).toHaveBeenCalledWith({
        where: {
          workerId: "345678",
          workerName: "test",
          clientId: "asd",
          ipAddress: "121.12.12.2",
          jobRunMap: { jobRunId: "123" },
          projectId: "234",
          status: WorkerStatus.Online,
        },
      });
    });
  });

  it("should update worker status based on health status", async () => {
    const workers = [
      {
        id: "1",
        name: "Worker1",
        stats: { healthStatus: HealthStatus.Healthy, updatedAt: new Date() },
        status: WorkerStatus.Online,
      },
      {
        id: "2",
        name: "Worker2",
        stats: { healthStatus: HealthStatus.Unhealthy, updatedAt: new Date() },
        status: WorkerStatus.Online,
      },
      {
        id: "3",
        name: "Worker3",
        stats: {
          healthStatus: HealthStatus.Healthy,
          updatedAt: new Date(new Date().getTime() - 61000),
        },
        status: WorkerStatus.Online,
      },
    ];
    const total = 2;
    const workerStatusPageDto: WorkersStatusPageDto = {
      sort: "name",
      order: "asc",
      // additional filters
    };
    jest.spyOn(configService, "get").mockReturnValue(60);
    jest.spyOn(repository, "find").mockResolvedValueOnce(workers as any);
    jest.spyOn(repository, "count").mockResolvedValueOnce(total);

    const result = await service.findAllWorkers(workerStatusPageDto);

    expect(result[0].status).toBe(WorkerStatus.Online);
    expect(result[1].status).toBe(WorkerStatus.Offline);
    expect(result[2].status).toBe(WorkerStatus.Offline);
  });

  describe("updateWorkerJobRunStatus", () => {
    let workerJobRunMapFindOne: jest.SpyInstance;
    let workerJobRunMapSave: jest.SpyInstance;

    beforeEach(() => {
      workerJobRunMapFindOne = jest
        .spyOn(workerJobRunMapRepository, "findOne")
        .mockImplementation();
      workerJobRunMapSave = jest
        .spyOn(workerJobRunMapRepository, "save")
        .mockImplementation();
    });

    it("should update isActive and save when mapping exists", async () => {
      const workerId = "worker-1";
      const jobRunId = "jobrun-1";
      const active = true;
      const mockMap = { workerId, jobRunId, isActive: false };
      workerJobRunMapFindOne.mockResolvedValueOnce(mockMap as any);
      workerJobRunMapSave.mockResolvedValueOnce({ ...mockMap, isActive: active });

      const result = await service.updateWorkerJobRunStatus(workerId, jobRunId, active);

      expect(workerJobRunMapFindOne).toHaveBeenCalledWith({
        where: { workerId, jobRunId },
      });
      expect(workerJobRunMapSave).toHaveBeenCalledWith({ ...mockMap, isActive: active });
      expect(result).toEqual({ ...mockMap, isActive: active });
    });

    it("should throw BadRequestException if mapping does not exist", async () => {
      const workerId = "worker-2";
      const jobRunId = "jobrun-2";
      workerJobRunMapFindOne.mockResolvedValueOnce(undefined);

      await expect(
        service.updateWorkerJobRunStatus(workerId, jobRunId, true),
      ).rejects.toThrow(
        `Worker Job Run mapping not found for workerId: ${workerId} and jobrunId: ${jobRunId}`,
      );
      expect(workerJobRunMapFindOne).toHaveBeenCalledWith({
        where: { workerId, jobRunId },
      });
      expect(workerJobRunMapSave).not.toHaveBeenCalled();
    });
  });

  describe("updateWorkerStatus", () => {
    it("should set status to Offline if stats is missing", () => {
      jest.spyOn(configService, "get").mockReturnValue(60);
      const workers = [
        { id: "1", name: "Worker1", stats: undefined, status: WorkerStatus.Online },
        { id: "2", name: "Worker2", stats: null, status: WorkerStatus.Online },
      ];
      const result = service.updateWorkerStatus(workers as any);
      expect(result[0].status).toBe(WorkerStatus.Offline);
      expect(result[1].status).toBe(WorkerStatus.Offline);
    });

    it("should set status to Offline if healthStatus is missing", () => {
      jest.spyOn(configService, "get").mockReturnValue(60);
      const workers = [
        { id: "1", name: "Worker1", stats: {}, status: WorkerStatus.Online },
      ];
      const result = service.updateWorkerStatus(workers as any);
      expect(result[0].status).toBe(WorkerStatus.Offline);
    });

    it("should set status to Offline if healthStatus is not Healthy", () => {
      jest.spyOn(configService, "get").mockReturnValue(60);
      const workers = [
        {
          id: "1",
          name: "Worker1",
          stats: { healthStatus: HealthStatus.Unhealthy, updatedAt: new Date() },
          status: WorkerStatus.Online,
        },
      ];
      const result = service.updateWorkerStatus(workers as any);
      expect(result[0].status).toBe(WorkerStatus.Offline);
    });

    it("should set status to Offline if updatedAt is older than timeout", () => {
      jest.spyOn(configService, "get").mockReturnValue(60);
      const workers = [
        {
          id: "1",
          name: "Worker1",
          stats: {
            healthStatus: HealthStatus.Healthy,
            updatedAt: new Date(Date.now() - 61000),
          },
          status: WorkerStatus.Online,
        },
      ];
      const result = service.updateWorkerStatus(workers as any);
      expect(result[0].status).toBe(WorkerStatus.Offline);
    });

    it("should set status to Online if healthStatus is Healthy and updatedAt is recent", () => {
      jest.spyOn(configService, "get").mockReturnValue(60);
      const workers = [
        {
          id: "1",
          name: "Worker1",
          stats: {
            healthStatus: HealthStatus.Healthy,
            updatedAt: new Date(),
          },
          status: WorkerStatus.Offline,
        },
      ];
      const result = service.updateWorkerStatus(workers as any);
      expect(result[0].status).toBe(WorkerStatus.Online);
    });
  });
});
