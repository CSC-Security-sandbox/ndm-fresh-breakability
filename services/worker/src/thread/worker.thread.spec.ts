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
import { createDirectoryWithTildeCheck } from "../activities/utils/directory.utils";

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
    // Mock fs.promises.mkdir
    const mockMakeDir = jest.fn().mockResolvedValue(undefined);
    (fs as any).promises.mkdir = mockMakeDir;

    (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
    (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

    const fakeHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("checksum123"),
    };

    (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize);

    // Verify directory creation was called
    expect(mockMakeDir).toHaveBeenCalledWith("dest", { recursive: true });
    expect(result.sourceChecksum).toBe("checksum123");
  });

  it("should make sure directory is always present", async () => {
    // Mock fs.promises.mkdir
    const mockMakeDir = jest.fn().mockResolvedValue(undefined);
    (fs as any).promises.mkdir = mockMakeDir;

    (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
    (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

    const fakeHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("checksum123"),
    };

    (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

    const result = await smartCopy(sourcePath, destPath, size, maxBufferSize);

    // Verify directory creation was called (mkdir is always called in implementation)
    expect(mockMakeDir).toHaveBeenCalledWith("dest", { recursive: true });
    expect(result.sourceChecksum).toBe("checksum123");
  });

  describe("8.3 Collision Detection", () => {
    const mockCreateDirectoryWithTildeCheck = createDirectoryWithTildeCheck as jest.MockedFunction<typeof createDirectoryWithTildeCheck>;

    beforeEach(() => {
      // Reset the mock before each test
      mockCreateDirectoryWithTildeCheck.mockReset();
    });

    it("should use collision detection for Windows paths with tildes", async () => {
      const destPathWithTilde = "dest/LONGLO~1/target.txt";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockMakeDir = jest.fn().mockResolvedValue(undefined);
      (fs as any).promises.mkdir = mockMakeDir;
      mockCreateDirectoryWithTildeCheck.mockResolvedValue(undefined);

      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, destPathWithTilde, size, maxBufferSize);

      expect(mockCreateDirectoryWithTildeCheck).toHaveBeenCalledWith("dest/LONGLO~1");
      
      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should handle collision detection error during directory creation", async () => {
      const destPathWithTilde = "dest/LONGLO~1/target.txt";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const collisionError: any = new Error('8.3 short filename collision detected');
      collisionError.code = 'E8DOT3_COLLISION';
      mockCreateDirectoryWithTildeCheck.mockRejectedValue(collisionError);

      await expect(smartCopy(sourcePath, destPathWithTilde, size, maxBufferSize))
        .rejects.toMatchObject({
          message: expect.stringContaining('8.3 short filename collision detected'),
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

      const mockMakeDir = jest.fn().mockResolvedValue(undefined);
      (fs as any).promises.mkdir = mockMakeDir;

      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, destPathWithTilde, size, maxBufferSize);

      expect(mockMakeDir).toHaveBeenCalledWith("dest/LONGLO~1", { recursive: true });
      expect(mockCreateDirectoryWithTildeCheck).not.toHaveBeenCalled();

      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it("should use regular mkdir for Windows paths without tildes", async () => {
      const regularDestPath = "dest/regular_folder/target.txt";
      const originalPlatform = process.platform;
      
      // Mock Windows platform
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockMakeDir = jest.fn().mockResolvedValue(undefined);
      (fs as any).promises.mkdir = mockMakeDir;

      (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
      (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

      const fakeHash = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue("checksum123"),
      };

      (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

      await smartCopy(sourcePath, regularDestPath, size, maxBufferSize);

      expect(mockMakeDir).toHaveBeenCalledWith("dest/regular_folder", { recursive: true });
      expect(mockCreateDirectoryWithTildeCheck).not.toHaveBeenCalled();

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
