import { RedisCommandCollection, RedisErrorCollection, RedisItemInfoCollection, RedisTaskInfoCollection } from "../../redis/redis-collections";
import { RedisHMapCollection } from "../../redis/redis-hmap-collection";
import { DEFAULT_DIR_CONTENT_TTL_SECONDS } from "../options";
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
    sAdd: jest.fn(),
    expire: jest.fn(),
    smIsMember: jest.fn(),
    sScan: jest.fn(),
};

const mockJobConfig = { foo: "bar" };
const mockJobRunId = "job-123";
const mockJobRunStatus = "RUNNING";

describe("RedisJobManagerContext", () => {
    let context: RedisJobManagerContext;

    beforeEach(() => {
        jest.clearAllMocks();
        (RedisItemInfoCollection as jest.Mock).mockImplementation(() => ({
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
        (RedisTaskInfoCollection as jest.Mock).mockImplementation(() => ({
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
        // Parent constructor is mocked, so set properties explicitly
        context.jobRunId = mockJobRunId;
        context.jobConfig = mockJobConfig as any;
        context.jobRunStatus = mockJobRunStatus;
        context.serialize = jest.fn(() => "serialized");
        context.deserialize = jest.fn(() => ({
            jobConfig: { foo: "baz" },
            jobRunStatus: "COMPLETED",
            jobRunId: "job-456",
        }));
    });

    describe("constructor", () => {
        it("should store the redis client", () => {
            expect(context.redisClient).toBe(mockRedisClient);
        });

        it("should create 4 stream collections", () => {
            expect(RedisItemInfoCollection).toHaveBeenCalledTimes(1);
            expect(RedisErrorCollection).toHaveBeenCalledTimes(1);
            expect(RedisCommandCollection).toHaveBeenCalledTimes(1);
            expect(RedisTaskInfoCollection).toHaveBeenCalledTimes(1);
        });

        it("should create 4 hash map collections with correct map types", () => {
            const mapCalls = (RedisHMapCollection as jest.Mock).mock.calls;
            const mapTypes = mapCalls.map(call => call[1]);
            expect(mapTypes).toContain('taskMap');
            expect(mapTypes).toContain('dirBatchMap');
            expect(mapTypes).toContain('cursorMap');
            expect(mapTypes).toContain('retryBatches');
            expect(RedisHMapCollection).toHaveBeenCalledTimes(4);
        });
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
            expect(mockRedisClient.set).toHaveBeenCalledWith(mockJobRunId, "serialized");
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

    describe("addToDirContentSet", () => {
        it("should use DEFAULT_DIR_CONTENT_TTL_SECONDS when jobConfig is undefined", async () => {
            context.jobConfig = undefined;
            await context.addToDirContentSet("dir1", ["file1", "file2"]);
            expect(mockRedisClient.sAdd).toHaveBeenCalledWith("job-123:dirContent:dir1", ["file1", "file2"]);
            expect(mockRedisClient.expire).toHaveBeenCalledWith("job-123:dirContent:dir1", DEFAULT_DIR_CONTENT_TTL_SECONDS);
        });

        it("should use DEFAULT_DIR_CONTENT_TTL_SECONDS when options has no dirContentTtlSeconds", async () => {
            context.jobConfig = { options: {} } as any;
            await context.addToDirContentSet("dir1", ["file1"]);
            expect(mockRedisClient.expire).toHaveBeenCalledWith("job-123:dirContent:dir1", DEFAULT_DIR_CONTENT_TTL_SECONDS);
        });

        it("should use custom TTL from jobConfig.options.dirContentTtlSeconds", async () => {
            context.jobConfig = { options: { dirContentTtlSeconds: 3600 } } as any;
            await context.addToDirContentSet("dir1", ["file1"]);
            expect(mockRedisClient.expire).toHaveBeenCalledWith("job-123:dirContent:dir1", 3600);
        });

        it("should skip sAdd for empty members array", async () => {
            await context.addToDirContentSet("dir1", []);
            expect(mockRedisClient.sAdd).not.toHaveBeenCalled();
            expect(mockRedisClient.expire).not.toHaveBeenCalled();
        });
    });

    describe("areDirContentMembers", () => {
        it("should call smIsMember and return results", async () => {
            mockRedisClient.smIsMember.mockResolvedValueOnce([true, false, true]);
            const res = await context.areDirContentMembers("dir1", ["a", "b", "c"]);
            expect(mockRedisClient.smIsMember).toHaveBeenCalledWith("job-123:dirContent:dir1", ["a", "b", "c"]);
            expect(res).toEqual([true, false, true]);
        });

        it("should return empty array for empty members", async () => {
            const res = await context.areDirContentMembers("dir1", []);
            expect(mockRedisClient.smIsMember).not.toHaveBeenCalled();
            expect(res).toEqual([]);
        });
    });

    describe("scanDirContentSet", () => {
        it("should call sScan with correct params and return result", async () => {
            mockRedisClient.sScan.mockResolvedValueOnce({ cursor: 5, members: ["f1", "f2"] });
            const res = await context.scanDirContentSet("dir1", 0, 100);
            expect(mockRedisClient.sScan).toHaveBeenCalledWith("job-123:dirContent:dir1", 0, { COUNT: 100 });
            expect(res).toEqual({ cursor: 5, members: ["f1", "f2"] });
        });

        it("should return cursor 0 and empty members when scan is complete", async () => {
            mockRedisClient.sScan.mockResolvedValueOnce({ cursor: 0, members: [] });
            const res = await context.scanDirContentSet("dir1", 3, 50);
            expect(res).toEqual({ cursor: 0, members: [] });
        });
    });

    describe("deleteDirContentSet", () => {
        it("should call del with correct key", async () => {
            await context.deleteDirContentSet("dir1");
            expect(mockRedisClient.del).toHaveBeenCalledWith("job-123:dirContent:dir1");
        });
    });
});