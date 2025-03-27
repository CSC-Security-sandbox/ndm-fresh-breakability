import { WorkerConfiguration } from "../work-manager.types";
import { WorkFlowOptions } from "./worker-options.factory";

describe("WorkFlowOptions", () => {
  let config: WorkerConfiguration;

  beforeEach(() => {
    config = {
      dynamicTaskQueue: false,
      taskQueueId: "test-task-queue-id",
      workerId: "test-worker-id",
      configName: "test-config-name",
    };
  });

  it("should create a new instance with default values", () => {
    const options = new WorkFlowOptions(
      "test-identity",
      "test-worker-id",
      {} as any, // Use a mock connection
      "test-task-queue",
      config
    );

    expect(options.identity).toBe("test-identity");
    expect(options.workerId).toBe("test-worker-id");
    expect(options.connection).not.toBeUndefined();
    expect(options.taskQueue).toBe("test-task-queue");
    expect(options.activities).toBeUndefined();
    expect(options.workflowsPath).not.toBeUndefined();
  });

  it("should create a new instance with dynamic task queue", () => {
    config.dynamicTaskQueue = true;
    const options = new WorkFlowOptions(
      "test-identity",
      "test-worker-id",
      {} as any, // Use a mock connection
      "test-task-queue",
      config
    );

    expect(options.taskQueue).toBe(`${config.taskQueueId}-test-task-queue`);
  });

  it("should create a new instance with activities", () => {
    const activities = { testActivity: jest.fn() };
    const options = new WorkFlowOptions(
      "test-identity",
      "test-worker-id",
      {} as any, // Use a mock connection
      "test-task-queue",
      config,
      activities
    );

    expect(options.activities).toBe(activities);
  });

  it("should throw an error if config is missing", () => {
    expect(() => new WorkFlowOptions("test-identity", "test-worker-id", {} as any, "test-task-queue", null)).toThrowError(
      "Cannot read properties of null (reading 'dynamicTaskQueue')"
    );
  });
});
