jest.mock('axios', () => ({ put: jest.fn() }), { virtual: true });

import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
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
    get: jest.fn().mockReturnValue({}),
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
    const mockRequest = (userId?: string) =>
      ({
        user: userId ? { id: userId } : undefined,
      }) as any;

    it('should update settings to enabled=true', async () => {
      schedulerService.updateAsupSettings.mockResolvedValue({
        enabled: true,
        lastUpdated: '2026-03-04T12:00:00.000Z',
      });

      const result = await controller.updateAsupSettings(
        { enabled: true },
        mockRequest('user-123'),
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
        mockRequest('user-456'),
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

      await controller.updateAsupSettings({ enabled: true }, mockRequest());

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
        controller.updateAsupSettings({ enabled: true }, mockRequest('user-1')),
      ).rejects.toThrow(InternalServerErrorException);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
