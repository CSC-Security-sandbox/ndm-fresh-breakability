import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { Reflector } from '@nestjs/core';
import { User } from '../entities/user.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserPermissionResponse } from './user-permission-response-type';

describe('AuthController', () => {
  let authController: AuthController;

  const mockAuthService = {
    inviteUser: jest.fn(),
    resetPassword: jest.fn(),
    setUserStatus: jest.fn(),
  };

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ['permission1', 'permission2'],
            projects: ['project1'],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  const mockUserRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        Reflector,
        JwtAuthGuard,
      ],
    }).compile();

    authController = module.get<AuthController>(AuthController);
  });

  const userPermissionResponseMock = {
    user: {
      roles: [
        {
          role_name: '',
          projects: [],
          permissions: [],
        },
      ],
      id: '6d4657c8-b19a-47b4-bb2e-bcef5865d4ca', // can be replaced with any string
    },
  } as UserPermissionResponse;

  describe('inviteUser', () => {
    it('should invite a user and return the result', async () => {
      const mockInviteUserDto = {
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
      };

      const mockResponse = {
        user: { id: '123', email: 'testuser' },
        tempPassword: 'randomPass123',
      };

      mockAuthService.inviteUser.mockResolvedValue(mockResponse);

      const result = await authController.inviteUser(
        mockInviteUserDto,
        userPermissionResponseMock,
      );

      expect(result).toEqual(mockResponse);
      expect(mockAuthService.inviteUser).toHaveBeenCalledWith(
        mockInviteUserDto.username,
        mockInviteUserDto.firstName,
        mockInviteUserDto.lastName,
        userPermissionResponseMock,
      );
    });
  });

  describe('getPermissions', () => {
    it('should return user permissions from the request object', async () => {
      const mockRequest = {
        user: {
          roles: [
            {
              permissions: ['permission1', 'permission2'],
              projects: ['project1'],
            },
          ],
        },
      };

      const result = await authController.getPermissions(mockRequest);

      expect(result).toEqual(mockRequest.user);
    });

    it('should handle cases where user object is not defined', async () => {
      const mockRequest = {};

      const result = await authController.getPermissions(mockRequest);

      expect(result).toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    it('should reset the password for the given email and return the new password', async () => {
      const email = 'testuser@example.com';
      const newPassword = 'newRandomPass123';

      mockAuthService.resetPassword.mockResolvedValue(newPassword);

      const result = await authController.resetPassword(email);

      expect(result).toEqual({ email, newPassword });
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(email);
    });

    it('should handle errors gracefully when resetting password fails', async () => {
      const email = 'invaliduser@example.com';
      const mockError = new Error('User not found');

      mockAuthService.resetPassword.mockRejectedValue(mockError);

      try {
        await authController.resetPassword(email);
      } catch (error) {
        expect(error).toBe(mockError);
      }
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(email);
    });
  });

  describe('setUserStatus', () => {
    it('should enable or disable a user based on the email and enable flag', async () => {
      const mockUserStatusDto = {
        email: 'testuser@example.com',
        enable: true,
      };

      const mockUser = {
        id: '123',
        email: 'testuser@example.com',
        isActive: false,
      };

      mockAuthService.setUserStatus.mockResolvedValue(mockUser);

      const result = await authController.setUserStatus(mockUserStatusDto);

      expect(result).toEqual(mockUser);
      expect(mockAuthService.setUserStatus).toHaveBeenCalledWith(
        mockUserStatusDto.email,
        mockUserStatusDto.enable,
      );
    });

    it('should disable a user based on the email and enable flag', async () => {
      const mockUserStatusDto = {
        email: 'testuser@example.com',
        enable: false,
      };

      const mockUser = {
        id: '123',
        email: 'testuser@example.com',
        isActive: true,
      };

      mockAuthService.setUserStatus.mockResolvedValue(mockUser);

      const result = await authController.setUserStatus(mockUserStatusDto);

      expect(result).toEqual(mockUser);
      expect(mockAuthService.setUserStatus).toHaveBeenCalledWith(
        mockUserStatusDto.email,
        mockUserStatusDto.enable,
      );
    });
  });

  describe('getRedisCredentials', () => {
    const originalEnv = { ...process.env };
    const redisEnvKeys = [
      'REDIS_EXTERNAL_HOST',
      'REDIS_HOST',
      'REDIS_EXTERNAL_PORT',
      'REDIS_USERNAME',
      'REDIS_PASSWORD',
    ];

    // Helper function to set up environment variables for a test
    const setRedisEnv = (env: {
      REDIS_EXTERNAL_HOST?: string;
      REDIS_HOST?: string;
      REDIS_EXTERNAL_PORT?: string;
      REDIS_USERNAME?: string;
      REDIS_PASSWORD?: string;
    }) => {
      // Clear all Redis-related env vars first
      redisEnvKeys.forEach(key => {
        delete process.env[key];
      });
      // Set the provided env vars
      Object.entries(env).forEach(([key, value]) => {
        if (value !== undefined) {
          process.env[key] = value;
        }
      });
    };

    beforeEach(() => {
      // Clear Redis env vars before each test
      redisEnvKeys.forEach(key => {
        delete process.env[key];
      });
    });

    afterEach(() => {
      // Restore original Redis env vars after each test
      redisEnvKeys.forEach(key => {
        if (key in originalEnv) {
          process.env[key] = originalEnv[key];
        } else {
          delete process.env[key];
        }
      });
    });

    it('should return Redis credentials with REDIS_EXTERNAL_HOST when set', async () => {
      setRedisEnv({
        REDIS_EXTERNAL_HOST: 'external-redis.example.com',
        REDIS_HOST: 'internal-redis.example.com',
        REDIS_EXTERNAL_PORT: '6380',
        REDIS_USERNAME: 'redis-user',
        REDIS_PASSWORD: 'redis-pass',
      });

      const mockRequest = {};
      const result = await authController.getRedisCredentials(mockRequest);

      expect(result).toEqual({
        host: 'external-redis.example.com',
        port: '6380',
        username: 'redis-user',
        password: 'redis-pass',
      });
    });

    it('should return Redis credentials with REDIS_HOST when REDIS_EXTERNAL_HOST is not set', async () => {
      setRedisEnv({
        REDIS_HOST: 'internal-redis.example.com',
        REDIS_EXTERNAL_PORT: '6380',
        REDIS_USERNAME: 'redis-user',
        REDIS_PASSWORD: 'redis-pass',
      });

      const mockRequest = {};
      const result = await authController.getRedisCredentials(mockRequest);

      expect(result).toEqual({
        host: 'internal-redis.example.com',
        port: '6380',
        username: 'redis-user',
        password: 'redis-pass',
      });
    });

    it('should return default port 6379 when REDIS_EXTERNAL_PORT is not set', async () => {
      setRedisEnv({
        REDIS_EXTERNAL_HOST: 'external-redis.example.com',
        REDIS_USERNAME: 'redis-user',
        REDIS_PASSWORD: 'redis-pass',
      });

      const mockRequest = {};
      const result = await authController.getRedisCredentials(mockRequest);

      expect(result).toEqual({
        host: 'external-redis.example.com',
        port: '6379',
        username: 'redis-user',
        password: 'redis-pass',
      });
    });

    it('should return Redis credentials with all optional fields undefined', async () => {
      setRedisEnv({
        REDIS_EXTERNAL_HOST: 'external-redis.example.com',
      });

      const mockRequest = {};
      const result = await authController.getRedisCredentials(mockRequest);

      expect(result).toEqual({
        host: 'external-redis.example.com',
        port: '6379',
        username: undefined,
        password: undefined,
      });
    });

    it('should return Redis credentials when both REDIS_EXTERNAL_HOST and REDIS_HOST are not set', async () => {
      setRedisEnv({
        REDIS_EXTERNAL_PORT: '6380',
        REDIS_USERNAME: 'redis-user',
        REDIS_PASSWORD: 'redis-pass',
      });

      const mockRequest = {};
      const result = await authController.getRedisCredentials(mockRequest);

      expect(result).toEqual({
        host: undefined,
        port: '6380',
        username: 'redis-user',
        password: 'redis-pass',
      });
    });

    it('should prioritize REDIS_EXTERNAL_HOST over REDIS_HOST when both are set', async () => {
      setRedisEnv({
        REDIS_EXTERNAL_HOST: 'external-redis.example.com',
        REDIS_HOST: 'internal-redis.example.com',
        REDIS_USERNAME: 'redis-user',
        REDIS_PASSWORD: 'redis-pass',
      });

      const mockRequest = {};
      const result = await authController.getRedisCredentials(mockRequest);

      expect(result.host).toBe('external-redis.example.com');
      expect(result.port).toBe('6379');
      expect(result.username).toBe('redis-user');
      expect(result.password).toBe('redis-pass');
    });

    it('should handle empty string values correctly', async () => {
      setRedisEnv({
        REDIS_EXTERNAL_HOST: '',
        REDIS_HOST: 'internal-redis.example.com',
        REDIS_EXTERNAL_PORT: '',
      });

      const mockRequest = {};
      const result = await authController.getRedisCredentials(mockRequest);

      // Empty string is falsy, so it should fall back to REDIS_HOST
      expect(result.host).toBe('internal-redis.example.com');
      // Empty string for port should fall back to default
      expect(result.port).toBe('6379');
    });
  });
});
