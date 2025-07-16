import { Test, TestingModule } from '@nestjs/testing';
import { SpeedTestActivities } from './speed-test-activities';
import { mocked } from 'jest-mock';
import { RedisService } from 'src/redis/redis.service';
import axios from 'axios';
import { WorkersConfig } from 'src/config/app.config';
import * as ping from 'ping';
import { FileServerDetails, NFS } from '@netapp-cloud-datamigrate/jobs-lib';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';

jest.mock('ping', () => ({
  promise: {
    probe: jest.fn(),
  },
}));
jest.mock('axios');

const mockPingProbe = mocked(ping.promise.probe);
const mockAxiosPost = mocked(axios.post);
const mockWorkersConfigGet = jest.spyOn(WorkersConfig, 'get');

const mockJobContext = {
  getJobState: jest.fn().mockResolvedValue({}),
}

const createMockResult = (success: boolean, errors: string[] = [], result: any = {}) => ({
  success,
  errors,
  result,
});

describe('SpeedTestActivities', () => {
  let speedTestActivities: SpeedTestActivities;
  let redisService: RedisService;
  let mockReadFile: jest.SpyInstance;
  let mockCreateFile: jest.SpyInstance;
  let loggerFactory: LoggerFactory;

  beforeEach(async () => {
    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

    loggerFactory = mockLoggerFactory as unknown as LoggerFactory;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpeedTestActivities,
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: RedisService,
          useValue: {
            getJobContext: jest.fn().mockResolvedValue(mockJobContext),
          },
        },
      ],
    }).compile();

    speedTestActivities = module.get(SpeedTestActivities);
    redisService = module.get<RedisService>(RedisService);
    mockReadFile = jest.spyOn(speedTestActivities, 'readFile').mockResolvedValue('mockReadResult');
    mockCreateFile = jest.spyOn(speedTestActivities, 'createFile').mockResolvedValue('mockWriteResult');
    jest.spyOn(WorkersConfig, 'get').mockImplementation((key: string) => {
      if (key === 'speedTestFileName') {
        return 'testFile.bin';
      }
      return null;
    });
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(speedTestActivities).toBeDefined();
  });

  describe('readActivity', () => {
    let mockReadTest: jest.SpyInstance;
  
    beforeEach(() => {
      mockReadTest = jest.spyOn(speedTestActivities, 'readTest');
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
  
      const result = await speedTestActivities.readActivity(payload, traceId, volumeId, '');
  
      // Assertions
      expect(mockReadTest).toHaveBeenCalledWith(payload.fsDetails, traceId, volumeId, '');
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
  
      const result = await speedTestActivities.readActivity(payload, traceId, volumeId, '');
  
      // Assertions
      expect(mockReadTest).toHaveBeenCalledWith(payload.fsDetails, traceId, volumeId, '');
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
      mockWriteTest = jest.spyOn(speedTestActivities, 'writeTest');
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
  
      const result = await speedTestActivities.writeActivity(payload, traceId, volumeId, '');
  
      // Assertions
      expect(mockWriteTest).toHaveBeenCalledWith(payload.fsDetails, traceId, volumeId, '');
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
  
      const result = await speedTestActivities.writeActivity(payload, traceId, volumeId, '');
  
      // Assertions
      expect(mockWriteTest).toHaveBeenCalledWith(payload.fsDetails, traceId, volumeId, '');
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
      mockMonitorPacketLoss = jest.spyOn(speedTestActivities, 'calculatePacketLoss');
      mockCalculatePingRtt = jest.spyOn(speedTestActivities, 'calculatePingRtt');
    });
  
    it('should log start and completion of network performance activity and return success', async () => {
      const payload = { fsDetails: { hostname: 'example.com' } };
      const traceId = 'traceId';
  
      // Mock monitorPacketLoss and calculatePingRtt to resolve successfully
      mockMonitorPacketLoss.mockResolvedValue(5); // 5% packet loss
      const mockRttResult = { min: 10, avg: 15, max: 20, mdev: 2 };
      mockCalculatePingRtt.mockResolvedValue(mockRttResult);
  
      const result = await speedTestActivities.networkPerformanceActivity(payload, traceId);
  
      // Assertions
      expect(mockMonitorPacketLoss).toHaveBeenCalledWith(payload.fsDetails.hostname, 10);
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
  
      const result = await speedTestActivities.networkPerformanceActivity(payload, traceId);
  
      // Assertions
      expect(mockMonitorPacketLoss).toHaveBeenCalledWith(payload.fsDetails.hostname, 10);
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
  
      const result = await speedTestActivities.networkPerformanceActivity(payload, traceId);
  
      // Assertions
      expect(mockMonitorPacketLoss).toHaveBeenCalledWith(payload.fsDetails.hostname, 10);
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
  describe('SpeedTestActivities - postResultsActivity', () => {

    it('should post results successfully and return response data', async () => {
      const traceId = 'trace123';
      const workerId = 'worker123';
      const fileServerId = 'server123';
      const results = {
        writeResult: { result: { writeSpeed: 100 }, errors: [] },
        readResult: { result: { readSpeed: 200 }, errors: [] },
        networkPerformanceResult: { result: { latency: 50 }, errors: [] },
      };
      const workerJobServiceUrl = 'http://mock-worker-job-service-url';
      const mockResponseData = { success: true };
  
      mockWorkersConfigGet.mockReturnValue(workerJobServiceUrl);
      mockAxiosPost.mockResolvedValue({ data: mockResponseData });
  
      const response = await speedTestActivities.postResultsActivity(traceId, workerId, fileServerId, results);
  
      expect(mockWorkersConfigGet).toHaveBeenCalledWith('workerJobServiceUrl');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${workerJobServiceUrl}/api/v1/jobs/speed-test/store-result`,
        {
          traceId,
          workerId,
          fileServerID: fileServerId,
          writeResult: { writeSpeed: 100, error: '' },
          readResult: { readSpeed: 200, error: '' },
          networkPerformanceResult: { latency: 50, error: '' },
        }
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(traceId, `Post call response: ${JSON.stringify(mockResponseData)}`);
      expect(response).toEqual(mockResponseData);
    });
  
    it('should log an error if the API call fails', async () => {
      const traceId = 'trace123';
      const workerId = 'worker123';
      const fileServerId = 'server123';
      const results = {};
      const workerJobServiceUrl = 'http://mock-worker-job-service-url';
      const mockError = new Error('API call failed');
  
      mockWorkersConfigGet.mockReturnValue(workerJobServiceUrl);
      mockAxiosPost.mockRejectedValue(mockError);
  
      const response = await speedTestActivities.postResultsActivity(traceId, workerId, fileServerId, results);
  
      expect(mockWorkersConfigGet).toHaveBeenCalledWith('workerJobServiceUrl');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${workerJobServiceUrl}/api/v1/jobs/speed-test/store-result`,
        {
          traceId,
          workerId,
          fileServerID: fileServerId,
        }
      );
      expect(mockLogger.error).toHaveBeenCalledWith(traceId, `Failed to post results to API: ${mockError.message}`);
      expect(response).toBeUndefined();
    });
  });
  describe('SpeedTestActivities - calculatePacketLoss', () => {
    it('should calculate 0% packet loss when all pings are successful', async () => {
      const destinationIP = '192.168.1.1';
      const totalPackets = 5;
  
      mockPingProbe.mockResolvedValue({ alive: true });
  
      const packetLoss = await speedTestActivities.calculatePacketLoss(destinationIP, totalPackets);
  
      expect(mockPingProbe).toHaveBeenCalledTimes(totalPackets);
      expect(mockLogger.debug).toHaveBeenCalledWith(`Packet Loss to ${destinationIP}: 0.00%`);
      expect(packetLoss).toBe(0);
    });
  
    it('should calculate 100% packet loss when all pings fail', async () => {
      const destinationIP = '192.168.1.1';
      const totalPackets = 5;
  
      mockPingProbe.mockResolvedValue({ alive: false });
  
      const packetLoss = await speedTestActivities.calculatePacketLoss(destinationIP, totalPackets);
  
      expect(mockPingProbe).toHaveBeenCalledTimes(totalPackets);
      expect(mockLogger.debug).toHaveBeenCalledWith(`Packet Loss to ${destinationIP}: 100.00%`);
      expect(packetLoss).toBe(100);
    });
  
    it('should calculate partial packet loss when some pings succeed', async () => {
      const destinationIP = '192.168.1.1';
      const totalPackets = 5;
  
      mockPingProbe
        .mockResolvedValueOnce({ alive: true })
        .mockResolvedValueOnce({ alive: false })
        .mockResolvedValueOnce({ alive: true })
        .mockResolvedValueOnce({ alive: false })
        .mockResolvedValueOnce({ alive: true });
  
      const packetLoss = await speedTestActivities.calculatePacketLoss(destinationIP, totalPackets);
  
      expect(mockPingProbe).toHaveBeenCalledTimes(totalPackets);
      expect(mockLogger.debug).toHaveBeenCalledWith(`Packet Loss to ${destinationIP}: 40.00%`);
      expect(packetLoss).toBe(40);
    });
  
    it('should log errors when a ping throws an exception', async () => {
      const destinationIP = '192.168.1.1';
      const totalPackets = 3;
  
      mockPingProbe
        .mockResolvedValueOnce({ alive: true })
        .mockRejectedValueOnce(new Error('Ping failed'))
        .mockResolvedValueOnce({ alive: false });
  
      const packetLoss = await speedTestActivities.calculatePacketLoss(destinationIP, totalPackets);
  
      expect(mockPingProbe).toHaveBeenCalledTimes(totalPackets);
      expect(mockLogger.error).toHaveBeenCalledWith(`Error during ping 2: Ping failed`);
      expect(mockLogger.debug).toHaveBeenCalledWith(`Packet Loss to ${destinationIP}: 66.67%`);
      expect(packetLoss).toBeCloseTo(66.67, 2);
    });
  });
  describe('SpeedTestActivities - calculatePingRtt', () => {
    it('should calculate RTT statistics when all pings are successful', async () => {
      const destinationIP = '192.168.1.1';
      const totalPackets = 3;
  
      // Mock `ping.promise.probe` to simulate successful pings
      mockPingProbe
        .mockResolvedValueOnce({ alive: true })
        .mockResolvedValueOnce({ alive: true })
        .mockResolvedValueOnce({ alive: true });
  
      // Mock `Date.now` to simulate RTT values
      const mockTimes = [1000, 1020, 1040, 1060, 1080, 1100];
      let callIndex = 0;
      jest.spyOn(global.Date, 'now').mockImplementation(() => mockTimes[callIndex++]);
  
      const result = await speedTestActivities.calculatePingRtt(destinationIP, totalPackets);
  
      expect(mockPingProbe).toHaveBeenCalledTimes(totalPackets);
      expect(mockLogger.debug).toHaveBeenCalledWith(`Ping 1: RTT = 20 ms`);
      expect(mockLogger.debug).toHaveBeenCalledWith(`Ping 2: RTT = 20 ms`);
      expect(mockLogger.debug).toHaveBeenCalledWith(`Ping 3: RTT = 20 ms`);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `RTT Statistics to ${destinationIP}: Min=20 ms, Avg=20.00 ms, Max=20 ms, Mdev=0.00 ms`
      );
      expect(result).toEqual({ min: 20, avg: 20, max: 20, mdev: 0 });
    });
  
    it('should throw an error if a ping fails', async () => {
      const destinationIP = '192.168.1.1';
      const totalPackets = 3;
  
      // Mock `ping.promise.probe` to simulate a failed ping
      mockPingProbe
        .mockResolvedValueOnce({ alive: true })
        .mockRejectedValueOnce(new Error('Ping failed'));
  
      // Mock `Date.now` to simulate RTT values
      const mockTimes = [1000, 1020];
      let callIndex = 0;
      jest.spyOn(global.Date, 'now').mockImplementation(() => mockTimes[callIndex++ % mockTimes.length]);
  
      await expect(speedTestActivities.calculatePingRtt(destinationIP, totalPackets)).rejects.toThrow(
        'Error during ping 2: Ping failed'
      );
  
      expect(mockPingProbe).toHaveBeenCalledTimes(2); // Stops after the second ping fails
      expect(mockLogger.debug).toHaveBeenCalledWith(`Ping 1: RTT = 20 ms`);
    });
  
    it('should throw an error if the destination is unreachable', async () => {
      const destinationIP = '192.168.1.1';
      const totalPackets = 3;
  
      // Mock `ping.promise.probe` to simulate unreachable destination
      mockPingProbe.mockResolvedValueOnce({ alive: false });
  
      await expect(speedTestActivities.calculatePingRtt(destinationIP, totalPackets)).rejects.toThrow(
        'Ping 1: Destination unreachable'
      );
  
      expect(mockPingProbe).toHaveBeenCalledTimes(1); // Stops after the first ping fails
    });
  
    it('should return default RTT statistics if no pings are successful', async () => {
      const destinationIP = '192.168.1.1';
      const totalPackets = 3;
  
      // Mock `ping.promise.probe` to simulate all pings failing
      mockPingProbe.mockResolvedValue({ alive: false });
  
      await expect(speedTestActivities.calculatePingRtt(destinationIP, totalPackets)).rejects.toThrow(
        'Ping 1: Destination unreachable'
      );
  
      expect(mockPingProbe).toHaveBeenCalledTimes(1);
    });
  });
  describe('readTest', () => {
    it('should call readFile with correct arguments and return result', async () => {
      const fsDetails = new FileServerDetails('host', [ new NFS('root') ], 'user', 'password', 'domain', 'pathId', '/tmp', '');

      const traceId = 'traceId';
      const volumeId = 'volumeId';
      const resultId = 'resultId';

      const result = await speedTestActivities.readTest(fsDetails, traceId, volumeId, resultId);

      expect(mockReadFile).toHaveBeenCalledWith('/tmp/traceId/volumeId', 'testFile.bin', traceId, resultId);
      expect(result).toBe('mockReadResult');
    });
  });

  describe('writeTest', () => {
    it('should call createFile with correct arguments and return result', async () => {
      const fsDetails = new FileServerDetails('host', [ new NFS('root') ], 'user', 'password', 'domain', 'pathId', '/tmp', '');
      const traceId = 'traceId';
      const volumeId = 'volumeId';
      const resultId = 'resultId';

      const result = await speedTestActivities.writeTest(fsDetails, traceId, volumeId, resultId);

      expect(mockCreateFile).toHaveBeenCalledWith('/tmp/traceId/volumeId', 'testFile.bin', traceId, resultId);
      expect(result).toBe('mockWriteResult');
    });
  });
});