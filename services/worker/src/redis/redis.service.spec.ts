import { RedisService } from './redis.service';
import { JobContextFactory } from '@netapp-cloud-datamigrate/jobs-lib';
import { createClient } from 'redis';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { of, throwError } from 'rxjs';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

jest.mock('@netapp-cloud-datamigrate/jobs-lib', () => ({
  JobContextFactory: {
    getProvider: jest.fn(),
    getSpeedTestProvider: jest.fn(),
    getJobManagerProvider: jest.fn(),
  },
}));

describe('RedisService', () => {
  let service: RedisService;
  let mockClient: any;
  let configService: ConfigService;
  let httpService: HttpService;
  let authService: AuthService;
  let loggerFactory: LoggerFactory;

  beforeEach(async() => {
    jest.clearAllMocks();

    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_USERNAME;
    delete process.env.REDIS_PASSWORD;

    mockClient = {
      isOpen: false,
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      hSet: jest.fn().mockResolvedValue(1),
      hGet: jest.fn().mockResolvedValue('identity'),
      hKeys: jest.fn().mockResolvedValue([]),
      info: jest
        .fn()
        .mockResolvedValue('used_memory:1024\ntotal_system_memory:4096\nmaxmemory:2048\n'),
    };
    (createClient as jest.Mock).mockReturnValue(mockClient);

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const configMap = {
          'worker.connection.workerConfigUrl': 'http://test-url',
          'worker.workerId': 'test-worker-123'
        };
        return configMap[key];
      }),
    };

    const mockHttpService = {
      get: jest.fn(),
    };

    const mockAuthService = {
      getAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
    };

    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    configService = module.get<ConfigService>(ConfigService);
    httpService = module.get<HttpService>(HttpService);
    authService = module.get<AuthService>(AuthService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
  });

  describe('onModuleInit', () => {
    it('should create client on init', async () => {
      // Mock the HTTP response for Redis credentials
      const mockCredentials = {
        host: 'redis.example.com',
        port: '6379',
        username: 'redis-user',
        password: 'redis-password',
      };

      const mockResponse = {
        status: 200,
        data: {
          data: {
            items: mockCredentials,
          },
        },
      };

      (httpService.get as jest.Mock).mockReturnValue(of(mockResponse));

      const spyCreate = jest.spyOn(service, 'createClient');
      
      await service.onModuleInit();
      
      expect(spyCreate).toHaveBeenCalled();
      expect(configService.get).toHaveBeenCalledWith('worker.connection.workerConfigUrl');
      expect(configService.get).toHaveBeenCalledWith('worker.workerId');
      expect(authService.getAccessToken).toHaveBeenCalled();
      expect(httpService.get).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith('Initializing Redis service...');
      expect(mockLogger.log).toHaveBeenCalledWith('Redis service initialized successfully');
    });

    it('should handle initialization errors', async () => {
      (authService.getAccessToken as jest.Mock).mockRejectedValue(new Error('Auth failed'));
      
      await expect(service.onModuleInit()).rejects.toThrow('Redis credentials are required for worker operation');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize Redis service: Redis credentials are required for worker operation: Auth failed');
    });

    it('should handle fetchAndUpdateRedisCredentials failures', async () => {
    // Mock HTTP request to fail
      (httpService.get as jest.Mock).mockReturnValue(throwError(() => new Error('API unavailable')));
      
      await expect(service.onModuleInit()).rejects.toThrow('Redis credentials are required for worker operation');
      
      // This will cover the catch block when fetchAndUpdateRedisCredentials fails
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize Redis service: Redis credentials are required for worker operation: API unavailable');
    });

    it('should handle auth service failures in fetchAndUpdateRedisCredentials', async () => {
      // Mock auth to fail
      (authService.getAccessToken as jest.Mock).mockRejectedValue(new Error('Auth token expired'));
      
      await expect(service.onModuleInit()).rejects.toThrow('Redis credentials are required for worker operation');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize Redis service: Redis credentials are required for worker operation: Auth token expired');
    });


    it('should handle createClient failures in onModuleInit', async () => {
      // Mock successful credential fetch
      const mockCredentials = {
        host: 'redis.test.com',
        port: '6379',
        username: 'test-user',
        password: 'test-pass',
      };

      const mockResponse = {
        status: 200,
        data: { data: { items: mockCredentials } },
      };

      (httpService.get as jest.Mock).mockReturnValue(of(mockResponse));

      // Mock createClient to fail
      jest.spyOn(service, 'createClient').mockRejectedValue(new Error('Connection failed'));
      
      await expect(service.onModuleInit()).rejects.toThrow('Connection failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize Redis service: Connection failed');
    });
  });

  describe('fetchRedisCredentials', () => {
    it('should fetch credentials successfully', async () => {
      const mockCredentials = {
        host: 'redis.test.com',
        port: '6379',
        username: 'test-user',
        password: 'test-pass',
      };

      const mockResponse = {
        status: 200,
        data: { data: { items: mockCredentials } },
      };

      (httpService.get as jest.Mock).mockReturnValue(of(mockResponse));

      const credentials = await (service as any).fetchRedisCredentials();

      expect(credentials).toEqual(mockCredentials);
      expect(mockLogger.log).toHaveBeenCalledWith('Redis credentials fetched successfully:');
      expect(mockLogger.debug).toHaveBeenCalledWith('  Host: redis.test.com');
      expect(mockLogger.debug).toHaveBeenCalledWith('  Port: 6379');
      expect(mockLogger.debug).toHaveBeenCalledWith('  Username: test-user');
      expect(mockLogger.debug).toHaveBeenCalledWith('  Password length: 9');
    });

    it('should handle missing access token', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValue(null);

      await expect((service as any).fetchRedisCredentials()).rejects.toThrow('Failed to get access token');
    });

    it('should handle HTTP request failure', async () => {
      (httpService.get as jest.Mock).mockReturnValue(throwError(() => new Error('Network error')));

      await expect((service as any).fetchRedisCredentials()).rejects.toThrow(
        'Redis credentials are required for worker operation'
      );
    });

    it('should handle non-200 response', async () => {
      const mockResponse = { status: 401, data: {} };
      (httpService.get as jest.Mock).mockReturnValue(of(mockResponse));

      await expect((service as any).fetchRedisCredentials()).rejects.toThrow(
        'Failed to fetch Redis credentials. Status: 401'
      );
    });

    it('should handle incomplete credentials', async () => {
      const mockResponse = {
        status: 200,
        data: { data: { items: { host: 'redis.test.com' } } }, // Missing username/password
      };
      (httpService.get as jest.Mock).mockReturnValue(of(mockResponse));

      await expect((service as any).fetchRedisCredentials()).rejects.toThrow(
        'Incomplete Redis credentials received from API'
      );
    });
  });

  describe('updateRedisConfig', () => {
    it('should update all environment variables including REDIS_HOST', () => {
      const credentials = {
        host: 'test-host',
        port: '6380',
        username: 'test-user',
        password: 'test-pass',
      };

      (service as any).updateRedisConfig(credentials);
      expect(process.env.REDIS_USERNAME).toBe('test-user');
      expect(process.env.REDIS_PASSWORD).toBe('test-pass');
      expect(mockLogger.log).toHaveBeenCalledWith('Redis configuration updated successfully');
    });

    it('should throw error for null credentials', () => {
      expect(() => (service as any).updateRedisConfig(null)).toThrow(
        'Redis credentials not available'
      );
    });

    it('should throw error for undefined credentials', () => {
      expect(() => (service as any).updateRedisConfig(undefined)).toThrow(
        'Redis credentials not available'
      );
    });
  });

  describe('fetchAndUpdateRedisCredentials', () => {
    it('should fetch and update credentials successfully', async () => {
      const mockCredentials = {
        host: 'redis.integration.com',
        port: '6379',
        username: 'integration-user',
        password: 'integration-pass',
      };

      const mockResponse = {
        status: 200,
        data: { data: { items: mockCredentials } },
      };

      (httpService.get as jest.Mock).mockReturnValue(of(mockResponse));

      await (service as any).fetchAndUpdateRedisCredentials();

      expect(process.env.REDIS_USERNAME).toBe('integration-user');
      expect(process.env.REDIS_PASSWORD).toBe('integration-pass');
    });
  });

  describe('onModuleDestroy', () => {
    it('should quit client and log when open', async () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = true;
      const logSpy = jest.spyOn((service as any).logger, 'log');
      await service.onModuleDestroy();
      expect(mockClient.quit).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('Redis client disconnected');
    });

    it('should not quit when client not open', async () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = false;
      await service.onModuleDestroy();
      expect(mockClient.quit).not.toHaveBeenCalled();
    });
  });

  describe('createClient', () => {
    it('should return early if client already open', async () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = true;
      await service.createClient();
      expect(createClient).not.toHaveBeenCalled();
    });

    it('should create client without auth and connect', async () => {
      delete process.env.REDIS_USERNAME;
      delete process.env.REDIS_PASSWORD;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      await service.createClient();
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'redis://127.0.0.1:6379' }),
      );
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function),
      );
    });

    it('should include auth when env vars set', async () => {
      process.env.REDIS_HOST = 'host';
      process.env.REDIS_PORT = '1234';
      process.env.REDIS_USERNAME = 'user';
      process.env.REDIS_PASSWORD = 'pass';
      await service.createClient();
      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'redis://host:1234',
          username: 'user',
          password: 'pass',
        }),
      );
    });

    it('should handle Redis client error events', async () => {
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error');
      let errorHandler: (error: any) => void;

      mockClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      await service.createClient();

      // Trigger the error handler
      const testError = new Error('Redis connection failed');
      errorHandler!(testError);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Redis connection error: ${testError}`,
      );
    });

    it('should handle Redis client connect events', async () => {
      const loggerLogSpy = jest.spyOn((service as any).logger, 'log');
      let connectHandler: () => void;

      mockClient.on.mockImplementation((event, handler) => {
        if (event === 'connect') {
          connectHandler = handler;
        }
      });

      await service.createClient();

      // Trigger the connect handler
      connectHandler!();

      expect(loggerLogSpy).toHaveBeenCalledWith('Connected to Redis');
    });
  });

  describe('getClient', () => {
    it('should return client when initialized and open', () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = true;
      const client = service.getClient();
      expect(client).toBe(mockClient);
    });

    it('should throw if client not open', () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = false;
      expect(() => service.getClient()).toThrow(
        'Redis client is not initialized yet.',
      );
    });
  });

  describe('ensureClient', () => {
    it('should call createClient when no client', async () => {
      const spyCreate = jest.spyOn(service as any, 'createClient');
      (service as any).client = undefined;
      await (service as any).ensureClient();
      expect(spyCreate).toHaveBeenCalled();
    });

    it('should call createClient when client not open', async () => {
      (service as any).client = mockClient;
      (mockClient as any).isOpen = false;
      const spyCreate = jest.spyOn(service as any, 'createClient');
      await (service as any).ensureClient();
      expect(spyCreate).toHaveBeenCalled();
    });
  });

  describe('JobContext operations', () => {
    beforeEach(() => {
      jest.spyOn(service as any, 'ensureClient').mockResolvedValue(undefined);
    });

    it('getJobContext should return from provider', async () => {
      const fakeProvider = {
        getJobContext: jest.fn().mockResolvedValue('ctx'),
      };
      (JobContextFactory.getProvider as jest.Mock).mockReturnValue(
        fakeProvider,
      );
      (service as any).client = mockClient;
      const ctx = await service.getJobContext('id');
      expect(JobContextFactory.getProvider).toHaveBeenCalledWith(
        'redis',
        mockClient,
      );
      expect(ctx).toBe('ctx');
    });

    it('getSpeedTestJobContext should return from speed test provider', async () => {
      const fakeProvider = {
        getJobContext: jest.fn().mockResolvedValue('ctx2'),
      };
      (JobContextFactory.getSpeedTestProvider as jest.Mock).mockReturnValue(
        fakeProvider,
      );
      (service as any).client = mockClient;
      const ctx = await service.getSpeedTestJobContext('id2');
      expect(JobContextFactory.getSpeedTestProvider).toHaveBeenCalledWith(
        'redis',
        mockClient,
      );
      expect(ctx).toBe('ctx2');
    });

    it('getJobManagerContext should return from job manager provider', async () => {
      const fakeProvider = {
        getContext: jest.fn().mockResolvedValue('mgrCtx'),
      };
      (JobContextFactory as any).getJobManagerProvider = jest
        .fn()
        .mockReturnValue(fakeProvider);
      (service as any).client = mockClient;
      const ctx = await service.getJobManagerContext('mgrId');
      expect(JobContextFactory.getJobManagerProvider).toHaveBeenCalledWith(
        'redis',
        mockClient,
      );
      expect(ctx).toBe('mgrCtx');
    });

    it('setJobContext should serialize and set context', async () => {
      const mockJobContext = {
        serialize: jest.fn().mockReturnValue('serialized-context'),
      };
      (service as any).client = mockClient;

      await service.setJobContext('trace-123', mockJobContext);

      expect(mockJobContext.serialize).toHaveBeenCalled();
      expect(mockClient.set).toHaveBeenCalledWith(
        'trace-123',
        'serialized-context',
      );
    });

    it('getJobState should return job state from context', async () => {
      const mockJobContext = {
        getJobState: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
      };
      jest
        .spyOn(service, 'getJobContext')
        .mockResolvedValue(mockJobContext as any);

      const result = await service.getJobState('trace-456');

      expect(service.getJobContext).toHaveBeenCalledWith('trace-456');
      expect(mockJobContext.getJobState).toHaveBeenCalled();
      expect(result).toEqual({ status: 'RUNNING' });
    });

    it('getJobState should return error message when exception occurs', async () => {
      jest
        .spyOn(service, 'getJobContext')
        .mockRejectedValue(new Error('Context not found'));

      const result = await service.getJobState('trace-error');

      expect(result).toEqual({
        message: 'Error while getting the job state : trace-error',
      });
    });

    it('setJobState should update and return new job state', async () => {
      const mockJobContext = {
        setJobState: jest.fn().mockResolvedValue(undefined),
        getJobState: jest.fn().mockResolvedValue({ status: 'COMPLETED' }),
      };
      jest
        .spyOn(service, 'getJobContext')
        .mockResolvedValue(mockJobContext as any);

      const result = await service.setJobState('trace-789', {
        status: 'COMPLETED',
      } as any);

      expect(service.getJobContext).toHaveBeenCalledWith('trace-789');
      expect(mockJobContext.setJobState).toHaveBeenCalledWith({
        status: 'COMPLETED',
      });
      expect(mockJobContext.getJobState).toHaveBeenCalled();
      expect(result).toEqual({ status: 'COMPLETED' });
    });

    it('setJobState should return error message when exception occurs', async () => {
      jest
        .spyOn(service, 'getJobContext')
        .mockRejectedValue(new Error('Failed to update'));

      const result = await service.setJobState('trace-fail', {
        status: 'FAILED',
      } as any);

      expect(result).toEqual({
        message: 'Error while updating the job state : trace-fail',
      });
    });
  });

  describe('Owner Identity operations', () => {
    beforeEach(() => {
      (service as any).client = mockClient;
    });

    it('getOwnerIdentity should call hGet with correct parameters', async () => {
      mockClient.hGet.mockResolvedValue('test-identity');

      const result = await service.getOwnerIdentity(
        'job-run-123',
        '456',
        'SID',
      );

      expect(mockClient.hGet).toHaveBeenCalledWith(
        'job-run-123:mapping',
        'SID:456',
      );
      expect(result).toBe('test-identity');
    });

    it('getOwnerIdentity should handle UID type', async () => {
      mockClient.hGet.mockResolvedValue('uid-identity');

      const result = await service.getOwnerIdentity(
        'job-run-456',
        '789',
        'UID',
      );

      expect(mockClient.hGet).toHaveBeenCalledWith(
        'job-run-456:mapping',
        'UID:789',
      );
      expect(result).toBe('uid-identity');
    });

    it('getOwnerIdentity should handle GID type', async () => {
      mockClient.hGet.mockResolvedValue('gid-identity');

      const result = await service.getOwnerIdentity(
        'job-run-789',
        '101',
        'GID',
      );

      expect(mockClient.hGet).toHaveBeenCalledWith(
        'job-run-789:mapping',
        'GID:101',
      );
      expect(result).toBe('gid-identity');
    });

    it('setOwnerIdentity should call hSet with correct parameters', async () => {
      mockClient.hSet = jest.fn().mockResolvedValue(1);

      const result = await service.setOwnerIdentity(
        'job-run-123',
        '456',
        'SID',
        'S-1-5-21-123456789',
      );

      expect(mockClient.hSet).toHaveBeenCalledWith(
        'job-run-123:mapping',
        'SID:456',
        'S-1-5-21-123456789',
      );
      expect(result).toBe(1);
    });

    it('setOwnerIdentity should handle UID type', async () => {
      mockClient.hSet = jest.fn().mockResolvedValue(1);

      const result = await service.setOwnerIdentity(
        'job-run-456',
        '789',
        'UID',
        'user123',
      );

      expect(mockClient.hSet).toHaveBeenCalledWith(
        'job-run-456:mapping',
        'UID:789',
        'user123',
      );
      expect(result).toBe(1);
    });

    it('setOwnerIdentity should handle GID type', async () => {
      mockClient.hSet = jest.fn().mockResolvedValue(0);

      const result = await service.setOwnerIdentity(
        'job-run-789',
        '101',
        'GID',
        'group456',
      );

      expect(mockClient.hSet).toHaveBeenCalledWith(
        'job-run-789:mapping',
        'GID:101',
        'group456',
      );
      expect(result).toBe(0);
    });

    describe('Memory info', () => {
      beforeEach(() => {
        jest.spyOn(service as any, 'ensureClient').mockResolvedValue(undefined);
      });

      it('parseMemoryStats extracts values correctly', () => {
        const stats = 'used_memory:256\ntotal_system_memory:1024\nmaxmemory:512\nother:foo';
        const parsed = service.parseMemoryStats(stats);
        expect(parsed).toEqual({ used_memory: 256, total_system_memory: 1024, maxmemory: 512 });
      });

      it('parseMemoryStats returns zeros if keys missing', () => {
        const stats = 'foo:bar\nbaz:qux';
        const parsed = service.parseMemoryStats(stats);
        expect(parsed).toEqual({ used_memory: 0, total_system_memory: 0, maxmemory: 0 });
      });

      it('parseMemoryStats handles empty string', () => {
        const parsed = service.parseMemoryStats('');
        expect(parsed).toEqual({ used_memory: 0, total_system_memory: 0, maxmemory: 0 });
      });

      it('parseMemoryStats handles malformed data', () => {
        const stats = 'used_memory:invalid\ntotal_system_memory:notanumber\nmaxmemory:bad';
        const parsed = service.parseMemoryStats(stats);
        expect(parsed.used_memory).toBeNaN();
        expect(parsed.total_system_memory).toBeNaN();
        expect(parsed.maxmemory).toBeNaN();
      });

      it('getMemoryInfo calls info and returns parsed', async () => {
        (service as any).client = mockClient;
        const info = await service.getMemoryInfo();
        expect(mockClient.info).toHaveBeenCalledWith('memory');
        expect(info).toEqual({ used_memory: 1024, total_system_memory: 4096, maxmemory: 2048 });
      });
    });

    describe('Mapping Keys operations', () => {
      beforeEach(() => {
        jest.spyOn(service as any, 'ensureClient').mockResolvedValue(undefined);
        (service as any).client = mockClient;
      });

      it('getMappingKeys should filter and map SID keys correctly', async () => {
        mockClient.hKeys = jest
          .fn()
          .mockResolvedValue([
            'SID:123',
            'SID:456',
            'UID:789',
            'GID:101',
            'SID:999',
          ]);

        const result = await service.getMappingKeys('job-run-123', 'SID');

        expect(mockClient.hKeys).toHaveBeenCalledWith('job-run-123:mapping');
        expect(result).toEqual(['123', '456', '999']);
      });

      it('getMappingKeys should filter and map UID keys correctly', async () => {
        mockClient.hKeys = jest
          .fn()
          .mockResolvedValue(['SID:123', 'UID:456', 'UID:789', 'GID:101']);

        const result = await service.getMappingKeys('job-run-456', 'UID');

        expect(mockClient.hKeys).toHaveBeenCalledWith('job-run-456:mapping');
        expect(result).toEqual(['456', '789']);
      });

      it('getMappingKeys should filter and map GID keys correctly', async () => {
        mockClient.hKeys = jest
          .fn()
          .mockResolvedValue([
            'SID:123',
            'UID:456',
            'GID:789',
            'GID:101',
            'OTHER:999',
          ]);

        const result = await service.getMappingKeys('job-run-789', 'GID');

        expect(mockClient.hKeys).toHaveBeenCalledWith('job-run-789:mapping');
        expect(result).toEqual(['789', '101']);
      });

      it('getMappingKeys should return empty array when no matching keys', async () => {
        mockClient.hKeys = jest
          .fn()
          .mockResolvedValue(['OTHER:123', 'INVALID:456']);

        const result = await service.getMappingKeys('job-run-empty', 'SID');

        expect(result).toEqual([]);
      });

      it('getMappingKeys should handle empty hash', async () => {
        mockClient.hKeys = jest.fn().mockResolvedValue([]);

        const result = await service.getMappingKeys('job-run-empty', 'UID');

        expect(result).toEqual([]);
      });
    });
  });

  describe('JWT Authentication', () => {
    beforeEach(() => {
      // Enable JWT auth for these tests
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        const configMap = {
          'worker.connection.workerConfigUrl': 'http://test-url',
          'worker.workerId': 'test-worker-123',
          'REDIS_JWT_AUTH_ENABLED': 'true',
          'REDIS_GATEWAY_HOST': 'gateway.example.com',
          'REDIS_GATEWAY_PORT': '6379',
          'JWT_REFRESH_INTERVAL_MINUTES': '1380',
        };
        return configMap[key];
      });
    });

    describe('createJwtAuthClient', () => {
      it('should create JWT authenticated client with correct config', async () => {
        process.env.REDIS_USERNAME = 'test-user';
        (authService.getAccessToken as jest.Mock).mockResolvedValue('mock-jwt-token');

        await (service as any).createJwtAuthClient();

        expect(authService.getAccessToken).toHaveBeenCalled();
        expect(createClient).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'rediss://gateway.example.com:6379',
            username: 'test-user',
            password: 'mock-jwt-token',
            socket: expect.objectContaining({
              tls: true,
              rejectUnauthorized: false,
            }),
          }),
        );
        expect(mockClient.connect).toHaveBeenCalled();
      });

      it('should throw error when JWT token is not available', async () => {
        (authService.getAccessToken as jest.Mock).mockResolvedValue(null);

        await expect((service as any).createJwtAuthClient()).rejects.toThrow(
          'Failed to get JWT for Redis authentication',
        );
      });

      it('should use default username when REDIS_USERNAME not set', async () => {
        delete process.env.REDIS_USERNAME;
        (authService.getAccessToken as jest.Mock).mockResolvedValue('jwt-token');

        await (service as any).createJwtAuthClient();

        expect(createClient).toHaveBeenCalledWith(
          expect.objectContaining({
            username: 'default',
          }),
        );
      });

      it('should set up event handlers for JWT auth client', async () => {
        (authService.getAccessToken as jest.Mock).mockResolvedValue('jwt-token');
        
        await (service as any).createJwtAuthClient();

        expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(mockClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(mockClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
      });

      it('should handle ready event for JWT auth client', async () => {
        const loggerLogSpy = jest.spyOn((service as any).logger, 'log');
        let readyHandler: () => void;

        mockClient.on.mockImplementation((event, handler) => {
          if (event === 'ready') {
            readyHandler = handler;
          }
        });

        (authService.getAccessToken as jest.Mock).mockResolvedValue('jwt-token');
        await (service as any).createJwtAuthClient();

        // Trigger the ready handler
        readyHandler!();

        expect(loggerLogSpy).toHaveBeenCalledWith('Redis client ready - AUTH command succeeded');
      });
    });

    describe('setupConnectionRefresh', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('should setup refresh interval with correct timing', () => {
        const refreshSpy = jest.spyOn(service as any, 'refreshConnection').mockResolvedValue(undefined);

        (service as any).setupConnectionRefresh();

        // Verify interval is set (1380 minutes = 82800000ms)
        expect(mockLogger.log).toHaveBeenCalledWith(
          'Setting up Redis connection refresh every 23 hours',
        );

        // Fast-forward time to trigger refresh
        jest.advanceTimersByTime(82800000);

        expect(refreshSpy).toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith('Proactively refreshing Redis connection with new JWT...');
      });

      it('should handle refresh errors gracefully', async () => {
        const refreshError = new Error('Refresh failed');
        jest.spyOn(service as any, 'refreshConnection').mockRejectedValue(refreshError);

        (service as any).setupConnectionRefresh();

        // Fast-forward time to trigger refresh
        await jest.advanceTimersByTimeAsync(82800000);

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Failed to refresh Redis connection: Refresh failed',
        );
      });

      it('should use custom refresh interval from env var', () => {
        (configService.get as jest.Mock).mockImplementation((key: string) => {
          if (key === 'JWT_REFRESH_INTERVAL_MINUTES') return '60';
          return undefined;
        });

        (service as any).setupConnectionRefresh();

        expect(mockLogger.log).toHaveBeenCalledWith(
          'Setting up Redis connection refresh every 1 hours',
        );
      });
    });

    describe('refreshConnection', () => {
      it('should close existing connection and create new one', async () => {
        (service as any).jwtAuthEnabled = true;
        (service as any).client = mockClient;
        mockClient.isOpen = true;

        const createJwtClientSpy = jest.spyOn(service as any, 'createJwtAuthClient').mockResolvedValue(undefined);

        await (service as any).refreshConnection();

        expect(mockLogger.log).toHaveBeenCalledWith('Closing existing Redis connection for refresh...');
        expect(mockClient.quit).toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith('Creating new Redis connection with fresh JWT...');
        expect(createJwtClientSpy).toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith('Redis connection refreshed successfully');
      });

      it('should warn when called with JWT auth disabled', async () => {
        (service as any).jwtAuthEnabled = false;

        await (service as any).refreshConnection();

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Connection refresh called but JWT auth is disabled',
        );
        expect(mockClient.quit).not.toHaveBeenCalled();
      });

      it('should handle case when client is not open', async () => {
        (service as any).jwtAuthEnabled = true;
        (service as any).client = mockClient;
        mockClient.isOpen = false;

        const createJwtClientSpy = jest.spyOn(service as any, 'createJwtAuthClient').mockResolvedValue(undefined);

        await (service as any).refreshConnection();

        expect(mockClient.quit).not.toHaveBeenCalled();
        expect(createJwtClientSpy).toHaveBeenCalled();
      });

      it('should handle errors during connection close', async () => {
        (service as any).jwtAuthEnabled = true;
        (service as any).client = mockClient;
        mockClient.isOpen = true;
        mockClient.quit.mockRejectedValue(new Error('Close failed'));

        const createJwtClientSpy = jest.spyOn(service as any, 'createJwtAuthClient').mockResolvedValue(undefined);

        await expect((service as any).refreshConnection()).rejects.toThrow('Close failed');
        expect(mockClient.quit).toHaveBeenCalled();
        expect(createJwtClientSpy).not.toHaveBeenCalled();
      });
    });

    describe('onModuleInit with JWT auth', () => {
      let jwtService: RedisService;

      beforeEach(async () => {
        (configService.get as jest.Mock).mockImplementation((key: string) => {
          const configMap = {
            'worker.connection.workerConfigUrl': 'http://test-url',
            'worker.workerId': 'test-worker-123',
            'REDIS_JWT_AUTH_ENABLED': 'true',
            'REDIS_GATEWAY_HOST': 'gateway.test.com',
            'REDIS_GATEWAY_PORT': '6379',
            'JWT_REFRESH_INTERVAL_MINUTES': '1380',
          };
          return configMap[key];
        });

        // Recreate service with JWT auth enabled
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            RedisService,
            { provide: ConfigService, useValue: configService },
            { provide: HttpService, useValue: httpService },
            { provide: AuthService, useValue: authService },
            { provide: LoggerFactory, useValue: loggerFactory },
          ],
        }).compile();

        jwtService = module.get<RedisService>(RedisService);
      });

      it('should setup connection refresh when JWT auth is enabled', async () => {
        const mockCredentials = {
          host: 'redis.test.com',
          port: '6379',
          username: 'test-user',
          password: 'test-pass',
        };

        const mockResponse = {
          status: 200,
          data: { data: { items: mockCredentials } },
        };

        (httpService.get as jest.Mock).mockReturnValue(of(mockResponse));
        (authService.getAccessToken as jest.Mock).mockResolvedValue('jwt-token');

        const setupRefreshSpy = jest.spyOn(jwtService as any, 'setupConnectionRefresh').mockImplementation(() => {});

        await jwtService.onModuleInit();

        expect(setupRefreshSpy).toHaveBeenCalled();
        expect(mockLogger.log).toHaveBeenCalledWith('JWT Authentication: ENABLED');
      });
    });

    describe('onModuleDestroy with JWT auth', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('should clear connection refresh interval on destroy', async () => {
        const mockInterval = setInterval(() => {}, 1000);
        (service as any).connectionRefreshInterval = mockInterval;
        (service as any).client = mockClient;
        mockClient.isOpen = true;

        await service.onModuleDestroy();

        expect(mockLogger.log).toHaveBeenCalledWith('Redis connection refresh interval cleared');
        expect(mockClient.quit).toHaveBeenCalled();
      });

      it('should not log interval clear message when interval not set', async () => {
        (service as any).connectionRefreshInterval = null;
        (service as any).client = mockClient;
        mockClient.isOpen = true;

        await service.onModuleDestroy();

        expect(mockLogger.log).not.toHaveBeenCalledWith('Redis connection refresh interval cleared');
      });
    });

    describe('createClient with JWT auth enabled', () => {
      let jwtService: RedisService;

      beforeEach(async () => {
        (configService.get as jest.Mock).mockImplementation((key: string) => {
          const configMap = {
            'REDIS_JWT_AUTH_ENABLED': 'true',
            'worker.connection.workerConfigUrl': 'http://test-url',
            'worker.workerId': 'test-worker-123',
          };
          return configMap[key];
        });

        // Recreate service with JWT auth enabled
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            RedisService,
            { provide: ConfigService, useValue: configService },
            { provide: HttpService, useValue: httpService },
            { provide: AuthService, useValue: authService },
            { provide: LoggerFactory, useValue: loggerFactory },
          ],
        }).compile();

        jwtService = module.get<RedisService>(RedisService);
      });

      it('should call createJwtAuthClient when JWT auth is enabled', async () => {
        (authService.getAccessToken as jest.Mock).mockResolvedValue('jwt-token');
        const createJwtClientSpy = jest.spyOn(jwtService as any, 'createJwtAuthClient').mockResolvedValue(undefined);

        await jwtService.createClient();

        expect(createJwtClientSpy).toHaveBeenCalled();
      });

      it('should call createTraditionalClient when JWT auth is disabled', async () => {
        (configService.get as jest.Mock).mockReturnValue('false');
        const createTraditionalClientSpy = jest.spyOn(service as any, 'createTraditionalClient').mockResolvedValue(undefined);

        await service.createClient();

        expect(createTraditionalClientSpy).toHaveBeenCalled();
      });
    });
  });
});
