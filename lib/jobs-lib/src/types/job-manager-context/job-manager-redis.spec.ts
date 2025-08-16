import { RedisCommandCollection, RedisErrorCollection, RedisFileCollection, RedisTaskCollection } from "../../redis/redis-collections";
import { RedisHMapCollection } from "../../redis/redis-hmap-collection";
import { RedisJobManagerContext } from "./job-manager-redis";

jest.mock("../../redis/redis-collections");
jest.mock("../../redis/redis-hmap-collection");
jest.mock("./job-manager-context");

const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    exists: jest.fn(),
    keys: jest.fn(),
    del: jest.fn(),
};

const mockJobConfig = { foo: "bar" };
const mockJobRunId = "job-123";
const mockJobRunStatus = "RUNNING";

describe("RedisJobManagerContext", () => {
    let context: RedisJobManagerContext;

    beforeEach(() => {
        jest.clearAllMocks();
        (RedisFileCollection as jest.Mock).mockImplementation(() => ({
            init: jest.fn(),
            cleanup: jest.fn(),
        }));
        (RedisErrorCollection as jest.Mock).mockImplementation(() => ({
            init: jest.fn(),
            cleanup: jest.fn(),
        }));
        (RedisCommandCollection as jest.Mock).mockImplementation(() => ({
            init: jest.fn(),
            cleanup: jest.fn(),
        }));
        (RedisTaskCollection as jest.Mock).mockImplementation(() => ({
            init: jest.fn(),
            cleanup: jest.fn(),
        }));
        (RedisHMapCollection as jest.Mock).mockImplementation(() => ({}));

        context = new RedisJobManagerContext(
            mockRedisClient as any,
            mockJobRunId,
            mockJobConfig as any,
            mockJobRunStatus
        );
        // Mock serialize/deserialize
        context.serialize = jest.fn(() => "serialized");
        context.deserialize = jest.fn(() => ({
            jobConfig: { foo: "baz" },
            jobRunStatus: "COMPLETED",
            jobRunId: "job-456",
        }));
    });

    describe("initializeInstance", () => {
        it("should do nothing if jobDetail is falsy", async () => {
            mockRedisClient.get.mockResolvedValueOnce(null);
            await context.initializeInstance();
            expect(context.deserialize).not.toHaveBeenCalled();
        });

        it("should set jobConfig, jobRunStatus, jobRunId from deserialized data", async () => {
            mockRedisClient.get.mockResolvedValueOnce("serialized");
            await context.initializeInstance();
            expect(context.deserialize).toHaveBeenCalledWith("serialized");
            expect(context.jobConfig).toEqual({ foo: "baz" });
            expect(context.jobRunStatus).toBe("COMPLETED");
            expect(context.jobRunId).toBe("job-456");
        });
    });

    describe("init", () => {
        it("should call init on all collections and set redis key", async () => {
            await context.init();
            expect(context.fileStream.init).toHaveBeenCalled();
            expect(context.errorStream.init).toHaveBeenCalled();
            expect(context.commandStream.init).toHaveBeenCalled();
            expect(context.taskStream.init).toHaveBeenCalled();
        });
    });

    describe("cleanup", () => {
        it("should call cleanup on all collections and delete redis keys if exist", async () => {
            mockRedisClient.exists.mockResolvedValueOnce(1);
            mockRedisClient.keys.mockResolvedValueOnce(["job-123", "job-123-task"]);
            await context.cleanup();
            expect(context.fileStream.cleanup).toHaveBeenCalled();
            expect(context.errorStream.cleanup).toHaveBeenCalled();
            expect(context.commandStream.cleanup).toHaveBeenCalled();
            expect(context.taskStream.cleanup).toHaveBeenCalled();
            expect(mockRedisClient.del).toHaveBeenCalledWith("job-123");
            expect(mockRedisClient.del).toHaveBeenCalledWith("job-123-task");
        });

        it("should not delete keys if jobRunId does not exist", async () => {
            mockRedisClient.exists.mockResolvedValueOnce(0);
            await context.cleanup();
            expect(mockRedisClient.keys).not.toHaveBeenCalled();
            expect(mockRedisClient.del).not.toHaveBeenCalled();
        });
    });
});