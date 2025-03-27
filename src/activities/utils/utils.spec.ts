import * as fs from "fs";
import * as path from "path";
import { getChecksum, removePrefix, getFilePermissions, shouldExclude, shouldSkipFile } from "./utils";

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

    it("should return correct permission string for directory", () => {
        const stats = fs.statSync(__dirname);
        expect(getFilePermissions(stats)).toBe("drwxr-xr-x");
    });
});

describe('shouldExclude', () => {
    it('should return false when no exclude patterns are provided', () => {
        const result = shouldExclude('/path/to/file', []);
        expect(result).toBe(false);
    });

    it('should return false when the path does not match any pattern', () => {
        const excludePatterns = ['*.log', 'temp/*'];
        const result = shouldExclude('/path/to/file.txt', excludePatterns);
        expect(result).toBe(false);
    });

    it('should return true when the path matches a pattern', () => {
        const excludePatterns = ['*.log', 'temp/*'];
        const result = shouldExclude('/path/to/file.log', excludePatterns);
        expect(result).toBe(true);
    });

    it('should return false for paths that do not match complex patterns', () => {
        const excludePatterns = ['test/*/dir/*/file*'];
        const result = shouldExclude('/path/to/test/file', excludePatterns);
        expect(result).toBe(false);
    });

    it('should match paths ending with a slash (/) correctly', () => {
        const excludePatterns = ['temp/*'];
        const result = shouldExclude('/path/to/temp/', excludePatterns);
        expect(result).toBe(false);
    });

    it('should match exclude file with name', () => {
        const excludePatterns = ['temp_file.txt'];
        const result = shouldExclude('temp_file.txt', excludePatterns);
        expect(result).toBe(true);
    });

    it('should match exclude file with name without appended / 1', () => {
        const excludePatterns = ['temp_file.txt'];
        const result = shouldExclude('/temp_file.txt', excludePatterns);
        expect(result).toBe(true);
    });

    it('should match exclude file with name without appended / 2', () => {
        const excludePatterns = ['temp_file.txt', '/temp.txt', '.txt'];
        const result = shouldExclude('/temp_file.txt', excludePatterns);
        expect(result).toBe(true);
    });

    it('should match exclude file with fle type 3', () => {
        const excludePatterns = ['/temp.txt', '*.txt'];
        const result = shouldExclude('/temp_file.txt', excludePatterns);
        expect(result).toBe(true);
    });

    it('should match exclude file with name with appended/ in fil name and fullpath', () => {
        const excludePatterns = ['/temp_file.txt'];
        const result = shouldExclude('/temp_file.txt', excludePatterns);
        expect(result).toBe(true);
    });
});

describe('shouldSkipFile', () => {
    let stats: fs.Stats;

    beforeEach(() => {
        stats = {
            mtime: new Date(),
        } as fs.Stats;
    });
    it("should skip file modified within last 5 minutes", () => {
        stats.mtime = new Date(Date.now() - 4 * 60 * 1000); // 4 minutes ago
        expect(shouldSkipFile(stats, "5-M", "MIGRATE")).toBe(true);
    });

    it("should skip file modified within last 2 hours", () => {
        stats.mtime = new Date(Date.now() - 1.5 * 60 * 60 * 1000); // 1.5 hours ago
        expect(shouldSkipFile(stats, "2-H", "MIGRATE")).toBe(true);
    });

    it("should not skip file modified before threshold", () => {
        stats.mtime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
        expect(shouldSkipFile(stats, "5-M", "MIGRATE")).toBe(false);
    });

    it("should return false if skipTime is empty", () => {
        expect(shouldSkipFile(stats, "", "MIGRATE")).toBe(false);
    });

    it("should return false if jobType is not MIGRATE", () => {
        expect(shouldSkipFile(stats, "5-M", "BACKUP")).toBe(false);
    });

    it("should return false for negative or zero skipTime", () => {
        expect(shouldSkipFile(stats, "-5-M", "MIGRATE")).toBe(false);
        expect(shouldSkipFile(stats, "0-M", "MIGRATE")).toBe(false);
    });

    it("should return false for unsupported skipTime type", () => {
        expect(shouldSkipFile(stats, "5-Y", "MIGRATE")).toBe(false);
    });
});