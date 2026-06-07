import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { UpgradeActivityService } from '../activities/upgrade/upgrade.activity.service';
import { AuthService } from '../auth/auth.service';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

jest.mock('axios');
import axios from 'axios';

jest.mock('@temporalio/activity', () => ({
  Context: { current: jest.fn().mockReturnValue({ heartbeat: jest.fn() }) },
}));

/**
 * Real class chain:
 *   UpgradeActivityService.ackUpgrade → AuthService.getAccessToken → HttpService (Keycloak)
 *                                     → axios.post (CP ack endpoint)
 *
 * Mocked boundaries:
 *   HttpService.post   — Keycloak token
 *   axios.post         — CP /api/v1/upgrade/worker/ack
 *   BINARY_HANDLER     — not exercised by ackUpgrade; stub provided to satisfy DI
 *
 * NOTE: HTTP failures are silently swallowed — the method NEVER re-throws.
 */

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory: LoggerFactory = { create: jest.fn().mockReturnValue(mockLogger) } as any;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.workerId': 'worker-ack-01',
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

const mockHttpService = {
  post: jest.fn().mockReturnValue(
    of({ data: { access_token: 'ack-token', expires_in: 300 } }),
  ),
};

const mockBinaryHandler = {
  isBinaryStaged: jest.fn(),
  download:       jest.fn(),
  executeUpgrade: jest.fn(),
};

const ACK_INPUT = {
  bundleId: 'bundle-42',
  version:  '2.5.0',
  status:   'success' as const,
  message:  'all good',
};

describe('Component: UpgradeActivityService — ackUpgrade', () => {
  let service: UpgradeActivityService;
  const originalCpBaseUrl = process.env.CP_BASE_URL;

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    process.env.CP_BASE_URL = 'https://cp.example.com';
    delete process.env.CONTROL_PLANE_IP;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpgradeActivityService,      // REAL
        AuthService,                  // REAL
        { provide: ConfigService,    useValue: mockConfigService },
        { provide: LoggerFactory,    useValue: mockLoggerFactory },
        { provide: HttpService,      useValue: mockHttpService },
        { provide: 'BINARY_HANDLER', useValue: mockBinaryHandler },
      ],
    }).compile();

    service = module.get<UpgradeActivityService>(UpgradeActivityService);
  });

  afterEach(() => {
    if (originalCpBaseUrl !== undefined) {
      process.env.CP_BASE_URL = originalCpBaseUrl;
    } else {
      delete process.env.CP_BASE_URL;
    }
    delete process.env.CONTROL_PLANE_IP;
  });

  it('H1 — AuthService fetches token, axios.post to /api/v1/upgrade/worker/ack with Authorization header', async () => {
    (axios.post as jest.Mock).mockResolvedValue({});

    await service.ackUpgrade(ACK_INPUT);

    expect(mockHttpService.post).toHaveBeenCalledWith(
      expect.stringContaining('/protocol/openid-connect/token'),
      expect.any(String),
      expect.any(Object),
    );
    expect(axios.post).toHaveBeenCalledWith(
      'https://cp.example.com/api/v1/upgrade/worker/ack',
      expect.objectContaining({ workerId: 'worker-ack-01' }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ack-token' }),
      }),
    );
  });

  it('H2 — workerId, bundleId, version, status, message all present in POST body', async () => {
    (axios.post as jest.Mock).mockResolvedValue({});

    await service.ackUpgrade(ACK_INPUT);

    const [, body] = (axios.post as jest.Mock).mock.calls[0];
    expect(body).toMatchObject({
      workerId: 'worker-ack-01',
      bundleId: 'bundle-42',
      version:  '2.5.0',
      status:   'success',
      message:  'all good',
    });
  });

  it('H3 — Keycloak returns null token → no Authorization header but POST still sent, no throw', async () => {
    mockHttpService.post.mockReturnValue(of({ data: { access_token: null, expires_in: 300 } }));
    (axios.post as jest.Mock).mockResolvedValue({});

    await expect(service.ackUpgrade(ACK_INPUT)).resolves.toBeUndefined();

    const [, , options] = (axios.post as jest.Mock).mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('H4 — CP_BASE_URL absent but CONTROL_PLANE_IP present → URL built from CONTROL_PLANE_IP', async () => {
    delete process.env.CP_BASE_URL;
    process.env.CONTROL_PLANE_IP = '10.0.0.5';
    (axios.post as jest.Mock).mockResolvedValue({});

    await service.ackUpgrade(ACK_INPUT);

    const [calledUrl] = (axios.post as jest.Mock).mock.calls[0];
    expect(calledUrl).toBe('https://10.0.0.5/api/v1/upgrade/worker/ack');
  });

  it('N1 — CP_BASE_URL and CONTROL_PLANE_IP both unset → throws before AuthService or axios', async () => {
    delete process.env.CP_BASE_URL;
    delete process.env.CONTROL_PLANE_IP;

    await expect(service.ackUpgrade(ACK_INPUT)).rejects.toThrow(
      'Neither CP_BASE_URL nor CONTROL_PLANE_IP environment variable is set',
    );
    expect(mockHttpService.post).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('N2 — axios.post HTTP 500 → error swallowed, method resolves without throw', async () => {
    (axios.post as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }),
    );

    await expect(service.ackUpgrade(ACK_INPUT)).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to send ack'));
  });

  it('N3 — network ECONNREFUSED → error caught and swallowed, method returns cleanly', async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error('connect ECONNREFUSED 443'));

    await expect(service.ackUpgrade(ACK_INPUT)).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
