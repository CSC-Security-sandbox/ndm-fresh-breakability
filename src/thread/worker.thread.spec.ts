import * as fs from "fs";
import { copyFileWithChecksum, calculateChecksum } from "./worker.thread";

jest.mock("crypto", () => ({
  createHash: jest.fn(() => ({
    update: jest.fn(),
    digest: jest.fn(() => "mockedchecksum")
  }))
}));

jest.mock('worker_threads', () => {
    const EventEmitter = require('events');
    const mockParentPort = new EventEmitter();
    return {
      parentPort: mockParentPort
    };
  });

describe("Worker Thread Functions", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateChecksum", () => {
    it("should reject if file does not exist", async () => {
        jest.spyOn(fs, "existsSync").mockReturnValue(false);
      await expect(calculateChecksum("nonexistent.file"))
        .rejects.toThrow("File not found");
    });

    it("should resolve with a checksum", async () => {
        jest.spyOn(fs, "existsSync").mockReturnValue(true);
      const mockStream = {
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === "end") callback();
        })
      };
        jest.spyOn(fs, "createReadStream").mockReturnValue(mockStream as any);
      const checksum = await calculateChecksum("test.file");
      expect(checksum).toBe("mockedchecksum");
    });
  });

  describe("copyFileWithChecksum", () => {
    it("should throw an error if source file does not exist", async () => {
        jest.spyOn(fs, "existsSync").mockReturnValue(false);
      await expect(copyFileWithChecksum("source.file", "dest.file"))
        .rejects.toThrow("Source file does not exist");
    });
  });
});
