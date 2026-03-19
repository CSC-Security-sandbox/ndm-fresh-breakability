jest.mock('axios', () => ({ put: jest.fn() }), { virtual: true });

import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AsupController } from './asup.controller';
import { AsupSchedulerService } from './asup-scheduler.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { JwtAuthGuard, JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

describe('AsupController', () => {
  let controller: AsupController;
  let schedulerService: jest.Mocked<AsupSchedulerService>;

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  const mockJwtService = {
    verifyToken: jest.fn(),
    decode: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'KEYCLOAK_INTERNAL_SECRET') return 'test-internal-secret';
      return {};
    }),
  };

  const mockJwtAuthGuard = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    schedulerService = {
      getAsupSettings: jest.fn(),
      updateAsupSettings: jest.fn(),
      handleAsupTransmission: jest.fn(),
      transmitAsupMetrics: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AsupController],
      providers: [
        {
          provide: AsupSchedulerService,
          useValue: schedulerService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: Reflector,
          useValue: { get: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    controller = module.get<AsupController>(AsupController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── GET /asup/settings ─────────────────────────────────────

  describe('getAsupSettings', () => {
    it('should return settings with enabled=true and lastUpdated', async () => {
      schedulerService.getAsupSettings.mockResolvedValue({
        enabled: true,
        lastUpdated: '2026-03-04T00:00:00.000Z',
      });

      const result = await controller.getAsupSettings();

      expect(result).toEqual({
        enabled: true,
        lastUpdated: '2026-03-04T00:00:00.000Z',
      });
      expect(schedulerService.getAsupSettings).toHaveBeenCalledTimes(1);
    });

    it('should return settings with enabled=false and no lastUpdated', async () => {
      schedulerService.getAsupSettings.mockResolvedValue({
        enabled: false,
        lastUpdated: null,
      });

      const result = await controller.getAsupSettings();

      expect(result).toEqual({ enabled: false });
      expect(result).not.toHaveProperty('lastUpdated');
    });

    it('should omit lastUpdated when it is null', async () => {
      schedulerService.getAsupSettings.mockResolvedValue({
        enabled: true,
        lastUpdated: null,
      });

      const result = await controller.getAsupSettings();

      expect(result.enabled).toBe(true);
      expect(result).not.toHaveProperty('lastUpdated');
    });

    it('should throw InternalServerErrorException on service error', async () => {
      schedulerService.getAsupSettings.mockRejectedValue(new Error('DB down'));

      await expect(controller.getAsupSettings()).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ─── PUT /asup/settings ─────────────────────────────────────

  describe('updateAsupSettings', () => {
    const mockRequest = (headers: Record<string, string> = {}) =>
      ({
        headers,
      }) as any;

    it('should update settings to enabled=true', async () => {
      schedulerService.updateAsupSettings.mockResolvedValue({
        enabled: true,
        lastUpdated: '2026-03-04T12:00:00.000Z',
      });

      const result = await controller.updateAsupSettings(
        { enabled: true },
        mockRequest({}),
        'test-internal-secret',  // internalSecret header
        'user-123',              // userIdHeader
      );

      expect(result).toEqual({
        enabled: true,
        lastUpdated: '2026-03-04T12:00:00.000Z',
      });
      expect(schedulerService.updateAsupSettings).toHaveBeenCalledWith(
        true,
        'user-123',
      );
    });

    it('should update settings to enabled=false', async () => {
      schedulerService.updateAsupSettings.mockResolvedValue({
        enabled: false,
        lastUpdated: '2026-03-04T12:00:00.000Z',
      });

      const result = await controller.updateAsupSettings(
        { enabled: false },
        mockRequest({}),
        'test-internal-secret',  // internalSecret header
        'user-456',              // userIdHeader
      );

      expect(result.enabled).toBe(false);
      expect(schedulerService.updateAsupSettings).toHaveBeenCalledWith(
        false,
        'user-456',
      );
    });

    it('should pass null userId when user is not in request', async () => {
      schedulerService.updateAsupSettings.mockResolvedValue({
        enabled: true,
        lastUpdated: null,
      });

      await controller.updateAsupSettings(
        { enabled: true },
        mockRequest({}),
        'test-internal-secret',  // internalSecret header
        undefined,               // no userIdHeader
      );

      expect(schedulerService.updateAsupSettings).toHaveBeenCalledWith(
        true,
        null,
      );
    });

    it('should throw InternalServerErrorException on service error', async () => {
      schedulerService.updateAsupSettings.mockRejectedValue(
        new Error('DB write failed'),
      );

      await expect(
        controller.updateAsupSettings(
          { enabled: true },
          mockRequest({}),
          'test-internal-secret',
          'user-1',
        ),
      ).rejects.toThrow(InternalServerErrorException);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    // JWT authentication path tests
    it('should throw UnauthorizedException when no authorization header and no internal secret', async () => {
      await expect(
        controller.updateAsupSettings(
          { enabled: true },
          mockRequest({}),
          undefined, // no internal secret
          undefined,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when authorization header has no token', async () => {
      await expect(
        controller.updateAsupSettings(
          { enabled: true },
          mockRequest({ authorization: 'Bearer ' }),
          undefined,
          undefined,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when JWT token is invalid', async () => {
      mockJwtService.verifyToken.mockRejectedValue(new Error('Invalid token'));

      await expect(
        controller.updateAsupSettings(
          { enabled: true },
          mockRequest({ authorization: 'Bearer invalid-token' }),
          undefined,
          undefined,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when JWT token has no user', async () => {
      mockJwtService.verifyToken.mockResolvedValue({ sub: 'some-sub' });

      await expect(
        controller.updateAsupSettings(
          { enabled: true },
          mockRequest({ authorization: 'Bearer valid-token' }),
          undefined,
          undefined,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException when user has no Reports permission', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: {
          id: 'user-123',
          roles: [
            {
              projects: [],
              permissions: ['SomeOtherPermission'],
            },
          ],
        },
        sub: 'user-123',
      });

      await expect(
        controller.updateAsupSettings(
          { enabled: true },
          mockRequest({ authorization: 'Bearer valid-token', projectid: 'project-1' }),
          undefined,
          undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should update settings via JWT when user has Reports permission', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: {
          id: 'jwt-user-123',
          roles: [
            {
              projects: [],
              permissions: ['Reports'],
            },
          ],
        },
        sub: 'jwt-user-123',
      });
      schedulerService.updateAsupSettings.mockResolvedValue({
        enabled: true,
        lastUpdated: '2026-03-04T12:00:00.000Z',
      });

      const result = await controller.updateAsupSettings(
        { enabled: true },
        mockRequest({ authorization: 'Bearer valid-token', projectid: 'project-1' }),
        undefined,
        undefined,
      );

      expect(result).toEqual({
        enabled: true,
        lastUpdated: '2026-03-04T12:00:00.000Z',
      });
      expect(schedulerService.updateAsupSettings).toHaveBeenCalledWith(
        true,
        'jwt-user-123',
      );
    });

    it('should update settings via JWT when user has permission for specific project', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: {
          id: 'jwt-user-456',
          roles: [
            {
              projects: ['project-1'],
              permissions: ['Reports'],
            },
          ],
        },
        sub: 'jwt-user-456',
      });
      schedulerService.updateAsupSettings.mockResolvedValue({
        enabled: false,
        lastUpdated: null,
      });

      const result = await controller.updateAsupSettings(
        { enabled: false },
        mockRequest({ authorization: 'Bearer valid-token', projectid: 'project-1' }),
        undefined,
        undefined,
      );

      expect(result).toEqual({ enabled: false });
      expect(schedulerService.updateAsupSettings).toHaveBeenCalledWith(
        false,
        'jwt-user-456',
      );
    });

    it('should use sub as userId when user.id is not available', async () => {
      mockJwtService.verifyToken.mockResolvedValue({
        user: {
          roles: [
            {
              projects: [],
              permissions: ['Reports'],
            },
          ],
        },
        sub: 'sub-user-789',
      });
      schedulerService.updateAsupSettings.mockResolvedValue({
        enabled: true,
        lastUpdated: null,
      });

      await controller.updateAsupSettings(
        { enabled: true },
        mockRequest({ authorization: 'Bearer valid-token' }),
        undefined,
        undefined,
      );

      expect(schedulerService.updateAsupSettings).toHaveBeenCalledWith(
        true,
        'sub-user-789',
      );
    });

    it('should throw UnauthorizedException when internal secret does not match', async () => {
      await expect(
        controller.updateAsupSettings(
          { enabled: true },
          mockRequest({}),
          'wrong-internal-secret',
          'user-123',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
