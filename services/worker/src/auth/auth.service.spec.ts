import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

export const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

export const mockLoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
};

describe('AuthService', () => {
  let authService: AuthService;
  let httpService: HttpService;
  let configService: ConfigService;
  let loggerFactory: LoggerFactory;
  let logger: LoggerService;

  const mockKeycloakConfig = {
    baseUrl: 'http://localhost:8080',
    realm: 'myrealm',
    workerSecret: 'secret'
  };

  const mockWorkerId = 'worker-id-123';

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              switch (key) {
                case 'worker.workerId':
                  return mockWorkerId;
                case 'keycloak':
                  return mockKeycloakConfig;
              }
            }),
          },
        },
        { 
          provide: LoggerFactory,
          useValue: mockLoggerFactory
        },
      ],
    }).compile();

    authService = moduleRef.get<AuthService>(AuthService);
    httpService = moduleRef.get<HttpService>(HttpService);
    configService = moduleRef.get<ConfigService>(ConfigService);
    loggerFactory = moduleRef.get<LoggerFactory>(LoggerFactory);
    logger = loggerFactory.create(AuthService.name);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });

  it('should return cached access token if not expired', async () => {
    (authService as any).accessToken = 'cached-token';
    (authService as any).expiresAt = Math.floor(Date.now() / 1000) + 100;

    const token = await authService.getAccessToken();

    expect(token).toBe('cached-token');
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('should fetch new token if not present or expired', async () => {
    const mockResponse: AxiosResponse = {
      data: {
        access_token: 'new-access-token',
        expires_in: 1000,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    } as any;

    jest.spyOn(httpService, 'post').mockReturnValue(of(mockResponse));

    const token = await authService.getAccessToken();

    expect(token).toBe('new-access-token');
    expect(httpService.post).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Fetched new access token'));
  });

  it('should return null and log error if request fails', async () => {
    jest.spyOn(httpService, 'post').mockReturnValue(
      throwError(() => new Error('Request failed'))
    );

    const token = await authService.getAccessToken();

    expect(token).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to obtain access token: Request failed')
    );
  });

  it('should form token request string properly in constructor', () => {
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', mockWorkerId);
    tokenParams.append('client_secret', mockKeycloakConfig.workerSecret);
    tokenParams.append('grant_type', 'client_credentials');

    expect(authService.tokenRequest).toBe(tokenParams.toString());
  });
});
