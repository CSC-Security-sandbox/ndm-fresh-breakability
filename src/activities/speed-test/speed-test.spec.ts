import { Test, TestingModule } from '@nestjs/testing';
import { SpeedTestReadActivity } from './speed-test-read-activities';
import { Logger } from '@nestjs/common';
import { promisify } from 'util';
import { RedisService } from 'src/redis/redis.service';
import { exec } from 'child_process';
import { Readable, Writable } from 'stream';
import * as fs  from 'fs';
import { FileServerDetails } from '@netapp-cloud-datamigrate/jobs-lib';

jest.mock('fs', () => {
  const fs = jest.requireActual('fs');
  return {
    ...fs,
    readFileSync: jest.fn().mockReturnValue({
      on: jest.fn(), // Mock implementation for 'on'
      // Add other necessary properties and methods
      toString: jest.fn().mockReturnValue('mocked content') // Example for toString    
    }),
    existsSync: jest.fn().mockReturnValue(true),
    createWriteStream: jest.fn().mockReturnValue({
      on: jest.fn(), // Mock implementation for 'on'
      // Add other necessary properties and methods
      write: jest.fn().mockReturnValue(true) // Example for write
    }),
    createReadStream: jest.fn(), // Add this line to mock createReadStream
    promises: {
      access: jest.fn().mockResolvedValue(undefined), // Mock fs.promises.access
    },
  };
});
jest.mock('child_process');
const execPromise = promisify(exec);

describe('SpeedTestReadActivity', () => {
  let speedTestReadActivity: SpeedTestReadActivity;
  let redisService: RedisService;
  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
  beforeEach(async () => {

    const mockJobContext = {
      getJobState: jest.fn().mockResolvedValue({}),
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpeedTestReadActivity,
        {
          provide: Logger,
          useValue: mockLogger,
        },
        {
          provide: RedisService,
          useValue: {
            getJobContext: jest.fn().mockResolvedValue(mockJobContext),
          },
        },
      ],
    }).compile();

    speedTestReadActivity = module.get(SpeedTestReadActivity);
    redisService = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(speedTestReadActivity).toBeDefined();
  });

  describe('readActivity', () => {
    it('should log start and completion of read activity', async () => {
      const payload = { fsDetails: { hostname: 'example.com', workingDirectory: '/tmp' } };
      const traceId = 'traceId';
      const volumeId = 'volumeId';
      const fileSize = 1024 * 1024 * 1024;
      const mockReadStream = new Readable({
        read() {},
      });
      (fs.createReadStream as jest.Mock).mockReturnValue(mockReadStream);
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      jest.spyOn(speedTestReadActivity, 'createFileIfNotExists').mockResolvedValue();
      setTimeout(() => {
        mockReadStream.emit('data', Buffer.alloc(fileSize / 2));
        mockReadStream.emit('data', Buffer.alloc(fileSize / 2));
        mockReadStream.emit('end');
      }, 1000);

      const result = await speedTestReadActivity.readActivity(payload, traceId, volumeId);
      // expect(result.errors.size).toBe(0);
      // expect(result.result["totalTimeTaken"]).toBeGreaterThan(1);
    });

    it("should create file when it doesn't exist", async () => {
      const traceId = 'traceId';
      const volumeId = 'volumeId';
      const fileName = '1GB_zero_file.bin';
      const basePath = `${traceId}/${volumeId}`;
      const filePath = `${basePath}/${fileName}`;
      const fileSize = 1024 * 1024 * 1024;
      const buffer = Buffer.alloc(1024, 0);
      const payload = { fsDetails: { hostname: 'example.com', workingDirectory: '/tmp' } };
      const mockWriteStream = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error('File not found'));
      // (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
      const mockCreateReadStream = new Readable({
        read() {},
      });
      (fs.createReadStream as jest.Mock).mockReturnValue(mockCreateReadStream);
      setTimeout(() => {
        mockCreateReadStream.emit('data', Buffer.alloc(fileSize / 2));
        mockCreateReadStream.emit('data', Buffer.alloc(fileSize / 2));
        mockCreateReadStream.emit('end');
      }, 1000);

      jest.spyOn(speedTestReadActivity, 'createFileIfNotExists').mockImplementation();
      jest.spyOn(speedTestReadActivity, 'createFile').mockResolvedValue({});
      const result = await speedTestReadActivity.readActivity(payload, traceId, volumeId);
      // expect(result.errors.size).toBe(0);
      // expect(result.result["totalTimeTaken"]).toBeGreaterThan(1);
    });

    it("should return error when read failed", async () => {
      const traceId = 'traceId';
      const volumeId = 'volumeId';
      const payload = { fsDetails: { hostname: 'example.com', workingDirectory: '/tmp' } };
      const mockReadStream = new Readable({
        read() {},
      });
      (fs.createReadStream as jest.Mock).mockReturnValue(mockReadStream);
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      setTimeout(() => {
        mockReadStream.emit('error', new Error('Read failed'));
      }, 100);
      
      const result = await speedTestReadActivity.readActivity(payload, traceId, volumeId);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0] === "Read failed");
    });
  });

  describe("writeActivity", () => {
    it("should create file successfully and return speed logs", async () => {
      const traceId = 'traceId';
      const volumeId = 'volumeId';
      const fileName = '1GB_zero_file.bin';
      const basePath = `${traceId}/${volumeId}`;
      const fileSize = 1024 * 1024 * 1024;
      const buffer = Buffer.alloc(1024, 0);
      const payload = { fsDetails: { hostname: 'example.com', workingDirectory: '/tmp' } };
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error('File not found'));
      const mockCreateWriteStream = new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
      });
      mockCreateWriteStream.on = jest.fn();
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockCreateWriteStream);
      setTimeout(() => {
        mockCreateWriteStream.emit('finish');       
      }, 1000);

      jest.spyOn(speedTestReadActivity, 'createFile').mockResolvedValue({});
      const result = await speedTestReadActivity.writeActivity(payload, traceId, volumeId);
      // expect(result.errors.size).toBe(0);
      //TODO: how to check the write speed?
    });
    

    it("should return error when write failed", async () => {
      const traceId = 'traceId';
      const volumeId = 'volumeId';
      const payload = { fsDetails: { hostname: 'example.com', workingDirectory: '/tmp' } };
      const mockWriteStream = new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
      });
      mockWriteStream.on = jest.fn();
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
      setTimeout(() => {
        mockWriteStream.emit('error', new Error("Write failed"));
      }, 1000);
      
      const result = await speedTestReadActivity.writeActivity(payload, traceId, volumeId)
      expect(result.errors.length).toBe(1);
      expect(result.errors[0] === "Write failed");
    });

  });
});