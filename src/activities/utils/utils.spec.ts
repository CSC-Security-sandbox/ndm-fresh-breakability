import * as fs from "fs";
import * as path from "path";
import { getChecksum, removePrefix, getFilePermissions, shouldExclude, shouldSkipFile, shouldExcludeOlderThan, shouldExcludeOrSkip, getJobConnection, getFileType, getFileInfo, buildTask, getErrorCode, formatDate } from "./utils";
import { FileType } from "../types/tasks";
import { Task } from "@netapp-cloud-datamigrate/jobs-lib";

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

    it("should return false for invalid skipTime", () => {
        expect(shouldSkipFile(stats, "5M", "MIGRATE")).toBe(false);
    })

    it("should return true if has char at 0th index", () => {
        expect(shouldSkipFile(stats, "5X-M", "MIGRATE")).toBe(true);
    })

    it("should skip file modified within last 5 days", () => {
        stats.mtime = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000); // 4 days ago
        expect(shouldSkipFile(stats, "5-D", "MIGRATE")).toBe(true);
    });

    it("should skip file modified within last 2 days", () => {
        stats.mtime = new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000); // 1.5 days ago
        expect(shouldSkipFile(stats, "2-D", "MIGRATE")).toBe(true);
    });
});

describe('shouldExcludeOlderThan', () => {
    let stats: fs.Stats;

    beforeEach(() => {
        stats = {
            mtime: new Date(),
        } as fs.Stats;
    });

    it("should return false if olderThan is not provided", () => {
        expect(shouldExcludeOlderThan(stats, null)).toBe(false);
    });

    it("should return false if olderThan is null", () => {
        expect(shouldExcludeOlderThan(stats, null)).toBe(false);
    });

    it("should return false if olderThan is undefined", () => {
        expect(shouldExcludeOlderThan(stats, undefined)).toBe(false);
    });

    it("should return false if olderThan is equal to mtime", () => {
        const olderThan = new Date(stats.mtime);
        expect(shouldExcludeOlderThan(stats, olderThan)).toBe(false);
    });

    it("should return false if olderThan is after mtime", () => {
        const olderThan = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
        expect(shouldExcludeOlderThan(stats, olderThan)).toBe(false);
    });

    it("should return true if olderThan is before mtime", () => {
        const olderThan = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes ago
        expect(shouldExcludeOlderThan(stats, olderThan)).toBe(true);
    });
});

describe('shouldExcludeOrSkip', () => {
    let stats: fs.Stats;
    let excludePatterns: string[];
    let skipTime: string;
    let olderThan: Date;
    let jobType: string;
    let fullPath: string;

    beforeEach(() => {
        stats = {
            mtime: new Date(),
        } as fs.Stats;
        excludePatterns = ['*.log', 'temp/*'];
        skipTime = "5-M";
        olderThan = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
        jobType = "MIGRATE";
        fullPath = '/path/to/file.txt';
    });

    it("should return true if excludePatterns condition is met", () => {
        expect(shouldExcludeOrSkip({ fullPath: '/path/to/file.log', stats, excludePatterns, skipTime, olderThan, jobType })).toBe(true);
    });

    it("should return true if skipTime condition is met", () => {
        stats.mtime = new Date(Date.now() - 4 * 60 * 1000); // 4 minutes ago
        expect(shouldExcludeOrSkip({ fullPath, stats, excludePatterns, skipTime, olderThan, jobType })).toBe(true);
    });

    it("should return true if olderThan condition is met", () => {
        expect(shouldExcludeOrSkip({ fullPath, stats, excludePatterns, skipTime, olderThan: new Date(Date.now() + 5 * 60 * 1000), jobType })).toBe(true);
    });

    it("should return true if all conditions are met", () => {
        stats.mtime = new Date(Date.now() - 4 * 60 * 1000); // 4 minutes ago
        expect(shouldExcludeOrSkip({ fullPath: '/path/to/file.log', stats, excludePatterns, skipTime, olderThan, jobType })).toBe(true);
    });

    it("should return true if all conditions are met", () => {
        stats.mtime = new Date(Date.now() - 4 * 60 * 1000); // 4 minutes ago
        expect(shouldExcludeOrSkip({ fullPath: '/path/to/file.log', stats, excludePatterns, skipTime, olderThan, jobType })).toBe(true);
    });

    it("should return true if all conditions are met", () => {
        stats.mtime = new Date(Date.now() - 4 * 60 * 1000); // 4 minutes ago
        expect(shouldExcludeOrSkip({ fullPath: '/path/to/file.log', stats, excludePatterns, skipTime, olderThan, jobType })).toBe(true);
    });

});

describe('getFileType', () => {
    let stats: fs.Stats;

    beforeEach(() => {
        stats = {
            mtime: new Date(),
            isFile: () => false,
            isDirectory: () => false,
            isSymbolicLink: () => false,
            isSocket: () => false,
            isFIFO: () => false,
            isCharacterDevice: () => false,
            isBlockDevice: () => false
        } as fs.Stats;
    });

    it('should return file type', () => {
        stats.isFile = () => true;
        const fileType = getFileType(stats);
        expect(fileType).toBe(FileType.FILE);
    });

    it('should return directory type', () => {
        stats.isDirectory = () => true;
        const fileType = getFileType(stats);
        expect(fileType).toBe(FileType.DIRECTORY);
    });

    // SYMBOLIC_LINK
    it('should return symbolic link type', () => {
        stats.isSymbolicLink = () => true;
        const fileType = getFileType(stats);
        expect(fileType).toBe(FileType.SYMBOLIC_LINK);
    });

    // SOCKET
    it('should return socket type', () => {
        stats.isSocket = () => true;
        const fileType = getFileType(stats);
        expect(fileType).toBe(FileType.SOCKET);
    });
    // FIFO
    it('should return fifo type', () => {
        stats.isFIFO = () => true;
        const fileType = getFileType(stats);
        expect(fileType).toBe(FileType.FIFO);
    });

    // CHARACTER_DEVICE
    it('should return character device type', () => {
        stats.isCharacterDevice = () => true;
        const fileType = getFileType(stats);
        expect(fileType).toBe(FileType.CHARACTER_DEVICE);
    });

    // BLOCK_DEVICE
    it('should return block device type', () => {
        stats.isBlockDevice = () => true;
        const fileType = getFileType(stats);
        expect(fileType).toBe(FileType.BLOCK_DEVICE);
    });

    // UNKNOWN
    it('should return unknown type', () => {
        const fileType = getFileType(stats);
        expect(fileType).toBe(FileType.UNKNOWN);
    });
});

describe('getFileInfo', () => {
    it("should return file info for a regular file", async () => {
        jest.spyOn(fs.promises, "lstat").mockResolvedValue({
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
            isSocket: () => false,
            isFIFO: () => false,
            isCharacterDevice: () => false,
            isBlockDevice: () => false,
            dev: 0,
            ino: 0,
            mode: 0o764,
            nlink: 0,
            uid: 0,
            gid: 0,
            rdev: 0,
            size: 1024,
            blksize: 0,
            blocks: 0,
            atime: new Date(),
            mtime: new Date(),
            ctime: new Date(),
            birthtime: new Date(),
        } as fs.Stats);

        const result = await getFileInfo({
            name: "file.txt",
            fullFilePath: "/mock/path/file.txt",
            relativePath: "mock/path/file.txt",
            checksums: { sourceChecksum: 'abc123', targetChecksum: 'abc123' },
            getID: false,
        });

        expect(result.fileName).toBe("file.txt");
        expect(result.isDirectory).toBe(false);
        expect(result.fileSize).toBe(1024);
        expect(result.path).toBe("mock/path/file.txt");
        expect(result.extension).toBe(".txt");
        expect(result.permission).toBe("-rwxrw-r--");
        expect(result.fileType).toBe("FILE");
        expect(result.depth).toBe(1);
        expect(result.uid).toBe(0);
        expect(result.gid).toBe(0);
        expect(result.sid).toBe(undefined);
        expect(result.birthTime).toBeInstanceOf(Date);
        expect(result.modifiedTime).toBeInstanceOf(Date);
        expect(result.accessTime).toBeInstanceOf(Date);
    });

    it("should return file info for a directory", async () => {
        jest.spyOn(fs.promises, "lstat").mockResolvedValue({
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
            isSocket: () => false,
            isFIFO: () => false,
            isCharacterDevice: () => false,
            isBlockDevice: () => false,
            ino: 0,
            mode: 0o764,
            nlink: 0,
            uid: 0,
            gid: 0,
            rdev: 0,
            size: 1024,
            blksize: 0,
            blocks: 0,
            atime: new Date(),
            mtime: new Date(),
            ctime: new Date(),
            birthtime: new Date(),
        } as fs.Stats);

        const result = await getFileInfo({
            name: "dir_1",
            fullFilePath: "/mock/path/dir_1",
            relativePath: "mock/path/dir_1",
            checksums: { sourceChecksum: 'abc123', targetChecksum: 'abc123' },
            getID: false,
        });

        expect(result.fileName).toBe("dir_1");
        expect(result.isDirectory).toBe(true);
    });
});

describe("getErrorCode", () => {
    const testCases = [
        { error: { code: "ENOENT" }, context: "TASK", expected: "TASK_FILE_NOT_FOUND" },
        { error: { code: "ENOENT" }, context: "OPERATION", expected: "OP_FILE_NOT_FOUND" },
        { error: { code: "EACCES" }, context: "TASK", expected: "TASK_PERMISSION_DENIED" },
        { error: { code: "EACCES" }, context: "OPERATION", expected: "OP_PERMISSION_DENIED" },
        { error: { code: "EMFILE" }, context: "TASK", expected: "TASK_TOO_MANY_OPEN_FILES" },
        { error: { code: "ENOTDIR" }, context: "OPERATION", expected: "OP_NOT_A_DIRECTORY" },
        { error: { code: "EISDIR" }, context: "TASK", expected: "TASK_IS_A_DIRECTORY" },
        { error: { code: "ENOSPC" }, context: "OPERATION", expected: "OP_NO_SPACE_LEFT" },
        { error: { code: "EROFS" }, context: "TASK", expected: "TASK_READ_ONLY_FILESYSTEM" },
        { error: { code: "EBUSY" }, context: "OPERATION", expected: "OP_RESOURCE_BUSY" },
        { error: { code: "ELOOP" }, context: "TASK", expected: "TASK_TOO_MANY_SYMLINKS" },
        { error: { code: "ECONNRESET" }, context: "OPERATION", expected: "OP_CONNECTION_RESET" },
        { error: { code: "ETIMEDOUT" }, context: "TASK", expected: "TASK_OPERATION_TIMED_OUT" },
        { error: { code: "ENETDOWN" }, context: "OPERATION", expected: "OP_NETWORK_DOWN" },
        { error: { code: "ECONNREFUSED" }, context: "TASK", expected: "TASK_CONNECTION_REFUSED" },
        { error: { code: "EPIPE" }, context: "OPERATION", expected: "OP_BROKEN_PIPE" },
        { error: { code: "ENAMETOOLONG" }, context: "TASK", expected: "TASK_FILENAME_TOO_LONG" },
        { error: { code: "EIO" }, context: "OPERATION", expected: "OP_SERVER_DISCONNECTED" },
        { error: { code: "UNKNOWN_CODE" }, context: "TASK", expected: "TASK_UNKNOWN_ERROR" },
    ];

    testCases.forEach(({ error, context, expected }) => {
        it(`should return '${expected}' for error ${error.code} and context '${context}'`, () => {
            expect(getErrorCode(error, context as any)).toBe(expected);
        });
    });
});


describe("formatDate", () => {
    it("should format a regular date correctly", () => {
        const date = new Date("2024-03-27T15:05:09Z");
        expect(formatDate(date)).toBe("202403272035.09");
    });
});