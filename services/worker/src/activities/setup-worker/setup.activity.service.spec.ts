import { JobStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import axios from 'axios';
import { RetryableError } from 'src/errors/errors.types';
import { Protocols } from 'src/protocols/protocols';
import { SetupActivityService } from './setup.activity.service';

jest.mock('axios');
jest.mock('src/protocols/protocols');
jest.mock('@netapp-cloud-datamigrate/jobs-lib');
jest.mock('src/config/app.config', () => ({
    WorkersConfig: { get: jest.fn() }
}));

const mockConfigService = {
    get: jest.fn()
};
const mockAuthService = {
    getAccessToken: jest.fn()
};
const mockRedisService = {
    getJobManagerContext: jest.fn(),
    getJobState: jest.fn()
};
const mockLogger = {
    log: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
};

const mockProtocol = {
    mountPath: jest.fn(),
    unmountPath: jest.fn()
};

describe('SetupActivityService', () => {
    let service: SetupActivityService;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigService.get.mockImplementation((key: string) => {
            if (key === 'worker.workerId') return 'worker-123';
            if (key === 'worker.baseWorkingPath') return '/mnt/worker';
            if (key === 'worker.connection.workerConfigUrl') return 'http://worker-config';
            return undefined;
        });
        (Protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);
        service = new SetupActivityService(
            mockConfigService as any,
            mockAuthService as any,
            mockRedisService as any,
            mockLogger as any
        );
    });

    describe('mountPath', () => {
        it('should call protocol.mountPath with correct params', async () => {
            const server = {
                hostname: 'host',
                username: 'user',
                password: 'pass',
                protocolVersion: 'v1',
                path: '/data',
                pathId: 'pid'
            } as any;
            await service.mountPath(server, mockProtocol as any, 'job-1');
            expect(mockProtocol.mountPath).toHaveBeenCalledWith('job-1', expect.objectContaining({
                hostname: 'host',
                username: 'user',
                password: 'pass',
                protocolVersion: 'v1',
                path: '/data',
                mountBasePath: '/mnt/worker',
                pathId: 'pid',
                jobRunId: 'job-1'
            }));
        });
    });

    describe('unmountPath', () => {
        it('should call protocol.unmountPath with correct params', async () => {
            const server = {
                hostname: 'host',
                username: 'user',
                password: 'pass',
                protocolVersion: 'v1',
                path: '/data',
                pathId: 'pid'
            } as any;
            await service.unmountPath(server, mockProtocol as any, 'job-2');
            expect(mockProtocol.unmountPath).toHaveBeenCalledWith('job-2', expect.objectContaining({
                hostname: 'host',
                username: 'user',
                password: 'pass',
                protocolVersion: 'v1',
                path: '/data',
                mountBasePath: '/mnt/worker',
                pathId: 'pid',
                jobRunId: 'job-2'
            }));
        });
    });

    describe('waitFor', () => {
        it('should resolve after given milliseconds', async () => {
            const start = Date.now();
            await service.waitFor(10);
            expect(Date.now() - start).toBeGreaterThanOrEqual(10);
        });
    });

    describe('speedTestSetup', () => {
        it('should return success on happy path', async () => {
            const args = {
                jobRunId: 'job-3',
                protocolType: 'NFS',
                hostname: 'host',
                protocols: [],
                pathId: 'pid',
                path: '/data',
                userName: 'user',
                password: 'pass',
                fileServerId: 'fsid',
                volumeId: 'volid',
                tests: []
            } as any;
            (require('src/config/app.config').WorkersConfig.get as jest.Mock).mockReturnValue('/mnt/worker');
            (axios.post as jest.Mock).mockResolvedValue({});
            mockProtocol.mountPath.mockResolvedValue(undefined);

            const result = await service.speedTestSetup(args);

            expect(result.status).toBe('success');
            expect(result.workerId).toBe('worker-123');
            expect(mockProtocol.mountPath).toHaveBeenCalled();
            expect(axios.post).toHaveBeenCalledWith(
                'http://worker-config/api/v1/work-manager/update/configs',
                { jobRunId: 'job-3', workerId: 'worker-123' }
            );
        });

        it('should return error on exception', async () => {
            (Protocols.getProtocol as jest.Mock).mockImplementation(() => { throw new Error('fail'); });
            const args = { jobRunId: 'job-4', protocolType: 'NFS' } as any;
            const result = await service.speedTestSetup(args);
            expect(result.status).toBe('error');
            expect(result.message).toContain('fail');
        });
    });

    describe('setup', () => {
        it('should return success when context and accessToken are valid', async () => {
            const context = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] },
                    destinationFileServer: { protocols: [{ type: 'NFS' }] }
                }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockAuthService.getAccessToken.mockResolvedValue('token');
            (axios.post as jest.Mock).mockResolvedValue({});
            mockProtocol.mountPath.mockResolvedValue(undefined);

            const result = await service.setup('job-5');
            expect(result.status).toBe('success');
            expect(mockProtocol.mountPath).toHaveBeenCalledTimes(2);
            expect(axios.post).toHaveBeenCalledWith(
                'http://worker-config/api/v1/work-manager/update/configs',
                { jobRunId: 'job-5', workerId: 'worker-123' },
                { headers: { Authorization: 'Bearer token' } }
            );
        });

        it('should return error if context is missing', async () => {
            mockRedisService.getJobManagerContext.mockResolvedValue(undefined);
            const result = await service.setup('job-6');
            expect(result.status).toBe('error');
            expect(result.message).toContain('Context not found');
        });

        it('should return error if accessToken is missing', async () => {
            const context = {
                jobConfig: { sourceFileServer: { protocols: [{ type: 'NFS' }] } }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockAuthService.getAccessToken.mockResolvedValue(undefined);
            const result = await service.setup('job-7');
            expect(result.status).toBe('error');
            expect(result.message).toContain('Failed to get access token');
        });
    });

    describe('speedTestCleanup', () => {
        it('should return success on happy path', async () => {
            mockProtocol.unmountPath.mockResolvedValue(undefined);
            const result = await service.speedTestCleanup('job-8', {} as any, 'NFS');
            expect(result.status).toBe('success');
            expect(mockProtocol.unmountPath).toHaveBeenCalled();
        });

        it('should return error on exception', async () => {
            (Protocols.getProtocol as jest.Mock).mockImplementation(() => { throw new Error('fail'); });
            const result = await service.speedTestCleanup('job-9', {} as any, 'NFS');
            expect(result.status).toBe('error');
            expect(result.message).toContain('fail');
        });
    });

    describe('cleanup', () => {
        it('should return success and cleanup job context if job is not paused', async () => {
            const context = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] },
                    destinationFileServer: { protocols: [{ type: 'NFS' }] }
                }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockRedisService.getJobState.mockResolvedValue({ status: JobStatus.Completed });
            mockProtocol.unmountPath.mockResolvedValue(undefined);

            const result = await service.cleanup('job-10');
            expect(result.status).toBe('success');
            expect(mockProtocol.unmountPath).toHaveBeenCalledTimes(2);
        });

        it('should return error if context is missing', async () => {
            mockRedisService.getJobManagerContext.mockResolvedValue(undefined);
            await expect(service.cleanup('job-11')).rejects.toThrow(RetryableError);
        });

        it('should return error if destination unmount fails', async () => {
            const context = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] },
                    destinationFileServer: { protocols: [{ type: 'NFS' }] }
                }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockRedisService.getJobState.mockResolvedValue({ status: JobStatus.Completed });
            mockProtocol.unmountPath
                .mockResolvedValueOnce(undefined)
                .mockImplementationOnce(() => { throw new Error('dest fail'); });

            const result = await service.cleanup('job-12');
            expect(result.status).toBe('error');
            expect(result.message).toContain('dest fail');
        });

        it('should not cleanup job context if job is paused', async () => {
            const context = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] }
                }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockRedisService.getJobState.mockResolvedValue({ status: JobStatus.Paused });
            mockProtocol.unmountPath.mockResolvedValue(undefined);

            const result = await service.cleanup('job-13');
            expect(result.status).toBe('success');
            expect(mockLogger.log).not.toHaveBeenCalledWith(expect.stringContaining('Cleaning up job context'));
        });
    });
});