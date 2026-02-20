import { Test, TestingModule } from '@nestjs/testing';
import { AboutNdmService } from './about-ndm.service';
import { PrometheusService } from '../utils/prometheus';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GlobalSettings } from '../entities/global-setting.entity';
import { GLOBAL_SETTING_KEYS } from './about-ndm.constants';

describe('AboutNdmService', () => {
  let service: AboutNdmService;
  let prometheusService: jest.Mocked<PrometheusService>;
  let globalSettingsRepo: Record<string, jest.Mock>;

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  const mockLoggerFactory = {
    create: jest.fn().mockReturnValue(mockLogger),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
      switch (key) {
        case 'NDM_CONTACT_EMAIL':
          return 'niharika@netapp.com';
        case 'NDM_CONTACT_PHONE':
          return null;
        case 'NDM_CONTACT_WEBSITE':
          return null;
        default:
          return defaultValue;
      }
    }),
  } as any;

  beforeEach(async () => {
    const mockPrometheusService = {
      queryPrometheus: jest.fn(),
    };

    globalSettingsRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AboutNdmService,
        {
          provide: PrometheusService,
          useValue: mockPrometheusService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: getRepositoryToken(GlobalSettings),
          useValue: globalSettingsRepo,
        },
      ],
    }).compile();

    service = module.get<AboutNdmService>(AboutNdmService);
    prometheusService = module.get(PrometheusService);

    prometheusService.queryPrometheus.mockClear();
    globalSettingsRepo.findOne.mockClear();
    mockLogger.log.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create logger with correct name', () => {
    expect(mockLoggerFactory.create).toHaveBeenCalledWith('AboutNdmService');
  });

  describe('getAboutNdm', () => {
    it('should return CP version from global_settings and worker version from Prometheus', async () => {
      globalSettingsRepo.findOne.mockResolvedValueOnce({
        settingKey: GLOBAL_SETTING_KEYS.CP_VERSION,
        settingValue: '1.2.3',
      });

      const mockWorkerResponse = {
        data: {
          result: [
            {
              metric: {
                label_build_version: '1.2.4',
                __name__: 'worker_info',
              },
            },
          ],
        },
      };
      prometheusService.queryPrometheus.mockResolvedValueOnce(
        mockWorkerResponse,
      );

      const result = await service.getAboutNdm();

      expect(globalSettingsRepo.findOne).toHaveBeenCalledWith({
        where: { settingKey: GLOBAL_SETTING_KEYS.CP_VERSION },
      });
      expect(prometheusService.queryPrometheus).toHaveBeenCalledTimes(1);

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
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
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Found control plane version from global_settings: 1.2.3',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Found build version: 1.2.4',
      );
    });

    it('should return N/A when CP_VERSION setting is not found in database', async () => {
      globalSettingsRepo.findOne.mockResolvedValueOnce(null);

      const mockWorkerResponse = {
        data: {
          result: [
            {
              metric: {
                label_build_version: '1.2.4',
                __name__: 'worker_info',
              },
            },
          ],
        },
      };
      prometheusService.queryPrometheus.mockResolvedValueOnce(
        mockWorkerResponse,
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');
      expect(result.build.worker_version.version).toBe('1.2.4');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Global setting '${GLOBAL_SETTING_KEYS.CP_VERSION}' not found in database`,
      );
    });

    it('should return N/A for CP version when database query fails', async () => {
      globalSettingsRepo.findOne.mockRejectedValueOnce(
        new Error('Database connection error'),
      );

      const mockWorkerResponse = {
        data: {
          result: [
            {
              metric: {
                label_build_version: '1.0.0',
                __name__: 'worker_info',
              },
            },
          ],
        },
      };
      prometheusService.queryPrometheus.mockResolvedValueOnce(
        mockWorkerResponse,
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');
      expect(result.build.worker_version.version).toBe('1.0.0');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error reading control plane version from global_settings',
        expect.any(Error),
      );
    });

    it('should return N/A for worker version when Prometheus query fails', async () => {
      globalSettingsRepo.findOne.mockResolvedValueOnce({
        settingKey: GLOBAL_SETTING_KEYS.CP_VERSION,
        settingValue: '1.0.0',
      });

      prometheusService.queryPrometheus.mockRejectedValueOnce(
        new Error('Prometheus unreachable'),
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('1.0.0');
      expect(result.build.worker_version.version).toBe('N/A');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Prometheus query for worker version failed:',
        expect.any(Error),
      );
    });

    it('should return N/A for both when both sources fail', async () => {
      globalSettingsRepo.findOne.mockRejectedValueOnce(
        new Error('DB error'),
      );
      prometheusService.queryPrometheus.mockRejectedValueOnce(
        new Error('Prometheus error'),
      );

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
        },
        build: {
          worker_version: {
            version: 'N/A',
            time: null,
          },
          controlPlane_version: {
            version: 'N/A',
            time: null,
          },
        },
        contact: {
          email: 'niharika@netapp.com',
          phone: null,
          website: null,
        },
      });
    });

    it('should return N/A for worker when Prometheus response has no build version', async () => {
      globalSettingsRepo.findOne.mockResolvedValueOnce({
        settingKey: GLOBAL_SETTING_KEYS.CP_VERSION,
        settingValue: '2.0.0',
      });

      const mockResponseWithoutBuildVersion = {
        data: {
          result: [
            {
              metric: {
                __name__: 'worker_info',
              },
            },
          ],
        },
      };
      prometheusService.queryPrometheus.mockResolvedValueOnce(
        mockResponseWithoutBuildVersion,
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('2.0.0');
      expect(result.build.worker_version.version).toBe('N/A');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No label_build_version found in Prometheus results',
      );
    });

    it('should handle invalid Prometheus response structure for worker', async () => {
      globalSettingsRepo.findOne.mockResolvedValueOnce({
        settingKey: GLOBAL_SETTING_KEYS.CP_VERSION,
        settingValue: '1.5.0',
      });

      const mockInvalidResponse = { invalid: 'structure' };
      prometheusService.queryPrometheus.mockResolvedValueOnce(
        mockInvalidResponse,
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('1.5.0');
      expect(result.build.worker_version.version).toBe('N/A');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid Prometheus response structure:',
        mockInvalidResponse,
      );
    });

    it('should handle Prometheus response with null metric for worker', async () => {
      globalSettingsRepo.findOne.mockResolvedValueOnce({
        settingKey: GLOBAL_SETTING_KEYS.CP_VERSION,
        settingValue: '1.0.0',
      });

      const mockResponseWithNullMetric = {
        data: {
          result: [{ metric: null }],
        },
      };
      prometheusService.queryPrometheus.mockResolvedValueOnce(
        mockResponseWithNullMetric,
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('1.0.0');
      expect(result.build.worker_version.version).toBe('N/A');
    });

    it('should find worker build version in second result item', async () => {
      globalSettingsRepo.findOne.mockResolvedValueOnce({
        settingKey: GLOBAL_SETTING_KEYS.CP_VERSION,
        settingValue: '2.0.0',
      });

      const mockWorkerResponse = {
        data: {
          result: [
            {
              metric: {
                __name__: 'worker_info',
              },
            },
            {
              metric: {
                label_build_version: '2.0.0',
                __name__: 'worker_info',
              },
            },
          ],
        },
      };
      prometheusService.queryPrometheus.mockResolvedValueOnce(
        mockWorkerResponse,
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('2.0.0');
      expect(result.build.worker_version.version).toBe('2.0.0');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Found build version: 2.0.0',
      );
    });

    it('should handle Prometheus response with null data for worker', async () => {
      globalSettingsRepo.findOne.mockResolvedValueOnce({
        settingKey: GLOBAL_SETTING_KEYS.CP_VERSION,
        settingValue: '1.0.0',
      });

      const mockNullDataResponse = { data: null };
      prometheusService.queryPrometheus.mockResolvedValueOnce(
        mockNullDataResponse,
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('1.0.0');
      expect(result.build.worker_version.version).toBe('N/A');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid Prometheus response structure:',
        mockNullDataResponse,
      );
    });

    it('should handle empty worker Prometheus results', async () => {
      globalSettingsRepo.findOne.mockResolvedValueOnce({
        settingKey: GLOBAL_SETTING_KEYS.CP_VERSION,
        settingValue: '3.0.0',
      });

      const mockEmptyResponse = { data: { result: [] } };
      prometheusService.queryPrometheus.mockResolvedValueOnce(
        mockEmptyResponse,
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('3.0.0');
      expect(result.build.worker_version.version).toBe('N/A');
    });
  });
});
