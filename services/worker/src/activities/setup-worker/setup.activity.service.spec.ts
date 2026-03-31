import { JobStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import axios from 'axios';
import { RetryableError } from 'src/errors/errors.types';
import { Protocols } from 'src/protocols/protocols';
import { SetupActivityService } from './setup.activity.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { SMBProtocol } from '../../protocols/smb/smb.protocol';
import { NFSProtocol } from '../../protocols/nfs/nfs.protocol';
import { mockLogger } from 'src/auth/auth.service.spec';
import { WinShellService } from '../common/win-shell.service';

let loggerFactory: LoggerFactory;

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

const mockProtocol = {
    mountPath: jest.fn(),
    unmountPath: jest.fn()
};

const mockWinShellService = {
    executeCommand: jest.fn().mockResolvedValue({ stdout: 'True', stderr: '' }),
};

const mockWorkManagerService = {
    fetchWorkerConfiguration: jest.fn(),
    getWorkerIdentity: jest.fn().mockReturnValue('worker-123'),
    getWorkerId: jest.fn().mockReturnValue('worker-123'),
    startWorker: jest.fn(),
    getWorker: jest.fn().mockReturnValue({
        identity: 'worker-123',
        taskQueue: 'worker-task-queue',
        connection: {
            close: jest.fn()
        }
    }),
    shutdownWorker: jest.fn(),
    createWorkerOptions: jest.fn()
}

describe('SetupActivityService', () => {
    let service: SetupActivityService;
    let protocols: Protocols;

    beforeEach(() => {
        jest.clearAllMocks();

        mockConfigService.get.mockImplementation((key: string) => {
            if (key === 'worker.workerId') return 'worker-123';
            if (key === 'worker.baseWorkingPath') return '/mnt/worker';
            if (key === 'worker.connection.workerConfigUrl') return 'http://worker-config';
            return undefined;
        });

        loggerFactory = {
            create: jest.fn().mockReturnValue({
                log: jest.fn(),
                debug: jest.fn(),
                error: jest.fn(),
            }),
        } as any;

        protocols = new Protocols(
            new NFSProtocol(loggerFactory),
            new SMBProtocol(loggerFactory)
        );

        jest.spyOn(protocols, 'getProtocol').mockReturnValue({
            mountPath: mockProtocol.mountPath,
            unmountPath: mockProtocol.unmountPath,
        } as any);

        service = new SetupActivityService(
            mockConfigService as any,
            mockAuthService as any,
            mockRedisService as any,
            loggerFactory as LoggerFactory,
            protocols as Protocols,
            mockWinShellService as unknown as WinShellService,
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
            }), true);
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
                jobRunId: 'job-2',
            }), true);
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
                { jobRunId: 'job-3', workerId: 'worker-123' },
                { headers: { projectId: undefined } }
            );
        });

        it('should return error on exception', async () => {
            (protocols.getProtocol as jest.Mock).mockImplementation(() => { throw new Error('fail'); });
            const args = { jobRunId: 'job-4', protocolType: 'NFS' } as any;
            const result = await service.speedTestSetup(args);
            expect(result.status).toBe('error');
            expect(result.message).toContain('fail');
        });

        it('should handle missing WorkersConfig.get', async () => {
            const args = {
                jobRunId: 'job-config',
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
            (require('src/config/app.config').WorkersConfig.get as jest.Mock).mockReturnValue(undefined);
            (axios.post as jest.Mock).mockResolvedValue({});
            mockProtocol.mountPath.mockResolvedValue(undefined);

            const result = await service.speedTestSetup(args);
            expect(result.status).toBe('success');
        });

        it('should handle axios post failure', async () => {
            const args = {
                jobRunId: 'job-axios-fail',
                protocolType: 'NFS',
                hostname: 'host',
                protocols: [],
                pathId: 'pid',
                path: '/data',
                userName: 'user',
                password: 'pass'
            } as any;
            (require('src/config/app.config').WorkersConfig.get as jest.Mock).mockReturnValue('/mnt/worker');
            (axios.post as jest.Mock).mockRejectedValue(new Error('Network error'));
            mockProtocol.mountPath.mockResolvedValue(undefined);

            const result = await service.speedTestSetup(args);
            expect(result.status).toBe('error');
            expect(result.message).toContain('Network error');
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

        it('should handle setup without destination file server', async () => {
            const context = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] }
                    // No destinationFileServer
                }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockAuthService.getAccessToken.mockResolvedValue('token');
            (axios.post as jest.Mock).mockResolvedValue({});
            mockProtocol.mountPath.mockResolvedValue(undefined);

            const result = await service.setup('job-no-dest');
            expect(result.status).toBe('success');
            expect(mockProtocol.mountPath).toHaveBeenCalledTimes(1); // Only source
        });

        it('should handle axios error in setup', async () => {
            const context = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] }
                }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockAuthService.getAccessToken.mockResolvedValue('token');
            (axios.post as jest.Mock).mockRejectedValue(new Error('API error'));
            mockProtocol.mountPath.mockResolvedValue(undefined);

            const result = await service.setup('job-api-error');
            expect(result.status).toBe('error');
            expect(result.message).toContain('API error');
        });

        it('should handle mountPath error', async () => {
            const context = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] }
                }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockProtocol.mountPath.mockRejectedValue(new Error('Mount failed'));

            const result = await service.setup('job-mount-error');
            expect(result.status).toBe('error');
            expect(result.message).toContain('Mount failed');
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
            (protocols.getProtocol as jest.Mock).mockImplementation(() => { throw new Error('fail'); });
            const result = await service.speedTestCleanup('job-9', {} as any, 'NFS');
            expect(result.status).toBe('error');
            expect(result.message).toContain('fail');
        });

        it('should handle unmountPath error', async () => {
            mockProtocol.unmountPath.mockRejectedValue(new Error('Unmount failed'));
            const result = await service.speedTestCleanup('job-unmount-error', {} as any, 'NFS');
            expect(result.status).toBe('error');
            expect(result.message).toContain('Unmount failed');
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

        it('should handle cleanup without destination file server', async () => {
            const context = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] }
                    // No destinationFileServer
                }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockRedisService.getJobState.mockResolvedValue({ status: JobStatus.Completed });
            mockProtocol.unmountPath.mockResolvedValue(undefined);

            const result = await service.cleanup('job-no-dest-cleanup');
            expect(result.status).toBe('success');
            expect(mockProtocol.unmountPath).toHaveBeenCalledTimes(1); // Only source
        });

        it('should handle source unmount failure', async () => {
            const context = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] }
                }
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(context);
            mockProtocol.unmountPath.mockRejectedValue(new Error('Source unmount failed'));

            await expect(service.cleanup('job-source-fail')).rejects.toThrow(RetryableError);
        });

        it('should handle general cleanup error', async () => {
            mockRedisService.getJobManagerContext.mockRejectedValue(new Error('Redis error'));

            await expect(service.cleanup('job-redis-error')).rejects.toThrow(RetryableError);
        });
    });

    describe('validateDomainJoin (via setup)', () => {
        const smbContext = {
            jobConfig: {
                sourceFileServer: { protocols: [{ type: 'NFS' }] },
                destinationFileServer: { protocols: [{ type: 'SMB' }] },
                options: { preservePermissions: true },
            },
        };

        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
            mockRedisService.getJobManagerContext.mockResolvedValue(smbContext);
            mockAuthService.getAccessToken.mockResolvedValue('token');
            (axios.post as jest.Mock).mockResolvedValue({});
            mockProtocol.mountPath.mockResolvedValue(undefined);
        });

        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: process.platform, writable: true });
        });

        it('should pass when worker is domain-joined', async () => {
            mockWinShellService.executeCommand.mockResolvedValue({ stdout: 'True', stderr: '' });
            const result = await service.setup('job-domain-ok');
            expect(result.status).toBe('success');
        });

        it('should fail when worker is not domain-joined', async () => {
            mockWinShellService.executeCommand.mockResolvedValue({ stdout: 'False', stderr: '' });
            const result = await service.setup('job-not-joined');
            expect(result.status).toBe('error');
            expect(result.message).toContain('not joined to a domain');
        });

        it('should fail when executeCommand returns stderr', async () => {
            mockWinShellService.executeCommand.mockResolvedValue({ stdout: '', stderr: 'Access denied' });
            const result = await service.setup('job-domain-stderr');
            expect(result.status).toBe('error');
            expect(result.message).toContain('Failed to check domain join status');
        });

        it('should skip validation when preservePermissions is false', async () => {
            const nopermContext = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] },
                    destinationFileServer: { protocols: [{ type: 'SMB' }] },
                    options: { preservePermissions: false },
                },
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(nopermContext);
            const result = await service.setup('job-no-perms');
            expect(result.status).toBe('success');
            expect(mockWinShellService.executeCommand).not.toHaveBeenCalled();
        });

        it('should skip validation for non-SMB destination', async () => {
            const nfsContext = {
                jobConfig: {
                    sourceFileServer: { protocols: [{ type: 'NFS' }] },
                    destinationFileServer: { protocols: [{ type: 'NFS' }] },
                    options: { preservePermissions: true },
                },
            };
            mockRedisService.getJobManagerContext.mockResolvedValue(nfsContext);
            const result = await service.setup('job-nfs-dest');
            expect(result.status).toBe('success');
            expect(mockWinShellService.executeCommand).not.toHaveBeenCalled();
        });
    });
});