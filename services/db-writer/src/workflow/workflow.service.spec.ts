import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { WorkflowService } from "./workflow.service";
import { Client, Connection } from "@temporalio/client";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";

describe("WorkflowService", () => {
  let service: WorkflowService;
  let configService: ConfigService;
  let client: Client;
  let connection: Connection;

  beforeEach(async () => {
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

    service = module.get<WorkflowService>(WorkflowService);
    configService = module.get<ConfigService>(ConfigService);
    client = new Client({ connection: {} as Connection });
    connection = {} as Connection;
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

    it('should throw an error if client is not found', async () => {
      jest.spyOn(service as any, 'getClient').mockResolvedValue(null); // Force getClient() to return null
      await expect(service.signalWorkflow({})).rejects.toThrow('Workflow signal failed: Temporal client not available');
  });
  });

  describe("signalWorkflow", () => {
    it("should signal workflow execution", async () => {
      const request = {
        workflowId: "test-workflow",
        signalName: "test-signal",
      };
      const signalWorkflowExecution = jest.fn().mockResolvedValue("success");
      jest.spyOn(service as any, "getClient").mockResolvedValue({
        workflowService: { signalWorkflowExecution },
      });

      const result = await service.signalWorkflow(request);
      expect(result).toBe("success");
      expect(signalWorkflowExecution).toHaveBeenCalledWith(request);
    });

    it("should throw an error if signaling fails", async () => {
      const request = {
        workflowId: "test-workflow",
        signalName: "test-signal",
      };
      const signalWorkflowExecution = jest
        .fn()
        .mockRejectedValue(new Error("Signal error"));
      jest.spyOn(service as any, "getClient").mockResolvedValue({
        workflowService: { signalWorkflowExecution },
      });

      await expect(service.signalWorkflow(request)).rejects.toThrow(
        "Signal error"
      );
    });
  });
});
