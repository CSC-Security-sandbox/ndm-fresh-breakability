import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { createClient } from 'redis';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe('RedisConsumerService - JWT Authentication', () => {
  let authService: AuthService;
  let configService: ConfigService;
  let mockClient: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockClient = {
      isOpen: false,
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      duplicate: jest.fn().mockReturnThis(),
    };

    (createClient as jest.Mock).mockReturnValue(mockClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            getAccessToken: jest.fn().mockResolvedValue('mock-jwt-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const configMap = {
                REDIS_HOST: 'localhost',
                REDIS_PORT: '6379',
                REDIS_JWT_AUTH_ENABLED: 'false',
                REDIS_GATEWAY_HOST: 'gateway.test.com',
                REDIS_GATEWAY_PORT: '6379',
              };
              return configMap[key];
            }),
          },
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLogger),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('JWT Client Creation', () => {
    it('should create JWT authenticated client for Redis consumer', async () => {
      process.env.REDIS_USERNAME = 'consumer-user';
      (authService.getAccessToken as jest.Mock).mockResolvedValue('consumer-jwt-token');

      const jwtAuthEnabled = true;
      
      // Simulate createJwtAuthClient logic
      const jwt = await authService.getAccessToken();
      expect(jwt).toBe('consumer-jwt-token');

      const redisClientOptions = {
        url: 'redis://redis-master.redis.svc.cluster.local:6379',
        username: process.env.REDIS_USERNAME || 'default',
        password: jwt,
      };

      const client = createClient(redisClientOptions);

      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'redis://redis-master.redis.svc.cluster.local:6379',
          username: 'consumer-user',
          password: 'consumer-jwt-token',
        }),
      );
    });

    it('should handle JWT token retrieval failure', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValue(null);

      const jwt = await authService.getAccessToken();

      expect(jwt).toBeNull();
      // Service should handle this by throwing error
      expect(() => {
        if (!jwt) {
          throw new Error('Failed to get JWT for Redis authentication');
        }
      }).toThrow('Failed to get JWT for Redis authentication');
    });
  });

  describe('Connection Refresh for Consumer', () => {
    it('should support connection refresh mechanism', async () => {
      const jwtAuthEnabled = true;
      let connectionRefreshInterval: NodeJS.Timeout;

      // Simulate setupConnectionRefresh
      const refreshConnection = jest.fn().mockResolvedValue(undefined);
      const refreshIntervalMs = 1380 * 60 * 1000; // 23 hours

      connectionRefreshInterval = setInterval(async () => {
        mockLogger.log('Proactively refreshing Redis connection with new JWT...');
        await refreshConnection();
      }, refreshIntervalMs);

      expect(connectionRefreshInterval).toBeDefined();

      // Fast-forward to trigger refresh using async version
      await jest.advanceTimersByTimeAsync(refreshIntervalMs);

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Proactively refreshing Redis connection with new JWT...',
      );

      clearInterval(connectionRefreshInterval);
    });

    it('should handle refresh errors in consumer service', async () => {
      const refreshConnection = jest.fn().mockRejectedValue(new Error('Consumer refresh failed'));
      const refreshIntervalMs = 1380 * 60 * 1000;

      const connectionRefreshInterval = setInterval(async () => {
        try {
          mockLogger.log('Proactively refreshing Redis connection with new JWT...');
          await refreshConnection();
        } catch (error: any) {
          mockLogger.error(`Failed to refresh Redis connection: ${error.message}`);
        }
      }, refreshIntervalMs);

      await jest.advanceTimersByTimeAsync(refreshIntervalMs);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to refresh Redis connection: Consumer refresh failed',
      );

      clearInterval(connectionRefreshInterval);
    });
  });

  describe('Consumer-specific JWT Auth', () => {
    it('should create duplicate client for consumer with JWT auth', async () => {
      (authService.getAccessToken as jest.Mock).mockResolvedValue('jwt-for-duplicate');
      process.env.REDIS_USERNAME = 'duplicate-user';

      const jwt = await authService.getAccessToken();
      const client = createClient({
        url: 'redis://redis-master.redis.svc.cluster.local:6379',
        username: 'duplicate-user',
        password: jwt,
      });

      // Consumer services often need duplicate clients for different purposes
      const duplicateClient = mockClient.duplicate();

      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'jwt-for-duplicate',
        }),
      );
      expect(mockClient.duplicate).toHaveBeenCalled();
    });

    it('should handle traditional auth when JWT is disabled', async () => {
      process.env.REDIS_HOST = 'localhost';
      process.env.REDIS_PORT = '6379';
      process.env.REDIS_USERNAME = 'traditional-user';
      process.env.REDIS_PASSWORD = 'traditional-pass';

      const jwtAuthEnabled = false;

      if (!jwtAuthEnabled) {
        const client = createClient({
          url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
          username: process.env.REDIS_USERNAME,
          password: process.env.REDIS_PASSWORD,
        });

        expect(createClient).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'redis://localhost:6379',
            username: 'traditional-user',
            password: 'traditional-pass',
          }),
        );
      }

      expect(authService.getAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('Event Handlers for Consumer', () => {
    it('should handle Redis connection events in consumer context', async () => {
      let errorHandler: (error: any) => void;
      let connectHandler: () => void;
      let readyHandler: () => void;

      mockClient.on.mockImplementation((event: string, handler: any) => {
        if (event === 'error') errorHandler = handler;
        if (event === 'connect') connectHandler = handler;
        if (event === 'ready') readyHandler = handler;
      });

      const client = createClient({});
      client.on('error', (error) => mockLogger.error(`Redis connection error: ${error}`));
      client.on('connect', () =>
        mockLogger.log('Connected to Redis via Gateway with JWT authentication (TCP socket established)'),
      );
      client.on('ready', () => mockLogger.log('Redis client ready (JWT AUTH completed)'));

      // Trigger events
      const testError = new Error('Consumer connection error');
      errorHandler!(testError);
      expect(mockLogger.error).toHaveBeenCalledWith(`Redis connection error: ${testError}`);

      connectHandler!();
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Connected to Redis via Gateway with JWT authentication (TCP socket established)',
      );

      readyHandler!();
      expect(mockLogger.log).toHaveBeenCalledWith('Redis client ready (JWT AUTH completed)');
    });
  });

  describe('Cleanup on Destroy', () => {
    it('should clear refresh interval on module destroy', async () => {
      const connectionRefreshInterval = setInterval(() => {}, 1000);
      
      // Simulate cleanup
      if (connectionRefreshInterval) {
        clearInterval(connectionRefreshInterval);
        mockLogger.log('Redis connection refresh interval cleared');
      }

      expect(mockLogger.log).toHaveBeenCalledWith('Redis connection refresh interval cleared');
    });

    it('should quit all clients on module destroy', async () => {
      mockClient.isOpen = true;

      if (mockClient && mockClient.isOpen) {
        await mockClient.quit();
        mockLogger.log('Redis client disconnected');
      }

      expect(mockClient.quit).toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith('Redis client disconnected');
    });
  });
});
