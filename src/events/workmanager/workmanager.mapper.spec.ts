import { JobType } from "src/constants/enums";
import { TaskEventPayload } from "./workmanager.types";
import { buildRequest, buildScanPayload } from "./workmanager.mapper";

describe("buildScanPayload", () => {
    it("should build the correct scan payload for a given path", () => {
        const path = "/some/path";
        const expectedPayload = {
            fPath: path,
            ops: {
                0: {
                    cmd: "SCAN_PATH",
                },
            },
        };

        const result = buildScanPayload(path);

        expect(result).toEqual(expectedPayload);
    });

    it("should handle empty paths correctly", () => {
        const path = "";
        const expectedPayload = {
            fPath: path,
            ops: {
                0: {
                    cmd: "SCAN_PATH",
                },
            },
        };

        const result = buildScanPayload(path);

        expect(result).toEqual(expectedPayload);
    });

    it("should handle undefined paths without throwing errors", () => {
        const path = undefined;
        const expectedPayload = {
            fPath: undefined,
            ops: {
                0: {
                    cmd: "SCAN_PATH",
                },
            },
        };

        const result = buildScanPayload(path);

        expect(result).toEqual(expectedPayload);
    });
});

describe("buildRequest", () => {
    it("should build a scan payload when taskType is Scan", () => {
        const payload: TaskEventPayload = {
            taskType: JobType.DISCOVER,
            sPath: "/test/path",
            jobRunId:"asd",
            status: "Ads",
            tPath: "123",
            workers: [],
            sPathId: '3456789',
            workingDirectory: '345689'
        };

        const expectedPayload = {
            fPath: payload.sPath,
            ops: {
                0: {
                    cmd: "SCAN_PATH",
                },
            },
        };

        const result = buildRequest(payload);

        expect(result).toEqual(expectedPayload);
    });

    it("should return undefined for unsupported task types", () => {
        const payload: TaskEventPayload = {
            taskType: "UNSUPPORTED_TYPE" as JobType,
            sPath: "/test/path",
            jobRunId:"asd",
            status: "Ads",
            tPath: "123",
            workers: [],
            sPathId: '3456789',
            workingDirectory: '345689'
        };

        const result = buildRequest(payload);

        expect(result).toBeUndefined();
    });

    it("should handle undefined sPath gracefully", () => {
        const payload: TaskEventPayload = {
            taskType: JobType.DISCOVER,
            sPath: undefined,
            jobRunId:"asd",
            status: "Ads",
            tPath: "123",
            workers: [],
            sPathId: '3456789',
            workingDirectory: '345689'
        };

        const expectedPayload = {
            fPath: undefined,
            ops: {
                0: {
                    cmd: "SCAN_PATH",
                },
            },
        };

        const result = buildRequest(payload);

        expect(result).toEqual(expectedPayload);
    });

    it("should handle empty sPath gracefully", () => {
        const payload: TaskEventPayload = {
            taskType: JobType.DISCOVER,
            sPath: "",
            jobRunId:"asd",
            status: "Ads",
            tPath: "123",
            workers: [],
            sPathId: '3456789',
            workingDirectory: '345689'
        };

        const expectedPayload = {
            fPath: "",
            ops: {
                0: {
                    cmd: "SCAN_PATH",
                },
            },
        };

        const result = buildRequest(payload);

        expect(result).toEqual(expectedPayload);
    });
});
