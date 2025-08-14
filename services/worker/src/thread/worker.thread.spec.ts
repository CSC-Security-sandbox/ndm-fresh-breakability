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

jest.mock("fs");
jest.mock("crypto");

describe("smartCopy", () => {
  const sourcePath = "source.txt";
  const destPath = "dest/target.txt";
  const size = 1024*4;
  const maxBufferSize = 1024*1024;
  const mockData = Buffer.from("test file data");

  beforeEach(() => {
    jest.resetAllMocks();
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
    // Mock fs.promises object
    const mockMakeDir = jest.fn().mockResolvedValue(undefined);
    
    (fs as any).promises = {
      mkdir: mockMakeDir
    };

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
    // Mock fs.promises object - mkdir succeeds regardless of directory existence
    const mockMakeDir = jest.fn().mockResolvedValue(undefined);
    
    (fs as any).promises = {
      mkdir: mockMakeDir
    };

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
