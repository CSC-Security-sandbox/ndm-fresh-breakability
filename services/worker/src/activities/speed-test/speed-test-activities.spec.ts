import { SpeedTestActivities } from './speed-test-activities';
import { Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { SpeedTestReadWriteInfo, TaskStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { WorkersConfig } from 'src/config/app.config';
import * as ping from 'ping';
import axios from 'axios';

jest.mock('ping');
jest.mock('axios');
jest.mock('src/config/app.config', () => ({
    WorkersConfig: {
        get: jest.fn(),
    },
}));

const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
};

const mockRedisService = {
    getSpeedTestJobContext: jest.fn(),
    setJobContext: jest.fn(),
};

describe('SpeedTestActivities', () => {
    let service: SpeedTestActivities;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new SpeedTestActivities(
            mockLogger as any as Logger,
            mockRedisService as any as RedisService,
        );
    });

    describe('calculatePacketLoss', () => {
        it('should calculate packet loss correctly', async () => {
            (ping.promise.probe as jest.Mock).mockResolvedValue({ alive: true });
            const loss = await service.calculatePacketLoss('127.0.0.1', 5);
            expect(loss).toBe(0);
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should handle some failed pings', async () => {
            (ping.promise.probe as jest.Mock)
                .mockResolvedValueOnce({ alive: true })
                .mockResolvedValueOnce({ alive: false })
                .mockResolvedValueOnce({ alive: true })
                .mockResolvedValueOnce({ alive: false })
                .mockResolvedValueOnce({ alive: true });
            const loss = await service.calculatePacketLoss('127.0.0.1', 5);
            expect(loss).toBe(40);
        });

        it('should handle ping errors gracefully', async () => {
            (ping.promise.probe as jest.Mock)
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValue({ alive: true });
            const loss = await service.calculatePacketLoss('127.0.0.1', 2);
            expect(loss).toBe(50);
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });

    describe('calculatePingRtt', () => {
        it('should calculate RTT statistics', async () => {
            (ping.promise.probe as jest.Mock).mockResolvedValue({ alive: true });
            const result = await service.calculatePingRtt('127.0.0.1', 3);
            expect(result.min).toBeGreaterThanOrEqual(0);
            expect(result.max).toBeGreaterThanOrEqual(result.min);
            expect(result.avg).toBeGreaterThanOrEqual(0);
            expect(result.mdev).toBeGreaterThanOrEqual(0);
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should throw error if ping fails', async () => {
            (ping.promise.probe as jest.Mock).mockResolvedValue({ alive: false });
            await expect(service.calculatePingRtt('127.0.0.1', 1)).rejects.toThrow();
        });
    });

    describe('networkPerformanceActivity', () => {
        it('should return success and result', async () => {
            (ping.promise.probe as jest.Mock).mockResolvedValue({ alive: true });
            const payload = { fsDetails: { hostname: '127.0.0.1' }, status: '' };
            const output = await service.networkPerformanceActivity(payload, 'trace');
            expect(output.success).toBe(true);
            expect(output.result).toHaveProperty('packetLoss');
            expect(output.result).toHaveProperty('roundTripDelay');
            expect(payload.status).toBe(TaskStatus.RUNNING);
        });

        it('should handle errors gracefully', async () => {
            (ping.promise.probe as jest.Mock).mockRejectedValue(new Error('fail'));
            const payload = { fsDetails: { hostname: '127.0.0.1' }, status: '' };
            const output = await service.networkPerformanceActivity(payload, 'trace');
            expect(output.success).toBe(false);
            expect(output.errors.length).toBeGreaterThan(0);
        });
    });

    describe('readActivity', () => {
        it('should call readTest and return success', async () => {
            const mockResult = { foo: 'bar' };
            service.readTest = jest.fn().mockResolvedValue(mockResult);
            const payload = { fsDetails: {}, status: '' };
            const output = await service.readActivity(payload, 'trace', 'vol', 'res');
            expect(output.success).toBe(true);
            expect(output.result).toBe(mockResult);
            expect(payload.status).toBe(TaskStatus.RUNNING);
        });

        it('should handle errors in readTest', async () => {
            service.readTest = jest.fn().mockRejectedValue(new Error('fail'));
            const payload = { fsDetails: {}, status: '' };
            const output = await service.readActivity(payload, 'trace', 'vol', 'res');
            expect(output.success).toBe(false);
            expect(output.errors.length).toBe(1);
        });
    });

    describe('writeActivity', () => {
        it('should call writeTest and return success', async () => {
            const mockResult = { foo: 'bar' };
            service.writeTest = jest.fn().mockResolvedValue(mockResult);
            const payload = { fsDetails: {}, status: '' };
            const output = await service.writeActivity(payload, 'trace', 'vol', 'res');
            expect(output.success).toBe(true);
            expect(output.result).toBe(mockResult);
            expect(payload.status).toBe(TaskStatus.RUNNING);
        });

        it('should handle errors in writeTest', async () => {
            service.writeTest = jest.fn().mockRejectedValue(new Error('fail'));
            const payload = { fsDetails: {}, status: '' };
            const output = await service.writeActivity(payload, 'trace', 'vol', 'res');
            expect(output.success).toBe(false);
            expect(output.errors.length).toBe(1);
        });
    });

    describe('postResultsActivity', () => {
        it('should post results and return response data', async () => {
            (WorkersConfig.get as jest.Mock).mockReturnValue('http://mock-url');
            (axios.post as jest.Mock).mockResolvedValue({ data: { ok: true } });
            const results = {
                writeResult: { result: { foo: 1 }, errors: [] },
                readResult: { result: { bar: 2 }, errors: ['err'] },
                networkPerformanceResult: { result: { baz: 3 }, errors: [] },
            };
            const data = await service.postResultsActivity('trace', 'worker', 'fsid', results);
            expect(axios.post).toHaveBeenCalledWith(
                'http://mock-url/api/v1/jobs/speed-test/store-result',
                expect.objectContaining({
                    traceId: 'trace',
                    workerId: 'worker',
                    fileServerID: 'fsid',
                    writeResult: expect.any(Object),
                    readResult: expect.any(Object),
                    networkPerformanceResult: expect.any(Object),
                }),
            );
            expect(data).toEqual({ ok: true });
        });

        it('should log error if axios fails', async () => {
            (WorkersConfig.get as jest.Mock).mockReturnValue('http://mock-url');
            (axios.post as jest.Mock).mockRejectedValue(new Error('fail'));
            const data = await service.postResultsActivity('trace', 'worker', 'fsid', {});
            expect(data).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalled();
        });


    });
});