import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { SetupActivityService } from '../activities/setup-worker/setup.activity.service';
import { AuthService } from '../auth/auth.service';
import { Protocols } from '../protocols/protocols';
import { NFSProtocol } from '../protocols/nfs/nfs.protocol';
import { SMBProtocol } from '../protocols/smb/smb.protocol';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { RedisService } from '../redis/redis.service';
import { WinShellService } from '../activities/common/win-shell.service';
import { RetryableError } from '../errors/errors.types';
import { JobStatus } from '@netapp-cloud-datamigrate/jobs-lib';

jest.mock('axios');

/**
 * Real classes wired together:
 *   SetupActivityService.cleanup → Protocols → NFSProtocol / SMBProtocol (unmountPath)
 *                                → RedisService (getJobManagerContext, getJobState)
 *
 * Mocked boundaries:
 *   RedisService              — returns job context and job state
 *   NFSProtocol.unmountPath   — shell/fs boundary
 *   SMBProtocol.unmountPath   — shell/fs boundary
 *
 * Key difference from setup: cleanup throws RetryableError on any failure
 * (never returns a silent error shape) so Temporal can schedule a retry.
 */

const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const mockLoggerFactory: LoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
} as any;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.workerId': 'worker-1',
      'worker.baseWorkingPath': '/mnt/worker',
      'worker.connection.workerConfigUrl': 'http://worker-config',
      'worker.projectId': 'proj-abc',
      'worker.baseMountDir': '/mnt',
      'worker.platform': 'linux',
      'keycloak': {
        baseUrl: 'http://keycloak',
        realm: 'ndm',
        workerSecret: 'secret',
      },
    };
    return map[key];
  }),
};

const mockRedisService = {
  getJobManagerContext: jest.fn(),
  getJobState: jest.fn(),
};

const mockWinShellService = {
  executeCommand: jest.fn(),
};

const mockHttpService = {
  post: jest.fn(),
};

function makeContext(srcProtocol = 'NFS', withDestination = false) {
  const src = {
    hostname: '10.0.0.1',
    username: 'admin',
    password: 'pass',
    protocolVersion: '3',
    path: '/vol/src',
    pathId: 'pid-src',
    protocols: [{ type: srcProtocol }],
  };
  const dest = withDestination
    ? {
        hostname: '10.0.0.2',
        username: 'admin',
        password: 'pass',
        protocolVersion: '3',
        path: '/vol/dest',
        pathId: 'pid-dest',
        protocols: [{ type: srcProtocol }],
      }
    : undefined;

  return {
    jobConfig: {
      sourceFileServer: src,
      ...(dest ? { destinationFileServer: dest } : {}),
      options: {},
    },
  };
}

describe('Component: cleanup (SetupActivityService)', () => {
  let activity: SetupActivityService;
  let nfsProtocol: NFSProtocol;
  let smbProtocol: SMBProtocol;

  beforeEach(async () => {
    jest.clearAllMocks();

    new WorkersConfig(mockConfigService as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupActivityService,
        AuthService,
        Protocols,
        NFSProtocol,
        SMBProtocol,
        { provide: ConfigService,   useValue: mockConfigService },
        { provide: LoggerFactory,   useValue: mockLoggerFactory },
        { provide: HttpService,     useValue: mockHttpService },
        { provide: RedisService,    useValue: mockRedisService },
        { provide: WinShellService, useValue: mockWinShellService },
      ],
    }).compile();

    activity    = module.get<SetupActivityService>(SetupActivityService);
    nfsProtocol = module.get<NFSProtocol>(NFSProtocol);
    smbProtocol = module.get<SMBProtocol>(SMBProtocol);
  });

  // ─── H1: NFS source-only — unmountPath called once, returns success ───────

  it('H1 — Worker tears down a single NFS source path — verify Redis context is fetched, the real routing switch picks NFSProtocol, the unmount command runs once, and a success response is returned', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', false));
    mockRedisService.getJobState.mockResolvedValue({ status: JobStatus.Running });
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);

    const result = await activity.cleanup('job-c01');

    // Real Protocols.getProtocol routed to NFSProtocol
    expect(nfsProtocol.unmountPath).toHaveBeenCalledTimes(1);
    expect(nfsProtocol.unmountPath).toHaveBeenCalledWith(
      'job-c01',
      expect.objectContaining({ hostname: '10.0.0.1', path: '/vol/src' }),
      true,
    );
    expect(result.status).toBe('success');
    expect(result.workerId).toBe('worker-1');
  });

  // ─── H2: NFS source + destination — unmountPath called twice ─────────────

  it('H2 — Job has both a source and a destination path — verify the unmount command runs twice, for source and then for destination', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', true));
    mockRedisService.getJobState.mockResolvedValue({ status: JobStatus.Running });
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);

    const result = await activity.cleanup('job-c02');

    expect(nfsProtocol.unmountPath).toHaveBeenCalledTimes(2);
    expect(nfsProtocol.unmountPath).toHaveBeenCalledWith(
      'job-c02',
      expect.objectContaining({ hostname: '10.0.0.1', path: '/vol/src' }),
      true,
    );
    expect(nfsProtocol.unmountPath).toHaveBeenCalledWith(
      'job-c02',
      expect.objectContaining({ hostname: '10.0.0.2', path: '/vol/dest' }),
      true,
    );
    expect(result.status).toBe('success');
  });

  // ─── H3: Job is Paused — unmount runs, context cleanup step skipped ───────

  it('H3 — Job is in Paused state — verify the unmount still runs normally but the context cleanup step is skipped, and the activity still returns success', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', false));
    mockRedisService.getJobState.mockResolvedValue({ status: JobStatus.Paused });
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);

    const result = await activity.cleanup('job-c03');

    expect(nfsProtocol.unmountPath).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(mockLogger.log).not.toHaveBeenCalledWith(
      expect.stringContaining('Cleaning up job context'),
    );
  });

  // ─── N1: Redis returns null context → throws RetryableError ──────────────

  it('N1 — Redis has no context for this job run ID — verify the activity throws a RetryableError with "Context not found" so Temporal can retry the cleanup later (unlike setup, there is no silent error response here)', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(null);

    await expect(activity.cleanup('job-c04')).rejects.toBeInstanceOf(RetryableError);
    await expect(activity.cleanup('job-c04')).rejects.toThrow('Context not found');
    // Temporal will retry — no partial state written
    expect(mockRedisService.getJobState).not.toHaveBeenCalled();
  });

  // ─── N2: unmountPath throws → throws RetryableError ──────────────────────

  it('N2 — The NFS unmount command fails — verify the error is wrapped in a RetryableError and thrown so Temporal retries, rather than silently returning an error shape', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', false));
    jest.spyOn(nfsProtocol, 'unmountPath').mockRejectedValue(
      new Error('umount: /mnt/worker/vol/src: target is busy'),
    );

    await expect(activity.cleanup('job-c05')).rejects.toBeInstanceOf(RetryableError);
    await expect(activity.cleanup('job-c05')).rejects.toThrow('target is busy');
  });

  // ─── N3: getJobState throws after unmount succeeds → RetryableError ───────

  it('N3 — RedisService.getJobState throws after the unmount already succeeded — verify the failure is still caught and re-thrown as a RetryableError', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', false));
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);
    mockRedisService.getJobState.mockRejectedValue(new Error('Redis connection lost'));

    await expect(activity.cleanup('job-c06')).rejects.toBeInstanceOf(RetryableError);
    await expect(activity.cleanup('job-c06')).rejects.toThrow('Redis connection lost');
    // unmount DID run before the failure
    expect(nfsProtocol.unmountPath).toHaveBeenCalled();
  });
});
