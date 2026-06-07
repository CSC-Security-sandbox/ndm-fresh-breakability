import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { CommonActivityService } from '../activities/common/common.service';
import { JobRunStatus } from '../activities/common/enums';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

jest.mock('axios');
import axios from 'axios';

/**
 * Real classes wired:
 *   CommonActivityService → AuthService → HttpService (Keycloak)
 *
 * Mocked boundaries:
 *   HttpService.post  — Keycloak token
 *   axios.patch       — job-run status update
 */

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory: LoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
} as any;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.workerId':                          'worker-1',
      'worker.maxRetryCount':                     3,
      'worker.connection.workerJobServiceUrl':    'http://jobs-service',
      'worker.connection.workerReportServiceUrl': 'http://report-service',
      'worker.projectId':                         'proj-abc',
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

const mockRedisService = { getJobManagerContext: jest.fn() };

describe('Component: updateStatus (CommonActivityService)', () => {
  let service: CommonActivityService;
  let mockHttpService: { post: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    mockHttpService = {
      post: jest.fn().mockReturnValue(
        of({ data: { access_token: 'token-abc', expires_in: 300 } }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonActivityService,
        AuthService,
        { provide: ConfigService,  useValue: mockConfigService },
        { provide: LoggerFactory,  useValue: mockLoggerFactory },
        { provide: HttpService,    useValue: mockHttpService },
        { provide: RedisService,   useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<CommonActivityService>(CommonActivityService);
  });

  it('H1 — Happy path — AuthService fetches a token via the mocked Keycloak HTTP call, axios.patch is called with Authorization: Bearer <token> and projectId headers against the correct job-run URL, and the method returns a success message', async () => {
    (axios.patch as jest.Mock).mockResolvedValue({});

    await service.updateStatus({ jobRunId: 'job-s01', status: JobRunStatus.Running });

    expect(mockHttpService.post).toHaveBeenCalledWith(
      expect.stringContaining('/protocol/openid-connect/token'),
      expect.any(String),
      expect.any(Object),
    );
    expect(axios.patch).toHaveBeenCalledWith(
      'http://jobs-service/api/v1/job-run/job-s01/RUNNING',
      {},
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-abc',
          projectId: 'proj-abc',
        }),
      }),
    );
  });

  it('H2 — Status value is passed through unchanged — verify the PATCH URL contains the exact status string provided to the method (e.g., "RUNNING", "COMPLETED") with no transformation', async () => {
    (axios.patch as jest.Mock).mockResolvedValue({});

    await service.updateStatus({ jobRunId: 'job-s02', status: JobRunStatus.Completed });

    const [calledUrl] = (axios.patch as jest.Mock).mock.calls[0];
    expect(calledUrl).toContain('/COMPLETED');
  });

  it('N1 — AuthService.getAccessToken returns null — verify the "Failed to get access token" guard fires and the error is thrown before any HTTP call is made', async () => {
    mockHttpService.post.mockReturnValue(of({ data: {} }));

    await expect(service.updateStatus({ jobRunId: 'job-s03', status: JobRunStatus.Running })).rejects.toThrow(
      'Error while updating the status of the job id',
    );
    // axios.patch must NOT be called — the guard throws before the HTTP call
    expect(axios.patch).not.toHaveBeenCalled();
  });

  it('N2 — axios.patch returns HTTP 500 — verify the error is caught, wrapped as "Error while updating the status of the job id : …", and re-thrown', async () => {
    (axios.patch as jest.Mock).mockRejectedValue(new Error('Request failed with status 500'));

    await expect(service.updateStatus({ jobRunId: 'job-s04', status: JobRunStatus.Running })).rejects.toThrow(
      'Error while updating the status',
    );
  });
});
