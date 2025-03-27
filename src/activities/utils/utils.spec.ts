import * as fs from "fs";
import * as path from "path";
import { getChecksum, removePrefix, getFilePermissions } from "./utils";

// Mocked file for checksum test
const TEST_FILE_PATH = path.join(__dirname, "testFile.txt");
const FILE_CONTENT = "Hello, World!";

describe("getChecksum", () => {
    beforeAll(() => {
        fs.writeFileSync(TEST_FILE_PATH, FILE_CONTENT);
    });

    afterAll(() => {
        fs.unlinkSync(TEST_FILE_PATH);
    });

    it("should return correct SHA-256 checksum", async () => {
        const expectedHash = "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f";
        const checksum = await getChecksum(TEST_FILE_PATH);
        expect(checksum).toBe(expectedHash);
    });
});

describe("removePrefix", () => {
    it("should remove the prefix if present", () => {
        expect(removePrefix("prefix_testString", "prefix_"))
            .toBe("testString");
    });

    it("should return the original string if the prefix is not present", () => {
        expect(removePrefix("testString", "prefix_"))
            .toBe("testString");
    });
});

describe("getFilePermissions", () => {
    beforeAll(() => {
        fs.writeFileSync(TEST_FILE_PATH, FILE_CONTENT, { mode: 0o764 });
    });
    afterAll(() => {
        fs.unlinkSync(TEST_FILE_PATH);
    });

    it("should return correct permission string", () => {
        const stats = fs.statSync(TEST_FILE_PATH);
        expect(getFilePermissions(stats)).toBe("-rwxr--r--");
    });
});
