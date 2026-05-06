import { JobManagerContext } from "./job-manager-context";
import { GroupReaderType } from "../enums";

// Mocks for dependencies
const mockFileStream = {
    append: jest.fn(),
    appendBulk: jest.fn(),
    groupReadWithoutAck: jest.fn(),
    ackAndPurge: jest.fn(),
    getLength: jest.fn(),
};
const mockErrorStream = {
    append: jest.fn(),
    groupReadWithoutAck: jest.fn(),
    ackAndPurge: jest.fn(),
};
const mockCommandStream = {
    append: jest.fn(),
    appendBulk: jest.fn(),
    groupReadWithoutAck: jest.fn(),
    ackAndPurge: jest.fn(),
    getLength: jest.fn(),
};
const mockTaskStream = {
    append: jest.fn(),
    groupReadWithoutAck: jest.fn(),
    ackAndPurge: jest.fn(),
};
const mockTaskMap = {
    setValue: jest.fn(),
    setValueIfNotExists: jest.fn(),
    getValue: jest.fn(),
    deleteValue: jest.fn(),
};
const mockDirBatchMap = {
    setValue: jest.fn(),
    getValue: jest.fn(),
    deleteValue: jest.fn(),
};
const mockCursorMap = {
    setValue: jest.fn(),
    getValue: jest.fn(),
    deleteValue: jest.fn(),
};
const mockRetryBatches = {
    setValue: jest.fn(),
    getValue: jest.fn(),
    deleteValue: jest.fn(),
};

const jobConfig = { some: "config" } as any;
const jobRunId = "run-123";
const jobRunStatus = "RUNNING";

describe("JobManagerContext", () => {
    let ctx: JobManagerContext;

    beforeEach(() => {
        ctx = new JobManagerContext(jobRunId, jobConfig, jobRunStatus);
        ctx.fileStream = mockFileStream as any;
        ctx.errorStream = mockErrorStream as any;
        ctx.commandStream = mockCommandStream as any;
        ctx.taskStream = mockTaskStream as any;
        ctx.taskMap = mockTaskMap as any;
        ctx.dirBatchMap = mockDirBatchMap as any;
        ctx.cursorMap = mockCursorMap as any;
        ctx.retryBatches = mockRetryBatches as any;

        jest.clearAllMocks();
    });

    it("should initialize properties via constructor", () => {
        expect(ctx.jobRunId).toBe(jobRunId);
        expect(ctx.jobConfig).toBe(jobConfig);
        expect(ctx.jobRunStatus).toBe(jobRunStatus);
    });

    it("should initialize with only jobRunId when optional params are omitted", () => {
        const minimal = new JobManagerContext("minimal-id");
        expect(minimal.jobRunId).toBe("minimal-id");
        expect(minimal.jobConfig).toBeUndefined();
        expect(minimal.jobRunStatus).toBeUndefined();
    });

    it("should get jobRunId, jobRunStatus, jobConfig", () => {
        expect(ctx.getJobRunId()).toBe(jobRunId);
        expect(ctx.getJobRunStatus()).toBe(jobRunStatus);
        expect(ctx.getJobConfig()).toBe(jobConfig);
    });

    describe("File Stream Methods", () => {
        it("publishToFileStream should call append", async () => {
            mockFileStream.append.mockResolvedValue("file-id");
            const file = { name: "f.txt" } as any;
            const res = await ctx.publishToFileStream(file);
            expect(mockFileStream.append).toHaveBeenCalledWith(file);
            expect(res).toBe("file-id");
        });

        it("groupReadFileStream should yield from groupReadWithoutAck", async () => {
            const items = [{ data: { name: "f.txt" }, id: "1" }];
            mockFileStream.groupReadWithoutAck.mockReturnValue((function* () { yield* items; })());
            const result: any[] = [];
            for await (const item of ctx.groupReadFileStream("reader", 2, GroupReaderType.DB_WRITER)) {
                result.push(item);
            }
            expect(result).toEqual(items);
            expect(mockFileStream.groupReadWithoutAck).toHaveBeenCalledWith("reader", 2, GroupReaderType.DB_WRITER);
        });

        it("groupAckFileStream should call ackAndPurge", async () => {
            await ctx.groupAckFileStream(["id1", "id2"], GroupReaderType.DB_WRITER);
            expect(mockFileStream.ackAndPurge).toHaveBeenCalledWith(["id1", "id2"], GroupReaderType.DB_WRITER);
        });
    });

    describe("Error Stream Methods", () => {
        it("publishToErrorStream should call append", async () => {
            mockErrorStream.append.mockResolvedValue("err-id");
            const error = { message: "err" } as any;
            const res = await ctx.publishToErrorStream(error);
            expect(mockErrorStream.append).toHaveBeenCalledWith(error);
            expect(res).toBe("err-id");
        });

        it("groupReadErrorStream should yield from groupReadWithoutAck", async () => {
            const items = [{ data: { message: "err" }, id: "1" }];
            mockErrorStream.groupReadWithoutAck.mockReturnValue((function* () { yield* items; })());
            const result: any[] = [];
            for await (const item of ctx.groupReadErrorStream("reader", 2, GroupReaderType.DB_WRITER)) {
                result.push(item);
            }
            expect(result).toEqual(items);
            expect(mockErrorStream.groupReadWithoutAck).toHaveBeenCalledWith("reader", 2, GroupReaderType.DB_WRITER);
        });

        it("groupAckErrorStream should call ackAndPurge", async () => {
            await ctx.groupAckErrorStream(["id1"], GroupReaderType.DB_WRITER);
            expect(mockErrorStream.ackAndPurge).toHaveBeenCalledWith(["id1"], GroupReaderType.DB_WRITER);
        });
    });

    describe("Command Stream Methods", () => {
        it("publishToCommandStream should call append", async () => {
            mockCommandStream.append.mockResolvedValue("cmd-id");
            const command = { cmd: "do" } as any;
            const res = await ctx.publishToCommandStream(command);
            expect(mockCommandStream.append).toHaveBeenCalledWith(command);
            expect(res).toBe("cmd-id");
        });

        it("groupReadCommandStream should yield from groupReadWithoutAck", async () => {
            const items = [{ data: { cmd: "do" }, id: "1" }];
            mockCommandStream.groupReadWithoutAck.mockReturnValue((function* () { yield* items; })());
            const result: any[] = [];
            for await (const item of ctx.groupReadCommandStream("reader", 2, GroupReaderType.DB_WRITER)) {
                result.push(item);
            }
            expect(result).toEqual(items);
            expect(mockCommandStream.groupReadWithoutAck).toHaveBeenCalledWith("reader", 2, GroupReaderType.DB_WRITER);
        });

        it("groupAckCommandStream should call ackAndPurge", async () => {
            await ctx.groupAckCommandStream(["id1"], GroupReaderType.DB_WRITER);
            expect(mockCommandStream.ackAndPurge).toHaveBeenCalledWith(["id1"], GroupReaderType.DB_WRITER);
        });
    });

    describe("Task Stream Methods", () => {
        it("publishToTaskStream should call append", async () => {
            mockTaskStream.append.mockResolvedValue("task-id");
            const task = { t: 1 } as any;
            const res = await ctx.publishToTaskStream(task);
            expect(mockTaskStream.append).toHaveBeenCalledWith(task);
            expect(res).toBe("task-id");
        });

        it("groupReadTaskStream should yield from groupReadWithoutAck", async () => {
            const items = [{ data: { t: 1 }, id: "1" }];
            mockTaskStream.groupReadWithoutAck.mockReturnValue((function* () { yield* items; })());
            const result: any[] = [];
            for await (const item of ctx.groupReadTaskStream("reader", 2, GroupReaderType.DB_WRITER)) {
                result.push(item);
            }
            expect(result).toEqual(items);
            expect(mockTaskStream.groupReadWithoutAck).toHaveBeenCalledWith("reader", 2, GroupReaderType.DB_WRITER);
        });

        it("groupAckTaskStream should call ackAndPurge", async () => {
            await ctx.groupAckTaskStream(["id1"], GroupReaderType.DB_WRITER);
            expect(mockTaskStream.ackAndPurge).toHaveBeenCalledWith(["id1"], GroupReaderType.DB_WRITER);
        });
    });

    describe("Task Map Methods", () => {
        it("setTask should call setValue", async () => {
            await ctx.setTask("k", { t: 1 } as any);
            expect(mockTaskMap.setValue).toHaveBeenCalledWith("k", { t: 1 });
        });

        it("setTaskIfNotExists should call setValueIfNotExists", async () => {
            mockTaskMap.setValueIfNotExists.mockResolvedValue(true);
            const res = await ctx.setTaskIfNotExists("k", { t: 1 } as any);
            expect(mockTaskMap.setValueIfNotExists).toHaveBeenCalledWith("k", { t: 1 });
            expect(res).toBe(true);
        });

        it("getTask should call getValue", async () => {
            mockTaskMap.getValue.mockResolvedValue({ t: 1 });
            const res = await ctx.getTask("k");
            expect(mockTaskMap.getValue).toHaveBeenCalledWith("k");
            expect(res).toEqual({ t: 1 });
        });

        it("deleteTask should call deleteValue", async () => {
            await ctx.deleteTask("k");
            expect(mockTaskMap.deleteValue).toHaveBeenCalledWith("k");
        });
    });

    describe("serialize/deserialize", () => {
        it("serialize should return JSON string", () => {
            const json = ctx.serialize();
            expect(JSON.parse(json)).toEqual({
                jobRunId,
                jobConfig,
                jobRunStatus,
            });
        });

        it("deserialize should parse JSON string", () => {
            const obj = { a: 1, b: 2 };
            expect(ctx.deserialize(JSON.stringify(obj))).toEqual(obj);
        });
    });

    describe("Dir Batch Map Methods", () => {
        it("setBatchDir should call setValue", async () => {
            await ctx.setBatchDir("batch-1", ["/dir1", "/dir2"]);
            expect(mockDirBatchMap.setValue).toHaveBeenCalledWith("batch-1", ["/dir1", "/dir2"]);
        });

        it("getBatchDir should call getValue", async () => {
            mockDirBatchMap.getValue.mockResolvedValue(["/dir1", "/dir2"]);
            const res = await ctx.getBatchDir("batch-1");
            expect(mockDirBatchMap.getValue).toHaveBeenCalledWith("batch-1");
            expect(res).toEqual(["/dir1", "/dir2"]);
        });

        it("deleteBatchDir should call deleteValue", async () => {
            await ctx.deleteBatchDir("batch-1");
            expect(mockDirBatchMap.deleteValue).toHaveBeenCalledWith("batch-1");
        });
    });

    describe("Retry Batch Methods", () => {
        it("setRetryBatch should call setValue", async () => {
            const batch = {
                parentPath: "/data/folder",
                operations: [{ id: "op-1", fPath: "/data/folder/file.txt" }]
            };
            await ctx.setRetryBatch("retry-batch-1", batch);
            expect(mockRetryBatches.setValue).toHaveBeenCalledWith("retry-batch-1", batch);
        });

        it("getRetryBatch should call getValue", async () => {
            const batch = {
                parentPath: "/test/path",
                operations: [{ id: "op-2", fPath: "/test/path/f.txt" }]
            };
            mockRetryBatches.getValue.mockResolvedValue(batch);
            const res = await ctx.getRetryBatch("retry-batch-2");
            expect(mockRetryBatches.getValue).toHaveBeenCalledWith("retry-batch-2");
            expect(res).toEqual(batch);
        });

        it("getRetryBatch should return null when batch not found", async () => {
            mockRetryBatches.getValue.mockResolvedValue(null);
            const res = await ctx.getRetryBatch("non-existent");
            expect(res).toBeNull();
        });

        it("deleteRetryBatch should call deleteValue", async () => {
            await ctx.deleteRetryBatch("retry-batch-3");
            expect(mockRetryBatches.deleteValue).toHaveBeenCalledWith("retry-batch-3");
        });
    });

    describe("Retry Cursor Methods", () => {
        it("getRetryCursor should return cursor value", async () => {
            mockCursorMap.getValue.mockResolvedValue("cursor-abc123");
            const res = await ctx.getRetryCursor();
            expect(mockCursorMap.getValue).toHaveBeenCalledWith("retryCursor");
            expect(res).toBe("cursor-abc123");
        });

        it("getRetryCursor should return empty string when no cursor exists", async () => {
            mockCursorMap.getValue.mockResolvedValue(null);
            const res = await ctx.getRetryCursor();
            expect(res).toBe("");
        });

        it("getRetryCursor should return empty string when cursor is undefined", async () => {
            mockCursorMap.getValue.mockResolvedValue(undefined);
            const res = await ctx.getRetryCursor();
            expect(res).toBe("");
        });

        it("setRetryCursor should call setValue with retryCursor key", async () => {
            await ctx.setRetryCursor("next-page-cursor");
            expect(mockCursorMap.setValue).toHaveBeenCalledWith("retryCursor", "next-page-cursor");
        });
    });

    describe("Error Stream with originalJobRunId", () => {
        it("publishToErrorStream should add originalJobRunId to operation error", async () => {
            mockErrorStream.append.mockResolvedValue("err-id");
            const error = {
                message: "File not found",
                operation: { id: "op-1", name: "file.txt" }
            } as any;
            
            await ctx.publishToErrorStream(error, "original-job-run-123");
            
            expect(error.operation.originalJobRunId).toBe("original-job-run-123");
            expect(mockErrorStream.append).toHaveBeenCalledWith(error);
        });

        it("publishToErrorStream should not modify error without operation", async () => {
            mockErrorStream.append.mockResolvedValue("err-id");
            const error = { message: "General error" } as any;
            
            await ctx.publishToErrorStream(error, "original-job-run-456");
            
            expect(error.originalJobRunId).toBeUndefined();
            expect(mockErrorStream.append).toHaveBeenCalledWith(error);
        });

        it("publishToErrorStream should work without originalJobRunId", async () => {
            mockErrorStream.append.mockResolvedValue("err-id");
            const error = {
                message: "Error",
                operation: { id: "op-1" }
            } as any;
            
            await ctx.publishToErrorStream(error);
            
            expect(error.operation.originalJobRunId).toBeUndefined();
            expect(mockErrorStream.append).toHaveBeenCalledWith(error);
        });
    });

    describe("Bulk File Stream Methods", () => {
        it("publishToFileStreamBulk should call appendBulk", async () => {
            mockFileStream.appendBulk.mockResolvedValue(["id-1", "id-2"]);
            const files = [{ name: "a.txt" }, { name: "b.txt" }] as any[];
            const res = await ctx.publishToFileStreamBulk(files);
            expect(mockFileStream.appendBulk).toHaveBeenCalledWith(files);
            expect(res).toEqual(["id-1", "id-2"]);
        });

        it("publishToFileStreamBulk should return empty array for empty input", async () => {
            mockFileStream.appendBulk.mockResolvedValue([]);
            const res = await ctx.publishToFileStreamBulk([]);
            expect(mockFileStream.appendBulk).toHaveBeenCalledWith([]);
            expect(res).toEqual([]);
        });

        it("getFileStreamLen should return stream length", async () => {
            mockFileStream.getLength.mockResolvedValue(99);
            const res = await ctx.getFileStreamLen();
            expect(mockFileStream.getLength).toHaveBeenCalled();
            expect(res).toBe(99);
        });

        it("getFileStreamLen should return 0 for empty stream", async () => {
            mockFileStream.getLength.mockResolvedValue(0);
            const res = await ctx.getFileStreamLen();
            expect(res).toBe(0);
        });
    });

    describe("Bulk Command Stream Methods", () => {
        it("publishBulkToCommandStream should call appendBulk", async () => {
            mockCommandStream.appendBulk.mockResolvedValue(["cmd-1", "cmd-2"]);
            const commands = [{ cmd: "a" }, { cmd: "b" }] as any[];
            const res = await ctx.publishBulkToCommandStream(commands);
            expect(mockCommandStream.appendBulk).toHaveBeenCalledWith(commands);
            expect(res).toEqual(["cmd-1", "cmd-2"]);
        });

        it("getCmdStreamLen should return stream length", async () => {
            mockCommandStream.getLength.mockResolvedValue(42);
            const res = await ctx.getCmdStreamLen();
            expect(mockCommandStream.getLength).toHaveBeenCalled();
            expect(res).toBe(42);
        });

        it("getCmdStreamLen should return 0 for empty stream", async () => {
            mockCommandStream.getLength.mockResolvedValue(0);
            const res = await ctx.getCmdStreamLen();
            expect(res).toBe(0);
        });
    });

    describe("Directory Content Set stub methods", () => {
        it("addToDirContentSet should throw on base class", async () => {
            await expect(ctx.addToDirContentSet("key", ["a", "b"])).rejects.toThrow(
                "DirContentSet operations are not supported on base JobManagerContext"
            );
        });

        it("areDirContentMembers should return all false", async () => {
            const res = await ctx.areDirContentMembers("key", ["a", "b", "c"]);
            expect(res).toEqual([false, false, false]);
        });

        it("areDirContentMembers should return empty array for empty input", async () => {
            const res = await ctx.areDirContentMembers("key", []);
            expect(res).toEqual([]);
        });

        it("scanDirContentSet should return empty result", async () => {
            const res = await ctx.scanDirContentSet("key", 0, 100);
            expect(res).toEqual({ cursor: 0, members: [] });
        });

        it("deleteDirContentSet should be a no-op", async () => {
            await expect(ctx.deleteDirContentSet("key")).resolves.toBeUndefined();
        });
    });

    describe("initializeInstance and cleanup stubs", () => {
        it("initializeInstance should be a no-op", async () => {
            await expect(ctx.initializeInstance()).resolves.toBeUndefined();
        });

        it("cleanup should be a no-op", async () => {
            await expect(ctx.cleanup()).resolves.toBeUndefined();
        });
    });
});
