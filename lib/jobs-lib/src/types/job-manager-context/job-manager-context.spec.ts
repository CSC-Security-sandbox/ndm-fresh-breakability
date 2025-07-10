import { JobManagerContext } from "./job-manager-context";
import { GroupReaderType } from "../enums";

// Mocks for dependencies
const mockFileStream = {
    append: jest.fn(),
    groupReadWithoutAck: jest.fn(),
    ackAndPurge: jest.fn(),
};
const mockErrorStream = {
    append: jest.fn(),
    groupReadWithoutAck: jest.fn(),
    ackAndPurge: jest.fn(),
};
const mockCommandStream = {
    append: jest.fn(),
    groupReadWithoutAck: jest.fn(),
    ackAndPurge: jest.fn(),
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

        jest.clearAllMocks();
    });

    it("should initialize properties via constructor", () => {
        expect(ctx.jobRunId).toBe(jobRunId);
        expect(ctx.jobConfig).toBe(jobConfig);
        expect(ctx.jobRunStatus).toBe(jobRunStatus);
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
});