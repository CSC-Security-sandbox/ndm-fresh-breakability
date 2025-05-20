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

  it("should copy file and match checksums", async () => {
    (fs.existsSync as jest.Mock).mockImplementation((p) => p === sourcePath || p === "dest");

    (fs.createReadStream as jest.Mock).mockImplementation((path: string) => {
      return mockFsStream(mockData);
    });

    (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

    const fakeHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("fakeChecksum"),
    };

    // First for streaming write, second for checksum comparison
    (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

    const result = await smartCopy(sourcePath, destPath);

    expect(fs.existsSync).toHaveBeenCalledWith(sourcePath);
    expect(result.sourceChecksum).toEqual("fakeChecksum");
    expect(result.targetChecksum).toEqual("fakeChecksum");
  });

  it("should throw error if source does not exist", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    await expect(smartCopy("nonexistent.txt", destPath)).rejects.toThrow("Source file does not exist");
  });

  it("should create target directory if it doesn’t exist", async () => {
    (fs.existsSync as jest.Mock).mockImplementation((p) => p === sourcePath);

    const mkdirSyncMock = jest.fn();
    (fs.mkdirSync as any) = mkdirSyncMock;

    (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
    (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

    const fakeHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("checksum123"),
    };

    (crypto.createHash as jest.Mock).mockReturnValueOnce(fakeHash).mockReturnValueOnce(fakeHash);

    const result = await smartCopy(sourcePath, destPath);

    expect(mkdirSyncMock).toHaveBeenCalledWith("dest", { recursive: true });
    expect(result.sourceChecksum).toBe("checksum123");
  });

  it("should throw error if checksums do not match", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const streamHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValueOnce("checksum-1"),
    };

    const checksumHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValueOnce("checksum-2"),
    };

    (crypto.createHash as jest.Mock).mockReturnValueOnce(streamHash).mockReturnValueOnce(checksumHash);

    (fs.createReadStream as jest.Mock).mockImplementation(() => mockFsStream(mockData));
    (fs.createWriteStream as jest.Mock).mockImplementation(() => mockWritableStream());

    await expect(smartCopy(sourcePath, destPath)).rejects.toThrow("Checksum mismatch");
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
});
