import * as fs from "fs";
import * as workerThreadMethods from "./worker.thread";

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
      await expect(workerThreadMethods.calculateChecksum("nonexistent.file"))
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
      const checksum = await workerThreadMethods.calculateChecksum("test.file");
      expect(checksum).toBe("mockedchecksum");
    });
  });

  describe("copyFileWithChecksum", () => {
    it("should throw an error if source file does not exist", async () => {
      jest.spyOn(fs, "existsSync").mockReturnValue(false);
      await expect(workerThreadMethods.copyFileWithChecksum("source.file", "dest.file"))
        .rejects.toThrow("Source file does not exist");
    });
  });

  describe('parentPort.on event', () => {
    let mockParentPort;
    beforeEach(() => {
      mockParentPort = require('worker_threads').parentPort;
    });
    it('should listen to messages from parentPort', () => {
      const mockMessage = { operation: 'copyFile', sourceFile: 'source.txt', destinationFile: 'dest.txt' };
      const mockPostMessage = jest.fn();
      mockParentPort.postMessage = mockPostMessage;
      mockParentPort.emit('message', mockMessage);
      expect(mockPostMessage).toHaveBeenCalledWith(mockMessage);
    });

    // catch block case
    it('should handle errors in the try block', async () => {
      const mockMessage = { operation: 'copyFile', sourceFile: 'nonexistent.txt', destinationFile: 'dest.txt' };
      const mockPostMessage = jest.fn();
      mockParentPort.postMessage = mockPostMessage;
      mockParentPort.emit('message', mockMessage);
      expect(mockPostMessage).toHaveBeenCalled();
    });

    // test for try block
    it('should call copyFileWithChecksum with correct arguments', async () => {
      const mockMessage = { Operation: 'COPY_FILE', data: { sourcePath: '/source', destinationPath: '/destination' }, id: '123' };
      const mockPostMessage = jest.fn();
      mockParentPort.postMessage = mockPostMessage;
      const copyFileWithChecksumSpy = jest.spyOn(workerThreadMethods, 'copyFileWithChecksum').mockResolvedValue({ sourceChecksum: 'checksum1', targetChecksum: 'checksum2' });
      mockParentPort.emit('message', mockMessage);
    });

    // try block default case
    it('should call postMessage with the task', () => {
      const mockMessage = { Operation: 'UNKNOWN_OPERATION', data: {}, id: '123' };
      const mockPostMessage = jest.fn();
      mockParentPort.postMessage = mockPostMessage;
      mockParentPort.emit('message', mockMessage);
      expect(mockPostMessage).toHaveBeenCalledWith(mockMessage);
    });
  });
});
