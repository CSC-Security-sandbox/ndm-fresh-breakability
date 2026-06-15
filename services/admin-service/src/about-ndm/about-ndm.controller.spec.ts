import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '@nestjs/cache-manager';
import { AboutNdmController } from './about-ndm.controller';
import { AboutNdmService } from './about-ndm.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { AboutNdmResponse } from './about-ndm.interface';
import { Reflector } from '@nestjs/core';

describe('AboutNdmController', () => {
  let controller: AboutNdmController;
  let aboutNdmService: jest.Mocked<AboutNdmService>;

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  beforeEach(async () => {
    const mockAboutNdmService = {
      getAboutNdm: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [CacheModule.register()],
      controllers: [AboutNdmController],
      providers: [
        {
          provide: AboutNdmService,
          useValue: mockAboutNdmService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        Reflector,
        // Mock JwtService for auth guard
        {
          provide: 'JwtService',
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(require('@netapp-cloud-datamigrate/auth-lib').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AboutNdmController>(AboutNdmController);
    aboutNdmService = module.get(AboutNdmService);

    // Clear mocks after controller instantiation, except for the create method
    aboutNdmService.getAboutNdm.mockClear();
    mockLogger.log.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create logger with correct name', () => {
    // Logger is created in constructor, so it should already be called
    expect(mockLoggerFactory.create).toHaveBeenCalledWith('AboutNdmController');
  });

  describe('getBuildVersion', () => {
    it('should return build version information successfully', async () => {
      const mockResponse: AboutNdmResponse = {
        product: {
          name: 'NDM',
          version: 'Preview',
          serialId: 'N/A',
        },
        build: {
          worker_version: {
            version: '1.2.4',
            time: null,
          },
          controlPlane_version: {
            version: '1.2.3',
            time: null,
          },
        },
        contact: {
          email: 'niharika@netapp.com',
          phone: null,
          website: null,
        },
      };

      aboutNdmService.getAboutNdm.mockResolvedValue(mockResponse);

      const result = await controller.getBuildVersion();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Getting NDM product and build information',
      );
      expect(aboutNdmService.getAboutNdm).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResponse);
    });

    it('should return build version with unknown values', async () => {
      const mockResponse: AboutNdmResponse = {
        product: {
          name: 'NDM',
          version: 'Preview',
          serialId: 'N/A',
        },
        build: {
          worker_version: {
            version: 'unknown',
            time: null,
          },
          controlPlane_version: {
            version: 'unknown',
            time: null,
          },
        },
        contact: {
          email: 'niharika@netapp.com',
          phone: null,
          website: null,
        },
      };

      aboutNdmService.getAboutNdm.mockResolvedValue(mockResponse);

      const result = await controller.getBuildVersion();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Getting NDM product and build information',
      );
      expect(aboutNdmService.getAboutNdm).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResponse);
    });

    it('should handle mixed build version values', async () => {
      const mockResponse: AboutNdmResponse = {
        product: {
          name: 'NDM',
          version: 'Preview',
          serialId: 'N/A',
        },
        build: {
          worker_version: {
            version: 'unknown',
            time: null,
          },
          controlPlane_version: {
            version: '2.0.0',
            time: null,
          },
        },
        contact: {
          email: 'niharika@netapp.com',
          phone: null,
          website: null,
        },
      };

      aboutNdmService.getAboutNdm.mockResolvedValue(mockResponse);

      const result = await controller.getBuildVersion();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Getting NDM product and build information',
      );
      expect(aboutNdmService.getAboutNdm).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResponse);
    });

    it('should propagate service errors', async () => {
      const serviceError = new Error('Service error occurred');
      aboutNdmService.getAboutNdm.mockRejectedValue(serviceError);

      await expect(controller.getBuildVersion()).rejects.toThrow(
        'Service error occurred',
      );

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Getting NDM product and build information',
      );
      expect(aboutNdmService.getAboutNdm).toHaveBeenCalledTimes(1);
    });

    it('should log before calling service method', async () => {
      const mockResponse: AboutNdmResponse = {
        product: {
          name: 'NDM',
          version: 'Preview',
          serialId: 'N/A',
        },
        build: {
          worker_version: {
            version: '1.0.0',
            time: null,
          },
          controlPlane_version: {
            version: '1.0.0',
            time: null,
          },
        },
        contact: {
          email: 'niharika@netapp.com',
          phone: null,
          website: null,
        },
      };

      aboutNdmService.getAboutNdm.mockResolvedValue(mockResponse);

      await controller.getBuildVersion();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Getting NDM product and build information',
      );
      expect(aboutNdmService.getAboutNdm).toHaveBeenCalledTimes(1);
    });

    it('should handle empty string build versions', async () => {
      const mockResponse: AboutNdmResponse = {
        product: {
          name: 'NDM',
          version: 'Preview',
          serialId: 'N/A',
        },
        build: {
          worker_version: {
            version: '',
            time: null,
          },
          controlPlane_version: {
            version: '',
            time: null,
          },
        },
        contact: {
          email: 'niharika@netapp.com',
          phone: null,
          website: null,
        },
      };

      aboutNdmService.getAboutNdm.mockResolvedValue(mockResponse);

      const result = await controller.getBuildVersion();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Getting NDM product and build information',
      );
      expect(aboutNdmService.getAboutNdm).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResponse);
    });

    it('should handle service returning null or undefined (edge case)', async () => {
      aboutNdmService.getAboutNdm.mockResolvedValue(null as any);

      const result = await controller.getBuildVersion();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Getting NDM product and build information',
      );
      expect(aboutNdmService.getAboutNdm).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });
  });
});
