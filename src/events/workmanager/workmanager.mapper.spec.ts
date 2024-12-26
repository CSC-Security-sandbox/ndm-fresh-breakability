import { JobType } from "src/constants/enums";
import { TaskEventPayload } from "./workmanager.types";
import {  buildScanPayload } from "./workmanager.mapper";

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


