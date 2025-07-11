
import { ConfigService } from '@nestjs/config';
import { FileServerDetails, JobStatus } from '@netapp-cloud-datamigrate/jobs-lib';
import { JobState } from '@netapp-cloud-datamigrate/jobs-lib/dist/types/job-state';
import axios from 'axios';
import { AuthService } from 'src/auth/auth.service';
import { WorkersConfig } from 'src/config/app.config';
import { RedisService } from 'src/redis/redis.service';
import { SetupActivityService } from './setup.activity.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { Protocols } from 'src/protocols/protocols';
import { SMBProtocol } from '../../protocols/smb/smb.protocol';
import { NFSProtocol } from '../../protocols/nfs/nfs.protocol';

let loggerFactory: LoggerFactory;
jest.mock('axios');

describe('SetupActivityService', () => {
  let service: SetupActivityService;
  let mockConfig: Partial<ConfigService>;
  let mockAuth: Partial<AuthService>;
  let mockRedis: Partial<RedisService>;
  let protocolMount: jest.Mock;
  let protocolUnmount: jest.Mock;
  let protocols: Protocols;

  beforeEach(() => {
    jest.resetAllMocks();

    // Mock ConfigService
    mockConfig = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'worker.workerId': return 'worker-1';
          case 'worker.baseWorkingPath': return '/mnt/work';
          case 'worker.connection.workerConfigUrl': return 'http://config-service';
          default: return null;
        }
      }),
    };
        
    // Mock WorkersConfig
    new WorkersConfig(mockConfig as ConfigService);

    // Mock WorkersConfig
    new WorkersConfig(mockConfig as ConfigService);

    // Mock AuthService
    mockAuth = {
      getAccessToken: jest.fn().mockResolvedValue('token-123'),
    };

    // Mock RedisService
    mockRedis = {
      getJobContext: jest.fn(),
      getJobState: jest.fn(),
      setJobContext: jest.fn(),
    };

    // Mock Protocols
    protocolMount = jest.fn().mockResolvedValue(undefined);
    protocolUnmount = jest.fn().mockResolvedValue(undefined);

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
      mountPath: protocolMount,
      unmountPath: protocolUnmount,
    } as any);
  
    service = new SetupActivityService(
      mockConfig as ConfigService,
      mockAuth as AuthService,
      mockRedis as RedisService,
      loggerFactory as LoggerFactory,
      protocols as Protocols,
    );
  });

  describe('speedTestSetup', () => {
    const params = {
      jobRunId: 'job1',
      protocolType: 'SFTP',
      hostname: 'host1',
      protocols: [],
      pathId: 'pid',
      path: '/data',
      userName: 'user',
      password: 'pass',
      fileServerId: 'fs1',
      volumeId: 'vol1',
      tests: ['t1'],
    } as any;

    it('completes successfully', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

      const result = await service.speedTestSetup(params);

      expect(protocolMount).toHaveBeenCalledWith('job1', expect.any(Object));
      expect(axios.post).toHaveBeenCalledWith(
        'http://config-service/api/v1/work-manager/update/configs',
        { jobRunId: 'job1', workerId: 'worker-1' },
      );
      expect(result.status).toBe('success');
      expect(result.fsDetails).toBeInstanceOf(FileServerDetails);
      expect(result.tests).toEqual(['t1']);
    });

    it('returns error when mountPath fails', async () => {
      protocolMount.mockRejectedValue(new Error('mount-error'));

      const result = await service.speedTestSetup(params);
      expect(result.status).toBe('error');
      expect(result.message).toContain('mount-error');
    });

    it('returns error when axios fails', async () => {
      (axios.post as jest.Mock).mockRejectedValue(new Error('post-error'));

      const result = await service.speedTestSetup(params);
      expect(result.status).toBe('error');
      expect(result.message).toContain('post-error');
    });
  });

  describe('setup', () => {
    const jobRunId = 'job2';
    let context: any;
    let state: JobState;

    beforeEach(() => {
      context = {
        jobConfig: {
          sourceFileServer: { protocols: [{ type: 'SFTP' }], hostname: 'src', username: 'u', password: 'p', path: '/src', protocolVersion: 'v1', pathId: 'sp1' },
          destinationFileServer: { protocols: [{ type: 'SFTP' }], hostname: 'dst', username: 'du', password: 'dp', path: '/dst', protocolVersion: 'v1', pathId: 'dp1' },
        },
      };
      state = new JobState([], 0, 0, [],  JobStatus.Running, []);
      (mockRedis.getJobContext as jest.Mock).mockResolvedValue(context);
      (mockRedis.getJobState as jest.Mock).mockResolvedValue(state);
    });

    it('errors when no context found', async () => {
      (mockRedis.getJobContext as jest.Mock).mockResolvedValue(null);

      const result = await service.setup(jobRunId);
      expect(result.status).toBe('error');
      expect(result.message).toContain('Context not found');
    });

    it('mounts both paths and updates state', async () => {
      (axios.post as jest.Mock).mockResolvedValue({});

      await service.setup(jobRunId);

      expect(protocolMount).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenCalledWith(
        'http://config-service/api/v1/work-manager/update/configs',
        { jobRunId, workerId: 'worker-1' },
        { headers: { Authorization: 'Bearer token-123' } },
      );
    });

    it('errors when accessToken is null', async () => {
      (mockAuth.getAccessToken as jest.Mock).mockResolvedValue(null);

      const result = await service.setup(jobRunId);
      expect(result.status).toBe('error');
      expect(result.message).toContain('Failed to get access token');
    });
  });

  describe('speedTestCleanup', () => {
    const jobRunId = 'job3';
    let fsDetails: FileServerDetails;

    beforeEach(() => {
      fsDetails = new FileServerDetails('h', [], 'pid', '/mnt', 'u', 'p', '/mnt');
    });

    it('unmounts successfully', async () => {
      const res = await service.speedTestCleanup(jobRunId, fsDetails, 'SFTP');
      expect(protocolUnmount).toHaveBeenCalledWith('job3', expect.any(Object));
      expect(res.status).toBe('success');
    });

    it('returns error when unmountPath fails', async () => {
      protocolUnmount.mockRejectedValue(new Error('umount-error'));
      const res = await service.speedTestCleanup(jobRunId, fsDetails, 'SFTP');
      expect(res.status).toBe('error');
      expect(res.message).toContain('umount-error');
    });
  });

  describe('cleanup', () => {
    const jobRunId = 'job4';
    let context: any;
    let state: JobState;

    beforeEach(() => {
      context = { jobConfig: { sourceFileServer: { protocols: [{ type: 'SFTP' }], hostname: 'src', username: 'u', password: 'p', path: '/src', protocolVersion: 'v1', pathId: 'sp1' } } };
      state = new JobState([], 0, 0, [], JobStatus.Running, []);
      (mockRedis.getJobContext as jest.Mock).mockResolvedValue(context);
      (mockRedis.getJobState as jest.Mock).mockResolvedValue(state);
    });

    it('errors when context missing', async () => {
      (mockRedis.getJobContext as jest.Mock).mockResolvedValue(null);
      const res = await service.cleanup(jobRunId);
      expect(res.status).toBe('error');
      expect(res.message).toContain('Context not found');
    });

    it('unmounts source and succeeds without dest', async () => {
      const res = await service.cleanup(jobRunId);
      expect(protocolUnmount).toHaveBeenCalledTimes(1);
      expect(res.status).toBe('success');
    });

    it('returns error when dest unmount fails', async () => {
      context.jobConfig.destinationFileServer = context.jobConfig.sourceFileServer;
      protocolUnmount.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('dest-umount-fail'));
      const res = await service.cleanup(jobRunId);
      expect(res.status).toBe('error');
      expect(res.message).toContain('dest-umount-fail');
    });
  });
});
