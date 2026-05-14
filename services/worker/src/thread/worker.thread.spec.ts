jest.mock("worker_threads", () => {
  return {
    parentPort: {
      on: jest.fn(),     
      postMessage: jest.fn()
    },
    workerData: { threadNumber: 1, operationBand: "testBand" }
  };
});
import * as fs from "fs";
import * as crypto from "crypto";

import { Readable, Writable } from "stream";

import { calculateChecksum, smartCopy } from "./worker.thread";
import { createDirectory } from "../activities/utils/directory.utils";

jest.mock("fs");
jest.mock("crypto");
jest.mock("../activities/utils/directory.utils");

describe("smartCopy", () => {
  const sourcePath = "source.txt";
  const destPath = "dest/target.txt";
  const size = 1024*4;
  const maxBufferSize = 1024*1024;
  const mockData = Buffer.from("test file data");

  beforeEach(() => {
    jest.resetAllMocks();
    // Mock fs.promises.access to always resolve (simulate file exists)
    (fs as any).promises = {
      ...(fs as any).promises,
      access: jest.fn().mockResolvedValue(undefined),
    };
  });

  const mockFsStream = (data: Buffer) => {
    const readable = new Readable({
      read() {
        this.push(data);
        this.push(null);
      }
    });
    return readable;
  };

  const mockAsyncReadableStream = (data: Buffer) => {
    const readable = new Readable({
      read() {
        this.push(data);
        this.push(null);
      }
    });

    // mock for-await-of support
    (readable as any)[Symbol.asyncIterator] = async function* () {
      yield data;
    };

    return readable;
  };

  const mockWritableStream = () => {
    const writable = new Writable();
    writable._write = (chunk, encoding, callback) => {
      callback();
    };
    return writable;
  };


  it("should create target directory if it doesn't exist", async () => {
    // Mock createDirectory
    const mockCreateDirectory = createDirectory as jest.MockedFunction<typeof createDirectory>;
    mockCreateDirectory.mockResolvedValue(undefined);

    (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
    (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

    const fakeHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("checksum123"),
    };

    (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize);

    // Verify directory creation was called with createDirectory
    expect(mockCreateDirectory).toHaveBeenCalledWith("dest");
    expect(result.sourceChecksum).toBe("checksum123");
  });

  it("should make sure directory is always present", async () => {
    // Mock createDirectory
    const mockCreateDirectory = createDirectory as jest.MockedFunction<typeof createDirectory>;
    mockCreateDirectory.mockResolvedValue(undefined);

    (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
    (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

    const fakeHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("checksum123"),
    };

    (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize);

    // Verify directory creation was called (createDirectory is always called in implementation)
    expect(mockCreateDirectory).toHaveBeenCalledWith("dest");
    expect(result.sourceChecksum).toBe("checksum123");
  });

  describe("8.3 Collision Detection", () => {
    const mockCreateDirectory = createDirectory as jest.MockedFunction<typeof createDirectory>;

    beforeEach(() => {
      // Reset the mock before each test
      mockCreateDirectory.mockReset();
    });

    it("should use collision detection for Windows paths with tildes", async () => {
      const destPathWithTilde = "dest/LONGLO~1/target.txt";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockMakeDir = jest.fn().mockResolvedValue(undefined);
      (fs as any).promises.mkdir = mockMakeDir;
      mockCreateDirectory.mockResolvedValue(undefined);

      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, destPathWithTilde, size, maxBufferSize);

      expect(mockCreateDirectory).toHaveBeenCalledWith("dest/LONGLO~1");
      
      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should handle collision detection error during directory creation", async () => {
      const destPathWithTilde = "dest/LONGLO~1/target.txt";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const collisionError: any = new Error('Cannot copy on destination due to 8.3 collision for path: dest/LONGLO~1');
      collisionError.code = 'E8DOT3_COLLISION';
      mockCreateDirectory.mockRejectedValue(collisionError);

      await expect(smartCopy(sourcePath, destPathWithTilde, size, maxBufferSize))
        .rejects.toMatchObject({
          message: expect.stringContaining('Cannot copy on destination due to 8.3 collision for path:'),
          code: 'E8DOT3_COLLISION'
        });

      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should use regular mkdir for non-Windows platforms", async () => {
      const destPathWithTilde = "dest/LONGLO~1/target.txt";
      const originalPlatform = process.platform;
      
      // Mock non-Windows platform
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockCreateDirectory.mockResolvedValue(undefined);

      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, destPathWithTilde, size, maxBufferSize);

      // createDirectory is always called, but internally it will use regular mkdir for non-Windows
      expect(mockCreateDirectory).toHaveBeenCalledWith("dest/LONGLO~1");

      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should use regular mkdir for Windows paths without tildes", async () => {
      const regularDestPath = "dest/regular_folder/target.txt";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockCreateDirectory.mockResolvedValue(undefined);

      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, regularDestPath, size, maxBufferSize);

      // createDirectory is always called, but internally it will use regular mkdir for non-tilde paths
      expect(mockCreateDirectory).toHaveBeenCalledWith("dest/regular_folder");

      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should use 'wx' flag for Windows tilde filenames when file doesn't exist", async () => {
      const destPathWithTildeFile = "dest/LONGFI~1.TXT";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockMakeDir = jest.fn().mockResolvedValue(undefined);
      (fs as any).promises.mkdir = mockMakeDir;

      // Mock realpath to fail with ENOENT (file doesn't exist)
      const mockRealpath = jest.fn().mockRejectedValue({ code: 'ENOENT' });
      (fs as any).promises.realpath = mockRealpath;

      const mockWriteStream = mockWritableStream();
      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWriteStream);

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, destPathWithTildeFile, size, maxBufferSize);

      // Verify createWriteStream was called with 'wx' flag
      expect(fs.createWriteStream).toHaveBeenCalledWith(destPathWithTildeFile, { flags: 'wx', highWaterMark: expect.any(Number) });
      expect(mockRealpath).toHaveBeenCalledWith(destPathWithTildeFile);

      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should use 'w' flag for Windows tilde filenames when file exists", async () => {
      const destPathWithTildeFile = "dest/LONGFI~1.TXT";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockMakeDir = jest.fn().mockResolvedValue(undefined);
      (fs as any).promises.mkdir = mockMakeDir;

      // Mock realpath to succeed (file exists)
      const mockRealpath = jest.fn().mockResolvedValue(destPathWithTildeFile);
      (fs as any).promises.realpath = mockRealpath;

      const mockWriteStream = mockWritableStream();
      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWriteStream);

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, destPathWithTildeFile, size, maxBufferSize);

      // Verify createWriteStream was called with 'w' flag (overwrite)
      expect(fs.createWriteStream).toHaveBeenCalledWith(destPathWithTildeFile, { flags: 'w', highWaterMark: expect.any(Number) });
      expect(mockRealpath).toHaveBeenCalledWith(destPathWithTildeFile);

      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should use 'wx' flag for Windows tilde filenames when realpath fails with EBADF", async () => {
      const destPathWithTildeFile = "dest/LONGFI~1.TXT";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockMakeDir = jest.fn().mockResolvedValue(undefined);
      (fs as any).promises.mkdir = mockMakeDir;

      // Mock realpath to fail with EBADF
      const mockRealpath = jest.fn().mockRejectedValue({ code: 'EBADF' });
      (fs as any).promises.realpath = mockRealpath;

      const mockWriteStream = mockWritableStream();
      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWriteStream);

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, destPathWithTildeFile, size, maxBufferSize);

      // Verify createWriteStream was called with 'wx' flag
      expect(fs.createWriteStream).toHaveBeenCalledWith(destPathWithTildeFile, { flags: 'wx', highWaterMark: expect.any(Number) });

      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should handle EEXIST error from writeStream and convert to E8DOT3_COLLISION", async () => {
      const destPathWithTildeFile = "dest/LONGFI~1.TXT";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockMakeDir = jest.fn().mockResolvedValue(undefined);
      (fs as any).promises.mkdir = mockMakeDir;

      // Mock realpath to fail (file doesn't exist)
      const mockRealpath = jest.fn().mockRejectedValue({ code: 'ENOENT' });
      (fs as any).promises.realpath = mockRealpath;

      // Create a writable stream that will emit EEXIST error when piped
      const mockWrite = new Writable();
      let errorEmitted = false;
      let eexistError: any = null;
      mockWrite._write = (chunk, encoding, callback) => {
        if (!errorEmitted) {
          errorEmitted = true;
          eexistError = new Error('File exists');
          eexistError.code = 'EEXIST';
          mockWrite.emit('error', eexistError);
        }
        callback(eexistError);
      };

      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWrite);

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      // Expect the error to be converted to E8DOT3_COLLISION
      await expect(smartCopy(sourcePath, destPathWithTildeFile, size, maxBufferSize))
        .rejects.toMatchObject({
          code: 'E8DOT3_COLLISION',
          message: expect.stringContaining('Cannot copy on destination due to 8.3 collision')
        });

      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should use regular 'w' flag for non-Windows platforms even with tilde in filename", async () => {
      const destPathWithTildeFile = "dest/LONGFI~1.TXT";
      const originalPlatform = process.platform;
      
      // Mock Linux platform
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const mockMakeDir = jest.fn().mockResolvedValue(undefined);
      (fs as any).promises.mkdir = mockMakeDir;

      const mockWriteStream = mockWritableStream();
      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWriteStream);

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, destPathWithTildeFile, size, maxBufferSize);

      // Verify createWriteStream was called with default 'w' flag (not 'wx')
      expect(fs.createWriteStream).toHaveBeenCalledWith(destPathWithTildeFile, { flags: 'w', highWaterMark: expect.any(Number) });

      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

});

describe("calculateChecksum", () => {

  const mockAsyncReadableStream = (data: Buffer) => {
    const readable = new Readable({
      read() {
        this.push(data);
        this.push(null);
      }
    });

    // mock for-await-of support
    (readable as any)[Symbol.asyncIterator] = async function* () {
      yield data;
    };

    return readable;
  };

  it("should return the sha256 checksum of file", async () => {
    const fakeHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("testChecksum"),
    };

    (crypto.createHash as jest.Mock).mockReturnValue(fakeHash);
    (fs.createReadStream as jest.Mock).mockImplementation(() => mockAsyncReadableStream(Buffer.from("abc")));

    // Reset digest return value for this test
    fakeHash.digest.mockReturnValue("testChecksum");

    const checksum = await calculateChecksum("dummy.txt");

    expect(checksum).toBe("testChecksum");
    expect(fakeHash.update).toHaveBeenCalled();
    expect(fakeHash.digest).toHaveBeenCalledWith("hex");
  });

  it("should destroy the stream after calculating checksum", async () => {
    const fakeHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("destroyChecksum"),
    };

    const destroyedStream = mockAsyncReadableStream(Buffer.from("destroy"));
    destroyedStream.destroy = jest.fn();
    destroyedStream.destroyed = false;

    (crypto.createHash as jest.Mock).mockReturnValue(fakeHash);
    (fs.createReadStream as jest.Mock).mockImplementation(() => destroyedStream);

    await calculateChecksum("dummy.txt");
    expect(destroyedStream.destroy).toHaveBeenCalled();
  });

  it("should handle error during checksum calculation and still destroy stream", async () => {
    const fakeHash = {
      update: jest.fn().mockImplementation(() => { throw new Error("fail update"); }),
      digest: jest.fn(),
    };

    const destroyedStream = mockAsyncReadableStream(Buffer.from("fail"));
    destroyedStream.destroy = jest.fn();
    destroyedStream.destroyed = false;

    (crypto.createHash as jest.Mock).mockReturnValue(fakeHash);
    (fs.createReadStream as jest.Mock).mockImplementation(() => destroyedStream);

    await expect(calculateChecksum("dummy.txt")).rejects.toThrow("fail update");
    expect(destroyedStream.destroy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createSourceReadStream branch coverage (exercised through smartCopy with
// atimeOpts). Each test pins exactly one of the seven strategy outcomes
// from atime-preserve.utils ATIME_DIAG, so the corresponding branch in
// worker.thread.ts createSourceReadStream() is hit at least once.
//
// We mock fs.constants.O_NOATIME on/off per case; on Windows the Win32
// platform branch fires before the O_NOATIME check, so the host platform
// of the test runner is overridden via Object.defineProperty for the
// Windows-fallback case.
// ---------------------------------------------------------------------------
describe("smartCopy atimeOpts → createSourceReadStream strategy branches", () => {
  const sourcePath = "source.txt";
  const destPath = "dest/target.txt";
  const size = 1024;
  const maxBufferSize = 1024 * 1024;
  const data = Buffer.from("payload");

  const makeReadable = () => {
    const r = new Readable({
      read() {
        this.push(data);
        this.push(null);
      },
    });
    return r;
  };
  const makeWritable = () => {
    const w = new Writable();
    w._write = (_c, _e, cb) => cb();
    return w;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    (fs as any).promises = {
      ...(fs as any).promises,
      access: jest.fn().mockResolvedValue(undefined),
    };
    (fs.createReadStream as jest.Mock).mockImplementation(() => makeReadable());
    (fs.createWriteStream as jest.Mock).mockImplementation(() => makeWritable());
    (createDirectory as jest.MockedFunction<typeof createDirectory>).mockResolvedValue(
      undefined,
    );
    const fakeHash = {
      update: jest.fn(),
      digest: jest.fn().mockReturnValue("checksum"),
    } as any;
    (crypto.createHash as jest.Mock)
      .mockReturnValueOnce(fakeHash)
      .mockReturnValueOnce(fakeHash);
    Object.defineProperty(fs.constants, "O_RDONLY", { value: 0, configurable: true });
  });

  it("READ_NOT_REQUESTED when preserveAccessTime is false (no atime work)", async () => {
    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize, {
      preserveAccessTime: false,
    });
    expect(result.atimeReadStrategy).toBe("read_path:not_requested");
    expect(result.sourceNoatimeOpenDegraded).toBeUndefined();
  });

  it("WIN_READ_STAMP_FALLBACK on Windows even when preserveAccessTime is true", async () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const result = await smartCopy(sourcePath, destPath, size, maxBufferSize, {
        preserveAccessTime: true,
      });
      expect(result.atimeReadStrategy).toBe(
        "read_path:strategy_1_smb_fallback_standard_read_then_stamp",
      );
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  it("STRATEGY_2_SESSION_SKIP when skipSourceOpenNoatime is true (session learned ineffective)", async () => {
    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize, {
      preserveAccessTime: true,
      skipSourceOpenNoatime: true,
    });
    expect(result.atimeReadStrategy).toBe("read_path:strategy_2_session_skip_o_noatime");
  });

  it("STRATEGY_2_KERNEL_NO_FLAG when fs.constants.O_NOATIME is unavailable on this kernel", async () => {
    delete (fs.constants as any).O_NOATIME;
    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize, {
      preserveAccessTime: true,
    });
    expect(result.atimeReadStrategy).toBe("read_path:strategy_2_o_noatime_unavailable_kernel");
  });

  it("STRATEGY_2_O_NOATIME when fs.promises.open(O_NOATIME) succeeds", async () => {
    Object.defineProperty(fs.constants, "O_NOATIME", { value: 0o1000000, configurable: true });
    const handle = {
      createReadStream: jest.fn(() => makeReadable()),
    };
    (fs as any).promises.open = jest.fn().mockResolvedValue(handle);
    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize, {
      preserveAccessTime: true,
    });
    expect(result.atimeReadStrategy).toBe("read_path:strategy_2_o_noatime");
    expect(handle.createReadStream).toHaveBeenCalled();
  });

  it("STRATEGY_2_FALLBACK_STD_SESSION + sourceNoatimeOpenDegraded when O_NOATIME open fails with EPERM", async () => {
    Object.defineProperty(fs.constants, "O_NOATIME", { value: 0o1000000, configurable: true });
    const epermErr: NodeJS.ErrnoException = Object.assign(new Error("perm"), { code: "EPERM" });
    (fs as any).promises.open = jest.fn().mockRejectedValue(epermErr);
    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize, {
      preserveAccessTime: true,
    });
    expect(result.atimeReadStrategy).toBe(
      "read_path:strategy_2_o_noatime_fallback_session_skip_next",
    );
    expect(result.sourceNoatimeOpenDegraded).toBe(true);
  });

  it("STRATEGY_2_FALLBACK_STD_SAME_FILE when O_NOATIME open fails with non-systemic error", async () => {
    Object.defineProperty(fs.constants, "O_NOATIME", { value: 0o1000000, configurable: true });
    const nonSystemicErr: NodeJS.ErrnoException = Object.assign(new Error("io"), { code: "EIO" });
    (fs as any).promises.open = jest.fn().mockRejectedValue(nonSystemicErr);
    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize, {
      preserveAccessTime: true,
    });
    expect(result.atimeReadStrategy).toBe(
      "read_path:strategy_2_o_noatime_fallback_same_file",
    );
    expect(result.sourceNoatimeOpenDegraded).toBeFalsy();
  });
});
