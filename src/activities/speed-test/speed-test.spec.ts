import { Test, TestingModule } from '@nestjs/testing';
import { SpeedTestReadActivity } from './speed-test-read-activities';
import { Logger } from '@nestjs/common';
import { promisify } from 'util';
import { RedisService } from 'src/redis/redis.service';
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
    let mockReadTest: jest.SpyInstance;
  
    beforeEach(() => {
      // Mock the readTest method
      mockReadTest = jest.spyOn(speedTestReadActivity, 'readTest');
    });
  
    afterEach(() => {
      jest.clearAllMocks();
    });
  
    it('should log start and completion of read activity and return success', async () => {
      const payload = { fsDetails: { hostname: 'example.com', workingDirectory: '/tmp' } };
      const traceId = 'traceId';
      const volumeId = 'volumeId';
  
      // Mock readTest to resolve successfully
      const mockResult = {
        speedLogs: [{ timeStamp: '1.0', speed: '10.0' }],
        totalTimeTaken: 5,
        fileSize: 1024 * 1024 * 1024,
        bytesWritten: 1024 * 1024 * 1024,
        speed: 10.0,
      };
      mockReadTest.mockResolvedValue(mockResult);
  
      const result = await speedTestReadActivity.readActivity(payload, traceId, volumeId);
  
      // Assertions
      expect(mockReadTest).toHaveBeenCalledWith(payload.fsDetails, traceId, volumeId);
      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.result).toEqual(mockResult);
      expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Starting SpeedTest Read Activity`);
      expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] SpeedTest Read Activity Completed.`);
    });
  
    it('should handle errors from readTest and return default result', async () => {
      const payload = { fsDetails: { hostname: 'example.com', workingDirectory: '/tmp' } };
      const traceId = 'traceId';
      const volumeId = 'volumeId';
  
      // Mock readTest to throw an error
      const mockError = new Error('Read test failed');
      mockReadTest.mockRejectedValue(mockError);
  
      const result = await speedTestReadActivity.readActivity(payload, traceId, volumeId);
  
      // Assertions
      expect(mockReadTest).toHaveBeenCalledWith(payload.fsDetails, traceId, volumeId);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toBe('Read test failed');
      expect(result.result).toEqual({
        speedLogs: [],
        totalTimeTaken: -1,
        fileSize: -1,
        bytesWritten: -1,
        speed: -1,
      });
      expect(mockLogger.error).toHaveBeenCalledWith(`[${traceId}] Error encountered: Read test failed`);
    });
  });

  describe('writeActivity', () => {
    let mockWriteTest: jest.SpyInstance;
  
    beforeEach(() => {
      // Mock the writeTest method
      mockWriteTest = jest.spyOn(speedTestReadActivity, 'writeTest');
    });
  
    afterEach(() => {
      jest.clearAllMocks();
    });
  
    it('should log start and completion of write activity and return success', async () => {
      const payload = { fsDetails: { hostname: 'example.com', workingDirectory: '/tmp' } };
      const traceId = 'traceId';
      const volumeId = 'volumeId';
  
      // Mock writeTest to resolve successfully
      const mockResult = {
        speedLogs: [{ timeStamp: '1.0', speed: '10.0' }],
        totalTimeTaken: 5,
        fileSize: 1024 * 1024 * 1024,
        bytesWritten: 1024 * 1024 * 1024,
        speed: 10.0,
      };
      mockWriteTest.mockResolvedValue(mockResult);
  
      const result = await speedTestReadActivity.writeActivity(payload, traceId, volumeId);
  
      // Assertions
      expect(mockWriteTest).toHaveBeenCalledWith(payload.fsDetails, traceId, volumeId);
      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.result).toEqual(mockResult);
  
      // Verify logger calls
      expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Starting SpeedTest Write Activity`);
      expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] SpeedTest Write Activity Completed.`);

    });
  
    it('should handle errors from writeTest and return default result', async () => {
      const payload = { fsDetails: { hostname: 'example.com', workingDirectory: '/tmp' } };
      const traceId = 'traceId';
      const volumeId = 'volumeId';
  
      // Mock writeTest to throw an error
      const mockError = new Error('Write test failed');
      mockWriteTest.mockRejectedValue(mockError);
  
      const result = await speedTestReadActivity.writeActivity(payload, traceId, volumeId);
  
      // Assertions
      expect(mockWriteTest).toHaveBeenCalledWith(payload.fsDetails, traceId, volumeId);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toBe('Write test failed');
      expect(result.result).toEqual({
        speedLogs: [],
        totalTimeTaken: -1,
        fileSize: -1,
        bytesWritten: -1,
        speed: -1,
      });
  
      // Verify logger calls
      expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Starting SpeedTest Write Activity`);
      expect(mockLogger.error).toHaveBeenCalledWith(`[${traceId}] Error encountered: Write test failed`);
    });
  });

  describe('networkPerformanceActivity', () => {
    let mockMonitorPacketLoss: jest.SpyInstance;
    let mockCalculatePingRtt: jest.SpyInstance;
  
    beforeEach(() => {
      // Mock the monitorPacketLoss and calculatePingRtt methods
      mockMonitorPacketLoss = jest.spyOn(speedTestReadActivity, 'monitorPacketLoss');
      mockCalculatePingRtt = jest.spyOn(speedTestReadActivity, 'calculatePingRtt');
    });
  
    afterEach(() => {
      jest.clearAllMocks();
    });
  
    it('should log start and completion of network performance activity and return success', async () => {
      const payload = { fsDetails: { hostname: 'example.com' } };
      const traceId = 'traceId';
  
      // Mock monitorPacketLoss and calculatePingRtt to resolve successfully
      mockMonitorPacketLoss.mockResolvedValue(5); // 5% packet loss
      const mockRttResult = { min: 10, avg: 15, max: 20, mdev: 2 };
      mockCalculatePingRtt.mockResolvedValue(mockRttResult);
  
      const result = await speedTestReadActivity.networkPerformanceActivity(payload, traceId);
  
      // Assertions
      expect(mockMonitorPacketLoss).toHaveBeenCalledWith(payload.fsDetails.hostname);
      expect(mockCalculatePingRtt).toHaveBeenCalledWith(payload.fsDetails.hostname, 10);
      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.result).toEqual({
        roundTripDelay: mockRttResult,
        packetLoss: 5,
      });
  
      // Verify logger calls
      expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Starting SpeedTest Network Performance Activity`);
      expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] SpeedTest Network Performance Activity Completed.`);
    });
  
    it('should handle errors from monitorPacketLoss and return default result', async () => {
      const payload = { fsDetails: { hostname: 'example.com' } };
      const traceId = 'traceId';
  
      // Mock monitorPacketLoss to throw an error
      const mockError = new Error('Packet loss calculation failed');
      mockMonitorPacketLoss.mockRejectedValue(mockError);
  
      const result = await speedTestReadActivity.networkPerformanceActivity(payload, traceId);
  
      // Assertions
      expect(mockMonitorPacketLoss).toHaveBeenCalledWith(payload.fsDetails.hostname);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toBe('Packet loss calculation failed');
      expect(result.result).toEqual({
        roundTripDelay: { min: -1, avg: -1, max: -1, mdev: -1 },
        packetLoss: -1,
      });
  
      // Verify logger calls
      expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Starting SpeedTest Network Performance Activity`);
      expect(mockLogger.error).toHaveBeenCalledWith(`[${traceId}] Error encountered: Packet loss calculation failed`);
    });
  
    it('should handle errors from calculatePingRtt and return default result', async () => {
      const payload = { fsDetails: { hostname: 'example.com' } };
      const traceId = 'traceId';
  
      // Mock monitorPacketLoss to resolve successfully
      mockMonitorPacketLoss.mockResolvedValue(5); // 5% packet loss
      // Mock calculatePingRtt to throw an error
      const mockError = new Error('Ping RTT calculation failed');
      mockCalculatePingRtt.mockRejectedValue(mockError);
  
      const result = await speedTestReadActivity.networkPerformanceActivity(payload, traceId);
  
      // Assertions
      expect(mockMonitorPacketLoss).toHaveBeenCalledWith(payload.fsDetails.hostname);
      expect(mockCalculatePingRtt).toHaveBeenCalledWith(payload.fsDetails.hostname, 10);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toBe('Ping RTT calculation failed');
      expect(result.result).toEqual({
        roundTripDelay: { min: -1, avg: -1, max: -1, mdev: -1 },
        packetLoss: 5,
      });
  
      // Verify logger calls
      expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Starting SpeedTest Network Performance Activity`);
      expect(mockLogger.error).toHaveBeenCalledWith(`[${traceId}] Error encountered: Ping RTT calculation failed`);

    });
  });
});