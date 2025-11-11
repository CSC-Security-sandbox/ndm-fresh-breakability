import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthService } from 'src/auth/auth.service';
import { of, throwError } from 'rxjs';
import {
  fetchRedisCredentials,
  updateRedisConfig,
  fetchAndUpdateRedisCredentials,
  RedisCredentials,
} from './redis';

describe('Redis Utils', () => {
  let httpService: jest.Mocked<HttpService>;
  let authService: jest.Mocked<AuthService>;
  let configService: jest.Mocked<ConfigService>;
  let logger: jest.Mocked<LoggerService>;

  beforeEach(() => {
    httpService = {
      get: jest.fn(),
    } as any;

    authService = {
      getAccessToken: jest.fn(),
    } as any;

    configService = {
      get: jest.fn(),
    } as any;

    logger = {
      debug: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    } as any;

    // Clear environment variables
    delete process.env.REDIS_USERNAME;
    delete process.env.REDIS_PASSWORD;
  });

  describe('fetchRedisCredentials', () => {
    const mockWorkerConfigUrl = 'https://admin.example.com';
    const mockWorkerId = 'worker-123';

    beforeEach(() => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'worker.connection.workerConfigUrl') return mockWorkerConfigUrl;
        if (key === 'worker.workerId') return mockWorkerId;
        return null;
      });
    });

    it('should successfully fetch Redis credentials', async () => {
      const mockAccessToken = 'mock-access-token';
      const mockCredentials = {
        host: 'redis.example.com',
        username: 'redis-user',
        password: 'redis-password',
      };

      authService.getAccessToken.mockResolvedValue(mockAccessToken);
      
      const mockResponse = {
        status: 200,
        data: {
          data: {
            items: mockCredentials,
          },
        },
      };

      httpService.get.mockReturnValue(of(mockResponse));

      const result = await fetchRedisCredentials(httpService, authService, configService, logger);

      expect(result).toEqual(mockCredentials);
      expect(authService.getAccessToken).toHaveBeenCalledTimes(1);
      expect(httpService.get).toHaveBeenCalledWith(
        `${mockWorkerConfigUrl}/api/v1/secrets/redis`,
        {
          headers: {
            Authorization: `Bearer ${mockAccessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      );

      expect(logger.debug).toHaveBeenCalledWith('=== Starting Redis credentials fetch ===');
      expect(logger.debug).toHaveBeenCalledWith(`Worker ID: ${mockWorkerId}`);
      expect(logger.log).toHaveBeenCalledWith('Redis credentials fetched successfully:');
      expect(logger.debug).toHaveBeenCalledWith(`  Host: ${mockCredentials.host}`);
      expect(logger.debug).toHaveBeenCalledWith(`  Username: ${mockCredentials.username}`);
      expect(logger.debug).toHaveBeenCalledWith(`  Password length: ${mockCredentials.password.length}`);
    });

    it('should throw error when access token is not available', async () => {
      authService.getAccessToken.mockResolvedValue(null);

      await expect(
        fetchRedisCredentials(httpService, authService, configService, logger),
      ).rejects.toThrow('Redis credentials are required for worker operation: Failed to get access token');

      expect(logger.error).toHaveBeenCalledWith('Failed to fetch Redis credentials: Failed to get access token');
    });

    it('should throw error when access token is undefined', async () => {
      authService.getAccessToken.mockResolvedValue(undefined);

      await expect(
        fetchRedisCredentials(httpService, authService, configService, logger),
      ).rejects.toThrow('Redis credentials are required for worker operation: Failed to get access token');
    });

    it('should throw error when HTTP request fails', async () => {
      const mockAccessToken = 'mock-access-token';
      const errorMessage = 'Network error';

      authService.getAccessToken.mockResolvedValue(mockAccessToken);
      httpService.get.mockReturnValue(throwError(() => new Error(errorMessage)));

      await expect(
        fetchRedisCredentials(httpService, authService, configService, logger),
      ).rejects.toThrow(`Redis credentials are required for worker operation: ${errorMessage}`);

      expect(logger.error).toHaveBeenCalledWith(`Failed to fetch Redis credentials: ${errorMessage}`);
    });

    it('should throw error when HTTP response status is not 200', async () => {
      const mockAccessToken = 'mock-access-token';

      authService.getAccessToken.mockResolvedValue(mockAccessToken);
      
      const mockResponse = {
        status: 401,
        data: {},
      };

      httpService.get.mockReturnValue(of(mockResponse));

      await expect(
        fetchRedisCredentials(httpService, authService, configService, logger),
      ).rejects.toThrow('Redis credentials are required for worker operation: Failed to fetch Redis credentials. Status: 401');

      expect(logger.error).toHaveBeenCalledWith('Failed to fetch Redis credentials: Failed to fetch Redis credentials. Status: 401');
    });

    it('should throw error when Redis credentials are incomplete - missing host', async () => {
      const mockAccessToken = 'mock-access-token';

      authService.getAccessToken.mockResolvedValue(mockAccessToken);
      
      const mockResponse = {
        status: 200,
        data: {
          data: {
            items: {
              username: 'redis-user',
              password: 'redis-password',
              // host is missing
            },
          },
        },
      };

      httpService.get.mockReturnValue(of(mockResponse));

      await expect(
        fetchRedisCredentials(httpService, authService, configService, logger),
      ).rejects.toThrow('Redis credentials are required for worker operation: Incomplete Redis credentials received from API');
    });

    it('should throw error when Redis credentials are incomplete - missing username', async () => {
      const mockAccessToken = 'mock-access-token';

      authService.getAccessToken.mockResolvedValue(mockAccessToken);
      
      const mockResponse = {
        status: 200,
        data: {
          data: {
            items: {
              host: 'redis.example.com',
              password: 'redis-password',
              // username is missing
            },
          },
        },
      };

      httpService.get.mockReturnValue(of(mockResponse));

      await expect(
        fetchRedisCredentials(httpService, authService, configService, logger),
      ).rejects.toThrow('Redis credentials are required for worker operation: Incomplete Redis credentials received from API');
    });

    it('should throw error when Redis credentials are incomplete - missing password', async () => {
      const mockAccessToken = 'mock-access-token';

      authService.getAccessToken.mockResolvedValue(mockAccessToken);
      
      const mockResponse = {
        status: 200,
        data: {
          data: {
            items: {
              host: 'redis.example.com',
              username: 'redis-user',
              // password is missing
            },
          },
        },
      };

      httpService.get.mockReturnValue(of(mockResponse));

      await expect(
        fetchRedisCredentials(httpService, authService, configService, logger),
      ).rejects.toThrow('Redis credentials are required for worker operation: Incomplete Redis credentials received from API');
    });

    it('should throw error when response data structure is invalid', async () => {
      const mockAccessToken = 'mock-access-token';

      authService.getAccessToken.mockResolvedValue(mockAccessToken);
      
      const mockResponse = {
        status: 200,
        data: {
          // missing data.items structure
        },
      };

      httpService.get.mockReturnValue(of(mockResponse));

      await expect(
        fetchRedisCredentials(httpService, authService, configService, logger),
      ).rejects.toThrow('Redis credentials are required for worker operation: Incomplete Redis credentials received from API');
    });
  });

  describe('updateRedisConfig', () => {
    it('should successfully update Redis configuration', () => {
      const mockCredentials: RedisCredentials = {
        host: 'redis.example.com',
        username: 'redis-user',
        password: 'redis-password',
      };

      updateRedisConfig(mockCredentials, logger);

      expect(process.env.REDIS_USERNAME).toBe(mockCredentials.username);
      expect(process.env.REDIS_PASSWORD).toBe(mockCredentials.password);
      expect(logger.log).toHaveBeenCalledWith('Redis configuration updated successfully');
    });

    it('should throw error when credentials are not provided', () => {
      expect(() => updateRedisConfig(null as any, logger)).toThrow('Redis credentials not available');
    });

    it('should throw error when credentials are undefined', () => {
      expect(() => updateRedisConfig(undefined as any, logger)).toThrow('Redis credentials not available');
    });
  });

  describe('fetchAndUpdateRedisCredentials', () => {
    it('should successfully fetch and update Redis credentials', async () => {
      const mockAccessToken = 'mock-access-token';
      const mockCredentials: RedisCredentials = {
        host: 'redis.example.com',
        username: 'redis-user',
        password: 'redis-password',
      };

      configService.get.mockImplementation((key: string) => {
        if (key === 'worker.connection.workerConfigUrl') return 'https://admin.example.com';
        if (key === 'worker.workerId') return 'worker-123';
        return null;
      });

      authService.getAccessToken.mockResolvedValue(mockAccessToken);
      
      const mockResponse = {
        status: 200,
        data: {
          data: {
            items: mockCredentials,
          },
        },
      };

      httpService.get.mockReturnValue(of(mockResponse));

      await fetchAndUpdateRedisCredentials(httpService, authService, configService, logger);

      expect(process.env.REDIS_USERNAME).toBe(mockCredentials.username);
      expect(process.env.REDIS_PASSWORD).toBe(mockCredentials.password);
      expect(logger.log).toHaveBeenCalledWith('Redis configuration updated successfully');
    });

    it('should throw error when fetchRedisCredentials fails', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'worker.connection.workerConfigUrl') return 'https://admin.example.com';
        if (key === 'worker.workerId') return 'worker-123';
        return null;
      });

      authService.getAccessToken.mockResolvedValue(null);

      await expect(
        fetchAndUpdateRedisCredentials(httpService, authService, configService, logger),
      ).rejects.toThrow('Redis credentials are required for worker operation: Failed to get access token');
    });
  });
});
