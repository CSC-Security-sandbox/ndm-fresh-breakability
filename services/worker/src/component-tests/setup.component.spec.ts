import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { SetupActivityService } from '../activities/setup-worker/setup.activity.service';
import { AuthService } from '../auth/auth.service';
import { Protocols } from '../protocols/protocols';
import { NFSProtocol } from '../protocols/nfs/nfs.protocol';
import { SMBProtocol } from '../protocols/smb/smb.protocol';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { RedisService } from '../redis/redis.service';
import { WinShellService } from '../activities/common/win-shell.service';

jest.mock('axios');
import axios from 'axios';

/**
 * Real classes wired together:
 *   SetupActivityService → Protocols → NFSProtocol / SMBProtocol
 *                        → AuthService → HttpService (Keycloak)
 *                        → axios.post (config update)
 *
 * Mocked boundaries:
 *   RedisService           — Redis, returns job context
 *   NFSProtocol.mountPath  — fs/shell boundary (NFS mount command)
 *   SMBProtocol.mountPath  — fs/shell boundary (SMB mount command)
 *   HttpService.post       — HTTP boundary (Keycloak token fetch via AuthService)
 *   axios.post             — HTTP boundary (worker config update API)
 *   WinShellService        — child_process boundary (PowerShell pool; complex init)
 *
 * What this covers beyond the existing unit test:
 *   - UT mocks Protocols entirely (jest.mock + jest.spyOn) so the real getProtocol()
 *     routing switch (NFS vs SMB) is never called.
 *   - UT mocks AuthService.getAccessToken directly; the real class is never exercised.
 *     This test wires real AuthService so the Keycloak HTTP contract — token extraction
 *     from response.data.access_token, null handling on failure, Bearer header
 *     construction — is verified through the actual code path.
 *   - UT does not confirm that axios.post receives the correct Authorization header
 *     with projectId (the UT assertion omits projectId because mockConfigService
 *     returns undefined for that key and the test passes through loose equality).
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

// Keycloak config required by AuthService constructor
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

// WinShellService wraps child_process PowerShell — provide as boundary mock
const mockWinShellService = {
  executeCommand: jest.fn(),
};

// Helper: build a minimal job context for setup()
function makeContext(
  srcProtocol = 'NFS',
  withDestination = false,
  preservePermissions = false,
) {
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
      options: { preservePermissions },
    },
  };
}

describe('Component: setup (SetupActivityService)', () => {
  let activity: SetupActivityService;
  let nfsProtocol: NFSProtocol;
  let smbProtocol: SMBProtocol;
  let mockHttpService: { post: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    // WorkersConfig singleton must exist before NFSProtocol/SMBProtocol constructors run
    new WorkersConfig(mockConfigService as any);

    mockHttpService = {
      post: jest.fn().mockReturnValue(
        of({ data: { access_token: 'mock-token-abc', expires_in: 300 } }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupActivityService,    // REAL
        AuthService,             // REAL — calls HttpService.post to Keycloak
        Protocols,               // REAL — routes NFS/SMB via switch
        NFSProtocol,             // REAL class, mountPath/unmountPath mocked per test
        SMBProtocol,             // REAL class, mountPath/unmountPath mocked per test
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

    // Skip 1-second waitFor delays inside setup()
    jest.spyOn(activity, 'waitFor').mockResolvedValue(undefined);
  });

  // ─── H1: NFS source-only — full chain succeeds ───────────────────────────

  it('H1 — NFS source-only: full chain succeeds, Bearer token stamped on axios.post', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', false));
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    (axios.post as jest.Mock).mockResolvedValue({});

    const result = await activity.setup('job-001');

    // Real Protocols.getProtocol routed to NFSProtocol
    expect(nfsProtocol.mountPath).toHaveBeenCalledTimes(1);
    expect(nfsProtocol.mountPath).toHaveBeenCalledWith(
      'job-001',
      expect.objectContaining({ hostname: '10.0.0.1', path: '/vol/src' }),
      true,
    );

    // Real AuthService fetched token from mocked Keycloak HttpService.post
    expect(mockHttpService.post).toHaveBeenCalledWith(
      expect.stringContaining('/protocol/openid-connect/token'),
      expect.any(String),
      expect.any(Object),
    );

    // axios.post carries the Bearer token extracted by real AuthService
    expect(axios.post).toHaveBeenCalledWith(
      'http://worker-config/api/v1/work-manager/update/configs',
      { jobRunId: 'job-001', workerId: 'worker-1' },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token-abc',
          projectId: 'proj-abc',
        }),
      }),
    );

    expect(result.status).toBe('success');
    expect(result.workerId).toBe('worker-1');
  });

  // ─── H2: NFS source + destination — mountPath called twice ───────────────

  it('H2 — NFS with destination: mountPath called for source AND destination', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', true));
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    (axios.post as jest.Mock).mockResolvedValue({});

    const result = await activity.setup('job-002');

    expect(nfsProtocol.mountPath).toHaveBeenCalledTimes(2);
    // Source mounted first, then destination (correct order)
    expect(nfsProtocol.mountPath).toHaveBeenNthCalledWith(
      1,
      'job-002',
      expect.objectContaining({ hostname: '10.0.0.1', path: '/vol/src' }),
      true,
    );
    expect(nfsProtocol.mountPath).toHaveBeenNthCalledWith(
      2,
      'job-002',
      expect.objectContaining({ hostname: '10.0.0.2', path: '/vol/dest' }),
      true,
    );
    expect(result.status).toBe('success');
  });

  // ─── H3: SMB — real Protocols routes to SMBProtocol, not NFSProtocol ─────

  it('H3 — SMB protocol: real Protocols.getProtocol routes to SMBProtocol; NFSProtocol never called', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('SMB', false));
    jest.spyOn(smbProtocol, 'mountPath').mockResolvedValue(undefined);
    const nfsSpy = jest.spyOn(nfsProtocol, 'mountPath');
    (axios.post as jest.Mock).mockResolvedValue({});

    const result = await activity.setup('job-003');

    expect(smbProtocol.mountPath).toHaveBeenCalled();
    expect(nfsSpy).not.toHaveBeenCalled(); // confirms routing switch worked correctly
    expect(result.status).toBe('success');
  });

  // ─── N1: Redis returns null context → error response ─────────────────────

  it('N1 — Redis returns null: returns error "Context not found", does not throw', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(null);

    const result = await activity.setup('job-004');

    expect(result.status).toBe('error');
    expect(result.message).toContain('Context not found');
    expect(result.workerId).toBe('worker-1');
  });

  // ─── N2: mountPath throws → error response ───────────────────────────────

  it('N2 — NFSProtocol.mountPath throws: returns error response, does not throw', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', false));
    jest.spyOn(nfsProtocol, 'mountPath').mockRejectedValue(
      new Error('mount: 10.0.0.1:/vol/src failed: No route to host'),
    );

    const result = await activity.setup('job-005');

    expect(result.status).toBe('error');
    expect(result.message).toContain('No route to host');
    expect(result.workerId).toBe('worker-1');
  });

  // ─── N3: Keycloak HTTP fails → AuthService returns null → error ──────────

  it('N3 — Keycloak HTTP fails: real AuthService returns null, setup returns "Failed to get access token"', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', false));
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);

    // Simulate Keycloak being unreachable — real AuthService catches this and returns null
    mockHttpService.post.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

    const result = await activity.setup('job-006');

    expect(result.status).toBe('error');
    expect(result.message).toContain('Failed to get access token');
    // Config-update API must NOT be called after auth failure
    expect(axios.post).not.toHaveBeenCalled();
  });

  // ─── N4: axios.post (config update) throws after mount succeeds ──────────

  it('N4 — axios.post (config update) fails after successful mount: returns error response', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeContext('NFS', false));
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    (axios.post as jest.Mock).mockRejectedValue(new Error('Network error on config update'));

    const result = await activity.setup('job-007');

    // Mount succeeded, auth token fetched, but config update failed — still error shape
    expect(result.status).toBe('error');
    expect(result.message).toContain('Network error on config update');
    expect(nfsProtocol.mountPath).toHaveBeenCalled(); // mount DID run before error
  });

  // ─── N5: unsupported protocol type in Redis context → routing throws ──────

  it('N5 — unsupported protocol type in context: Protocols.getProtocol throws, returns error response', async () => {
    const ctx = makeContext('FTP', false); // FTP not in ProtocolTypes enum
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const result = await activity.setup('job-008');

    expect(result.status).toBe('error');
    expect(result.message).toContain('Unsupported protocol type');
  });
});
