import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { ValidatePathActivity } from '../activities/validate-path/validate-path.service';
import { AuthService } from '../auth/auth.service';
import { Protocols } from '../protocols/protocols';
import { NFSProtocol } from '../protocols/nfs/nfs.protocol';
import { SMBProtocol } from '../protocols/smb/smb.protocol';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

jest.mock('axios');
import axios from 'axios';

/**
 * Real classes wired:
 *   ValidatePathActivity → Protocols → NFSProtocol / SMBProtocol
 *                        → AuthService → HttpService (Keycloak)
 *
 * Mocked boundaries:
 *   NFSProtocol.mountPath / unmountPath — shell command
 *   SMBProtocol.mountPath / unmountPath — shell command
 *   HttpService.post                    — Keycloak token fetch via real AuthService
 *   axios.patch                         — PATCH to backend (postValidationResult)
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
      'worker.workerId':                       'worker-1',
      'worker.baseWorkingPath':                '/mnt/worker',
      'worker.connection.workerConfigUrl':     'http://worker-config',
      'worker.projectId':                      'proj-abc',
      'keycloak': {
        baseUrl:      'http://keycloak',
        realm:        'ndm',
        workerSecret: 'secret',
      },
    };
    return map[key];
  }),
};

const nfsInput = {
  path: '/vol/data',
  host: '10.0.0.1',
  username: 'admin',
  password: 'pass',
  protocol: 'NFS' as any,
  uploadId: 'upload-1',
  protocolVersion: '3',
  pathId: 'pid-1',
};

const smbInput = { ...nfsInput, protocol: 'SMB' as any };

describe('Component: validatePath (ValidatePathActivity)', () => {
  let activity: ValidatePathActivity;
  let nfsProtocol: NFSProtocol;
  let smbProtocol: SMBProtocol;
  let mockHttpService: { post: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    new WorkersConfig(mockConfigService as any);

    mockHttpService = {
      post: jest.fn().mockReturnValue(
        of({ data: { access_token: 'mock-token', expires_in: 300 } }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidatePathActivity,
        AuthService,
        Protocols,
        NFSProtocol,
        SMBProtocol,
        { provide: ConfigService,  useValue: mockConfigService },
        { provide: LoggerFactory,  useValue: mockLoggerFactory },
        { provide: HttpService,    useValue: mockHttpService },
      ],
    }).compile();

    activity    = module.get<ValidatePathActivity>(ValidatePathActivity);
    nfsProtocol = module.get<NFSProtocol>(NFSProtocol);
    smbProtocol = module.get<SMBProtocol>(SMBProtocol);
  });

  // ─── H1: validatePath NFS happy path ────────────────────────────────────

  it('H1 — validatePath — NFS path: mountPath and unmountPath both succeed via the real NFSProtocol route — verify the returned object has status: success, the correct workerId, and the correct path', async () => {
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);

    const result = await activity.validatePath(nfsInput);

    expect(nfsProtocol.mountPath).toHaveBeenCalledTimes(1);
    expect(nfsProtocol.unmountPath).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.workerId).toBe('worker-1');
    expect(result.path).toBe('/vol/data');
  });

  // ─── H2: validatePath SMB — routing switch directs to SMBProtocol ────────

  it('H2 — validatePath — SMB path: verify the real routing switch directs calls to SMBProtocol and NFSProtocol is never touched', async () => {
    jest.spyOn(smbProtocol, 'mountPath').mockResolvedValue(undefined);
    jest.spyOn(smbProtocol, 'unmountPath').mockResolvedValue(undefined);
    const nfsMountSpy   = jest.spyOn(nfsProtocol, 'mountPath');
    const nfsUnmountSpy = jest.spyOn(nfsProtocol, 'unmountPath');

    const result = await activity.validatePath(smbInput);

    expect(smbProtocol.mountPath).toHaveBeenCalledTimes(1);
    expect(smbProtocol.unmountPath).toHaveBeenCalledTimes(1);
    expect(nfsMountSpy).not.toHaveBeenCalled();
    expect(nfsUnmountSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  // ─── N1: mountPath throws — returns error shape, does not throw ───────────

  it('N1 — validatePath — mountPath throws a connection error — verify the method catches it and returns { status: error, ... } instead of propagating the throw, so the Temporal activity never fails at the infrastructure level', async () => {
    jest.spyOn(nfsProtocol, 'mountPath').mockRejectedValue(
      new Error('No route to host'),
    );

    const result = await activity.validatePath(nfsInput);

    expect(result.status).toBe('error');
    expect(result.workerId).toBe('worker-1');
    expect(result.message).toContain('mount or unmount');
    // should not throw — Temporal activity receives a structured result
  });

  // ─── H3: postValidationResult happy path ─────────────────────────────────

  it('H3 — postValidationResult — happy path: AuthService returns a token (via a mocked Keycloak HTTP response), then the PATCH request to the backend is made and the Authorization header contains Bearer <token> and the projectId header is present', async () => {
    (axios.patch as jest.Mock).mockResolvedValue({});

    await activity.postValidationResult('upload-2', { status: 'success' });

    // Real AuthService called mocked Keycloak endpoint
    expect(mockHttpService.post).toHaveBeenCalledWith(
      expect.stringContaining('/protocol/openid-connect/token'),
      expect.any(String),
      expect.any(Object),
    );

    // axios.patch received the Bearer token that real AuthService extracted
    expect(axios.patch).toHaveBeenCalledWith(
      'http://worker-config/api/v1/paths-upload/upload-2',
      { validationResult: { status: 'success' } },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
          projectId:     'proj-abc',
        }),
      }),
    );
  });

  // ─── N2: postValidationResult — getAccessToken returns null ──────────────

  it('N2 — postValidationResult — AuthService.getAccessToken returns null or empty — verify a "Failed to get access token" error is thrown before any HTTP request is made', async () => {
    // Keycloak unreachable — real AuthService catches the error and returns null
    mockHttpService.post.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

    await expect(activity.postValidationResult('upload-3', {})).rejects.toThrow(
      'Failed to get access token',
    );
    expect(axios.patch).not.toHaveBeenCalled();
  });

  // ─── N3: postValidationResult — axios.patch returns HTTP 500 ─────────────

  it('N3 — postValidationResult: axios.patch throws HTTP 500, error re-thrown with "Failed to post validation result"', async () => {
    (axios.patch as jest.Mock).mockRejectedValue(new Error('Request failed with status 500'));

    await expect(activity.postValidationResult('upload-4', {})).rejects.toThrow(
      'Failed to post validation result',
    );
  });
});
