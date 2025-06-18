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

        describe('createFile', () => {
            beforeEach(() => {
            jest.spyOn(service as any, 'ensureDirectoryExists').mockResolvedValue(undefined);
            jest.spyOn(service as any, 'checkDirPermissions').mockResolvedValue(undefined);
            (WorkersConfig.get as jest.Mock).mockImplementation((key: string) => {
                if (key === 'speedTestFileName') return 'testfile';
                if (key === 'speedTestFileSize') return 0.000001; // ~1KB for test
                if (key === 'speedTestTimeout') return 100;
                return undefined;
            });
            mockRedisService.getSpeedTestJobContext.mockResolvedValue({
                appendToSpeedTestReadWriteInfo: jest.fn(),
            });
            });

            it('should create a file and resolve with stats', async () => {
            const mockWriteStream = {
                write: jest.fn(() => true),
                end: jest.fn(),
                on: jest.fn(),
                once: jest.fn(),
                destroy: jest.fn(),
            };
            jest.spyOn(require('fs'), 'createWriteStream').mockReturnValue(mockWriteStream as any);
            // Simulate 'finish' event
            setTimeout(() => {
                if (mockWriteStream.on.mock.calls.find(([event]) => event === 'finish')) {
                mockWriteStream.on.mock.calls.find(([event]) => event === 'finish')[1]();
                }
            }, 10);

            const result = await service.createFile('/tmp', 'testfile', 'jobid', 'resultid');
            expect(result).toHaveProperty('totalTimeTaken');
            expect(result).toHaveProperty('fileSize');
            expect(result).toHaveProperty('bytesWritten');
            expect(result).toHaveProperty('speed');
            expect(mockLogger.debug).toHaveBeenCalled();
            });

            it('should handle fileStream error', async () => {
            const mockWriteStream = {
                write: jest.fn(() => true),
                end: jest.fn(),
                on: jest.fn(),
                once: jest.fn(),
                destroy: jest.fn(),
            };
            jest.spyOn(require('fs'), 'createWriteStream').mockReturnValue(mockWriteStream as any);
            // Simulate 'error' event
            setTimeout(() => {
                if (mockWriteStream.on.mock.calls.find(([event]) => event === 'error')) {
                mockWriteStream.on.mock.calls.find(([event]) => event === 'error')[1](new Error('fail'));
                }
            }, 10);

            await expect(service.createFile('/tmp', 'testfile', 'jobid', 'resultid')).rejects.toThrow('fail');
            expect(mockLogger.error).toHaveBeenCalled();
            });

            it('should throw error if ensureDirectoryExists fails', async () => {
            jest.spyOn(service as any, 'ensureDirectoryExists').mockRejectedValue(new Error('fail'));
            await expect(service.createFile('/tmp', 'testfile', 'jobid', 'resultid')).rejects.toThrow('fail');
            expect(mockLogger.error).toHaveBeenCalled();
            });
        });

        describe('readFile', () => {
            beforeEach(() => {
            jest.spyOn(service as any, 'createFileIfNotExists').mockResolvedValue(undefined);
            jest.spyOn(service as any, 'checkDirPermissions').mockResolvedValue(undefined);
            (WorkersConfig.get as jest.Mock).mockImplementation((key: string) => {
                if (key === 'speedTestFileName') return 'testfile';
                if (key === 'speedTestFileSize') return 0.000001; // ~1KB for test
                if (key === 'speedTestTimeout') return 100;
                return undefined;
            });
            mockRedisService.getSpeedTestJobContext.mockResolvedValue({
                appendToSpeedTestReadWriteInfo: jest.fn(),
            });
            });

            it('should read a file and resolve with stats', async () => {
            const mockReadStream = {
                on: jest.fn(),
                destroy: jest.fn(),
            };
            jest.spyOn(require('fs'), 'createReadStream').mockReturnValue(mockReadStream as any);

            // Simulate 'data' and 'end' events
            setTimeout(() => {
                if (mockReadStream.on.mock.calls.find(([event]) => event === 'data')) {
                mockReadStream.on.mock.calls.find(([event]) => event === 'data')[1](Buffer.alloc(512));
                }
                if (mockReadStream.on.mock.calls.find(([event]) => event === 'end')) {
                mockReadStream.on.mock.calls.find(([event]) => event === 'end')[1]();
                }
            }, 10);

            const result = await service.readFile('/tmp', 'testfile', 'jobid', 'resultid');
            expect(result).toHaveProperty('totalTimeTaken');
            expect(result).toHaveProperty('fileSize');
            expect(result).toHaveProperty('bytesRead');
            expect(result).toHaveProperty('speed');
            expect(mockLogger.debug).toHaveBeenCalled();
            });

            it('should handle fileStream error', async () => {
            const mockReadStream = {
                on: jest.fn(),
                destroy: jest.fn(),
            };
            jest.spyOn(require('fs'), 'createReadStream').mockReturnValue(mockReadStream as any);

            // Simulate 'error' event
            setTimeout(() => {
                if (mockReadStream.on.mock.calls.find(([event]) => event === 'error')) {
                mockReadStream.on.mock.calls.find(([event]) => event === 'error')[1](new Error('fail'));
                }
            }, 10);

            await expect(service.readFile('/tmp', 'testfile', 'jobid', 'resultid')).rejects.toThrow('fail');
            expect(mockLogger.error).toHaveBeenCalled();
            });
        });

        describe('ensureDirectoryExists', () => {
            it('should resolve if directory exists', async () => {
            jest.spyOn(require('fs').promises, 'lstat').mockResolvedValue({} as any);
            await expect((service as any).ensureDirectoryExists('/tmp')).resolves.toBeUndefined();
            });

            it('should throw if directory does not exist', async () => {
            jest.spyOn(require('fs').promises, 'lstat').mockRejectedValue(new Error('not found'));
            await expect((service as any).ensureDirectoryExists('/tmp')).rejects.toThrow('Directory does not exist: /tmp');
            });
        });

        describe('createFileIfNotExists', () => {
            it('should create file if not exists', async () => {
            jest.spyOn(require('fs').promises, 'open').mockResolvedValue({} as any);
            const createFileSpy = jest.spyOn(service, 'createFile').mockResolvedValue({} as any);
            await service.createFileIfNotExists('/tmp', 'testfile', 'jobid', 'resultid');
            expect(createFileSpy).toHaveBeenCalled();
            });

            it('should not throw if file exists', async () => {
            const error = new Error('exists') as any;
            error.code = 'EEXIST';
            jest.spyOn(require('fs').promises, 'open').mockRejectedValue(error);
            const createFileSpy = jest.spyOn(service, 'createFile');
            await expect(service.createFileIfNotExists('/tmp', 'testfile', 'jobid', 'resultid')).resolves.toBeUndefined();
            expect(createFileSpy).not.toHaveBeenCalled();
            });

            it('should throw for other errors', async () => {
            const error = new Error('fail') as any;
            error.code = 'OTHER';
            jest.spyOn(require('fs').promises, 'open').mockRejectedValue(error);
            await expect(service.createFileIfNotExists('/tmp', 'testfile', 'jobid', 'resultid')).rejects.toThrow('fail');
            });
        });

        describe('readTest', () => {
            it('should call readFile with correct params', async () => {
                const readFileSpy = jest.spyOn(service, 'readFile').mockResolvedValue({ foo: 'bar' });
                (WorkersConfig.get as jest.Mock).mockReturnValue('testfile');
                const fsDetails = { workingDirectory: '/tmp' };
                const result = await service.readTest(fsDetails as any, 'trace', 'vol', 'res');
                expect(readFileSpy).toHaveBeenCalledWith('/tmp/trace/vol', 'testfile', 'trace', 'res');
                expect(result).toEqual({ foo: 'bar' });
            });

            it('should handle errors in readFile', async () => {
                jest.spyOn(service, 'readFile').mockRejectedValue(new Error('fail'));
                const fsDetails = { workingDirectory: '/tmp' };
                await expect(service.readTest(fsDetails as any, 'trace', 'vol', 'res')).rejects.toThrow('fail');
            });

            it('Should throw getSpeedTestJobContext failure', async () => {
                mockRedisService.getSpeedTestJobContext.mockRejectedValue(new Error('fail'));
                const fsDetails = { workingDirectory: '/tmp' };
                await expect(service.readTest(fsDetails as any, 'trace', 'vol', 'res')).rejects.toThrow('fail');
            });
        });

        describe('writeTest', () => {
            it('should call createFile with correct params', async () => {
            const createFileSpy = jest.spyOn(service, 'createFile').mockResolvedValue({ foo: 'bar' });
            (WorkersConfig.get as jest.Mock).mockReturnValue('testfile');
            const fsDetails = { workingDirectory: '/tmp' };
            const result = await service.writeTest(fsDetails as any, 'trace', 'vol', 'res');
            expect(createFileSpy).toHaveBeenCalledWith('/tmp/trace/vol', 'testfile', 'trace', 'res');
            expect(result).toEqual({ foo: 'bar' });
            });
        });
    });
});