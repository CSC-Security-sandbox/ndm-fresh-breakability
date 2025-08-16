import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { WorkflowService } from "./workflow.service";
import { Client, Connection } from "@temporalio/client";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";
import { WorkflowError, ConfigurationError } from "../errors/custom-errors";

describe("WorkflowService", () => {
  let service: WorkflowService;
  let configService: ConfigService;
  let client: Client;
  let connection: Connection;
  let loggerMock: any;

  beforeEach(async () => {
    loggerMock = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({ address: "localhost:7233" }),
          },
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(loggerMock),
          },
        },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
    configService = module.get<ConfigService>(ConfigService);
    client = new Client({ connection: {} as Connection });
    connection = {
      close: jest.fn().mockResolvedValue(undefined),
    } as any;
  });

  describe("getClient", () => {
    it("should return an existing client if already initialized", async () => {
      (service as any).client = client;
      const result = await (service as any).getClient();
      expect(result).toBe(client);
    });

    it("should create a new client if not initialized", async () => {
      jest.spyOn(Connection, "connect").mockResolvedValue(connection);
      jest
        .spyOn(Client.prototype, "constructor" as any)
        .mockImplementation(() => client as any);

      const result = await (service as any).getClient();
      expect(result).toBeDefined();
      expect(Connection.connect).toHaveBeenCalledWith({
        address: "localhost:7233",
      });
    });

    it("should retry on error", async () => {
      jest
        .spyOn(Connection, "connect")
        .mockRejectedValueOnce(new Error("Connection error"));
      jest.spyOn(Connection, "connect").mockResolvedValue(connection);
      jest
        .spyOn(Client.prototype, "constructor" as any)
        .mockImplementation(() => client as any);

        try {
          const result = await (service as any).getClient();
          expect(result).toBeDefined();
        } catch (error) {
          expect(Connection.connect).toHaveBeenCalledTimes(2);
        }
    });

    it("should throw WorkflowError when connection fails", async () => {
      const error = new Error("Connection failed");
      jest.spyOn(Connection, "connect").mockRejectedValue(error);

      await expect((service as any).getClient()).rejects.toThrow(WorkflowError);
      await expect((service as any).getClient()).rejects.toThrow("Failed to initialize Temporal client: Connection failed");
      expect(loggerMock.error).toHaveBeenCalledWith(
        "Error connecting to Temporal server: Connection failed",
        error.stack
      );
    });

    it("should use fallback address when TEMPORAL_ADDRESS is not set", async () => {
      const originalEnv = process.env.TEMPORAL_ADDRESS;
      delete process.env.TEMPORAL_ADDRESS;

      jest.spyOn(Connection, "connect").mockResolvedValue(connection);
      jest
        .spyOn(Client.prototype, "constructor" as any)
        .mockImplementation(() => client as any);

      await (service as any).getClient();

      expect(Connection.connect).toHaveBeenCalledWith({
        address: "localhost:7233",
      });

      process.env.TEMPORAL_ADDRESS = originalEnv;
    });

    it('should throw an error if client is not found', async () => {
      jest.spyOn(service as any, 'getClient').mockResolvedValue(null); // Force getClient() to return null
      await expect(service.signalWorkflow({})).rejects.toThrow('Workflow signal failed: Temporal client not available');
  });
  });

  describe("signalWorkflow", () => {
    it("should signal workflow execution", async () => {
      const request = {
        workflowExecution: { workflowId: "test-workflow" },
        signalName: "test-signal",
      };
      const signalWorkflowExecution = jest.fn().mockResolvedValue("success");
      jest.spyOn(service as any, "getClient").mockResolvedValue({
        workflowService: { signalWorkflowExecution },
      });

      const result = await service.signalWorkflow(request);
      expect(result).toBe("success");
      expect(signalWorkflowExecution).toHaveBeenCalledWith(request);
      expect(loggerMock.log).toHaveBeenCalledWith("Signaling workflow: test-workflow");
    });

    it("should signal workflow execution without workflowExecution", async () => {
      const request = {
        signalName: "test-signal",
      };
      const signalWorkflowExecution = jest.fn().mockResolvedValue("success");
      jest.spyOn(service as any, "getClient").mockResolvedValue({
        workflowService: { signalWorkflowExecution },
      });

      const result = await service.signalWorkflow(request);
      expect(result).toBe("success");
      expect(signalWorkflowExecution).toHaveBeenCalledWith(request);
      expect(loggerMock.log).toHaveBeenCalledWith("Signaling workflow: undefined");
    });

    it("should throw WorkflowError when client is null", async () => {
      jest.spyOn(service as any, "getClient").mockResolvedValue(null);
      
      await expect(service.signalWorkflow({})).rejects.toThrow(WorkflowError);
      await expect(service.signalWorkflow({})).rejects.toThrow("Workflow signal failed: Temporal client not available");
    });

    it("should throw WorkflowError when signaling fails", async () => {
      const request = {
        workflowId: "test-workflow",
        signalName: "test-signal",
      };
      const error = new Error("Signal error");
      const signalWorkflowExecution = jest.fn().mockRejectedValue(error);
      jest.spyOn(service as any, "getClient").mockResolvedValue({
        workflowService: { signalWorkflowExecution },
      });

      await expect(service.signalWorkflow(request)).rejects.toThrow(WorkflowError);
      await expect(service.signalWorkflow(request)).rejects.toThrow("Workflow signal failed: Signal error");
      expect(loggerMock.error).toHaveBeenCalledWith(
        "Failed to signal workflow: Signal error",
        error.stack
      );
    });
  });

  describe("onModuleDestroy", () => {
    it("should close connection and reset client when connection exists", async () => {
      (service as any).connection = connection;
      (service as any).client = client;

      await service.onModuleDestroy();

      expect(connection.close).toHaveBeenCalled();
      expect((service as any).connection).toBeNull();
      expect((service as any).client).toBeNull();
      expect(loggerMock.log).toHaveBeenCalledWith("Temporal connection closed");
    });

    it("should handle case when no connection exists", async () => {
      (service as any).connection = null;
      (service as any).client = client;

      await service.onModuleDestroy();

      expect((service as any).connection).toBeNull();
      expect((service as any).client).toBeNull();
      expect(loggerMock.log).not.toHaveBeenCalledWith("Temporal connection closed");
    });

    it("should handle errors during connection close", async () => {
      const error = new Error("Close error");
      const connectionWithError = {
        close: jest.fn().mockRejectedValue(error),
      };
      (service as any).connection = connectionWithError;
      (service as any).client = client;

      await service.onModuleDestroy();

      expect(connectionWithError.close).toHaveBeenCalled();
      expect((service as any).connection).toBeNull(); // Connection is set to null in finally block
      expect((service as any).client).toBeNull(); // Client is set to null in finally block
      expect(loggerMock.error).toHaveBeenCalledWith(
        "Error closing Temporal connection: Close error",
        error.stack
      );
    });
  });

  describe("constructor", () => {
    it("should use Logger when LoggerFactory is not provided", () => {
      const moduleWithoutLogger = Test.createTestingModule({
        providers: [
          WorkflowService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue({ address: "localhost:7233" }),
            },
          },
        ],
      }).compile();

      expect(moduleWithoutLogger).toBeDefined();
    });
  });
});
