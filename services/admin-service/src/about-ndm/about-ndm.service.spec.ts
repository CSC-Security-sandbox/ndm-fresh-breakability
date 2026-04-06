import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AboutNdmService } from './about-ndm.service';
import { PrometheusService } from '../utils/prometheus';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigService } from '@nestjs/config';
import { WorkerEntity } from '../entities/worker.entity';
import BUILD_VERSION_QUERIES from './about-ndm.constants';
import { GlobalSettings } from '../entities/global-setting.entity';
import { promises as fs } from 'fs';

describe('AboutNdmService', () => {
  let service: AboutNdmService;
  let prometheusService: jest.Mocked<PrometheusService>;
  let workerRepository: Record<string, jest.Mock>;
  let settingsRepository: Record<string, jest.Mock>;

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

    workerRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    settingsRepository = {
      findOne: jest.fn().mockResolvedValue(null),
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
          provide: getRepositoryToken(WorkerEntity),
          useValue: workerRepository,
        },
        {
          provide: getRepositoryToken(GlobalSettings),
          useValue: settingsRepository,
        },
      ],
    }).compile();

    service = module.get<AboutNdmService>(AboutNdmService);
    prometheusService = module.get(PrometheusService);

    prometheusService.queryPrometheus.mockClear();
    mockLogger.log.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create logger with correct name', () => {
    expect(mockLoggerFactory.create).toHaveBeenCalledWith('AboutNdmService');
  });

  describe('getAboutNdm', () => {
    it('should extract label_build_version from successful Prometheus response and worker version from DB', async () => {
      const mockControlPlaneResponse = {
        data: {
          result: [
            {
              metric: {
                label_build_version: '1.2.3',
                __name__: 'kube_pod_labels',
                namespace: 'datamigrator',
              },
            },
          ],
        },
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockControlPlaneResponse);

      workerRepository.find.mockResolvedValueOnce([
        { workerName: 'worker-1', ipAddress: '10.0.0.1', workerVersion: '1.2.4', platform: 'linux' },
      ]);

      const result = await service.getAboutNdm();

      expect(prometheusService.queryPrometheus).toHaveBeenCalledTimes(1);
      expect(prometheusService.queryPrometheus).toHaveBeenCalledWith(
        BUILD_VERSION_QUERIES.CONTROL_PLANE,
      );

      expect(result).toEqual({
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
          workersByVersion: {
            '1.2.4': [{ workerName: 'worker-1', ipAddress: '10.0.0.1', platform: 'linux' }],
          },
        },
        contact: {
          email: 'niharika@netapp.com',
          phone: null,
          website: null,
        },
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Found build version: 1.2.3',
      );
    });

    it('should return N/A for worker version when no workers exist in DB', async () => {
      const mockControlPlaneResponse = {
        data: {
          result: [
            {
              metric: {
                label_build_version: '1.2.3',
                __name__: 'kube_pod_labels',
                namespace: 'datamigrator',
              },
            },
          ],
        },
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockControlPlaneResponse);
      workerRepository.find.mockResolvedValueOnce([]);

      const result = await service.getAboutNdm();

      expect(result.build.worker_version.version).toBe('N/A');
      expect(result.build.controlPlane_version.version).toBe('1.2.3');
      expect(result.build.workersByVersion).toEqual({});
    });

    it('should return unknown when label_build_version is not found in response', async () => {
      const mockResponseWithoutBuildVersion = {
        data: {
          result: [
            {
              metric: {
                __name__: 'kube_pod_labels',
                namespace: 'datamigrator',
              },
            },
          ],
        },
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockResponseWithoutBuildVersion);
      workerRepository.find.mockResolvedValueOnce([]);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');
      expect(result.build.worker_version.version).toBe('N/A');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No label_build_version found in Prometheus results',
      );
    });

    it('should return N/A when Prometheus response has empty results', async () => {
      const mockEmptyResponse = {
        data: {
          result: [],
        },
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockEmptyResponse);
      workerRepository.find.mockResolvedValueOnce([]);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');
      expect(result.build.worker_version.version).toBe('N/A');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No label_build_version found in Prometheus results',
      );
    });

    it('should handle invalid Prometheus response structure', async () => {
      const mockInvalidResponse = {
        invalid: 'structure',
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockInvalidResponse);
      workerRepository.find.mockResolvedValueOnce([]);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid Prometheus response structure:',
        mockInvalidResponse,
      );
    });

    it('should handle Prometheus query rejection gracefully', async () => {
      prometheusService.queryPrometheus.mockRejectedValueOnce(
        new Error('Control plane query failed'),
      );

      workerRepository.find.mockResolvedValueOnce([
        { workerName: 'worker-1', ipAddress: '10.0.0.1', workerVersion: '1.2.5', platform: 'linux' },
      ]);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');
      expect(result.build.worker_version.version).toBe('1.2.5');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Prometheus CP query failed'),
      );
    });

    it('should find label_build_version in second result item', async () => {
      const mockControlPlaneResponse = {
        data: {
          result: [
            {
              metric: {
                __name__: 'kube_pod_labels',
                namespace: 'datamigrator',
              },
            },
            {
              metric: {
                label_build_version: '2.0.0',
                __name__: 'kube_pod_labels',
                namespace: 'datamigrator',
              },
            },
          ],
        },
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockControlPlaneResponse);
      workerRepository.find.mockResolvedValueOnce([]);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('2.0.0');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Found build version: 2.0.0',
      );
    });

    it('should handle response with null data', async () => {
      const mockNullDataResponse = {
        data: null,
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockNullDataResponse);
      workerRepository.find.mockResolvedValueOnce([]);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid Prometheus response structure:',
        mockNullDataResponse,
      );
    });

    it('should handle response with undefined result', async () => {
      const mockUndefinedResultResponse = {
        data: {
          result: undefined,
        },
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockUndefinedResultResponse);
      workerRepository.find.mockResolvedValueOnce([]);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid Prometheus response structure:',
        mockUndefinedResultResponse,
      );
    });

    it('should handle Prometheus response with null metric', async () => {
      const mockResponseWithNullMetric = {
        data: {
          result: [
            {
              metric: null,
            },
          ],
        },
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockResponseWithNullMetric);
      workerRepository.find.mockResolvedValueOnce([
        { workerName: 'worker-1', ipAddress: '10.0.0.1', workerVersion: '1.0.0', platform: 'linux' },
      ]);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');
      expect(result.build.worker_version.version).toBe('1.0.0');
    });

    it('should handle mixed success and failure scenarios', async () => {
      const mockControlPlaneResponse = {
        data: {
          result: [
            {
              metric: {
                label_build_version: '1.0.0',
                __name__: 'kube_pod_labels',
                namespace: 'datamigrator',
              },
            },
          ],
        },
      };

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockControlPlaneResponse);
      workerRepository.find.mockResolvedValueOnce([]);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('1.0.0');
      expect(result.build.worker_version.version).toBe('N/A');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Found build version: 1.0.0',
      );
    });

    it('should group multiple workers by version', async () => {
      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [{ metric: { label_build_version: '2.0.0' } }] },
      });

      workerRepository.find.mockResolvedValueOnce([
        { workerName: 'worker-1', ipAddress: '10.0.0.1', workerVersion: '1.0.0', platform: 'linux' },
        { workerName: 'worker-2', ipAddress: '10.0.0.2', workerVersion: '1.0.0', platform: 'windows' },
        { workerName: 'worker-3', ipAddress: '10.0.0.3', workerVersion: '2.0.0', platform: 'linux' },
      ]);

      const result = await service.getAboutNdm();

      expect(result.build.workersByVersion).toEqual({
        '1.0.0': [
          { workerName: 'worker-1', ipAddress: '10.0.0.1', platform: 'linux' },
          { workerName: 'worker-2', ipAddress: '10.0.0.2', platform: 'windows' },
        ],
        '2.0.0': [
          { workerName: 'worker-3', ipAddress: '10.0.0.3', platform: 'linux' },
        ],
      });
      expect(result.build.worker_version.version).toBe('1.0.0');
    });

    it('should treat workers with null workerVersion as unknown', async () => {
      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [] },
      });

      workerRepository.find.mockResolvedValueOnce([
        { workerName: 'worker-1', ipAddress: '10.0.0.1', workerVersion: null, platform: 'linux' },
      ]);

      const result = await service.getAboutNdm();

      expect(result.build.worker_version.version).toBe('N/A');
      expect(result.build.workersByVersion).toEqual({
        'unknown': [{ workerName: 'worker-1', ipAddress: '10.0.0.1', platform: 'linux' }],
      });
    });

    it('should prefer serial ID from global_settings', async () => {
      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [{ metric: { label_build_version: '2.1.0' } }] },
      });
      workerRepository.find.mockResolvedValueOnce([]);
      settingsRepository.findOne.mockResolvedValueOnce({
        settingKey: 'ndm_serial_id',
        settingValue: '97511111111111111111',
        serialId: '97522222222222222222',
      });

      const result = await service.getAboutNdm();

      expect(result.product.serialId).toBe('97522222222222222222');
    });

    it('should fall back to serial_id.conf when DB setting is missing', async () => {
      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [{ metric: { label_build_version: '2.1.0' } }] },
      });
      workerRepository.find.mockResolvedValueOnce([]);
      settingsRepository.findOne.mockResolvedValueOnce(null);
      jest.spyOn(fs, 'readFile').mockResolvedValueOnce('serial_id=97533333333333333333\n' as any);

      const result = await service.getAboutNdm();

      expect(result.product.serialId).toBe('97533333333333333333');
    });

    it('should use settingValue when serialId column is empty', async () => {
      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [{ metric: { label_build_version: '2.1.0' } }] },
      });
      workerRepository.find.mockResolvedValueOnce([]);
      settingsRepository.findOne.mockResolvedValueOnce({
        settingKey: 'ndm_serial_id',
        settingValue: '97544444444444444444',
        serialId: null,
      });

      const result = await service.getAboutNdm();

      expect(result.product.serialId).toBe('97544444444444444444');
    });

    it('should return N/A when DB and file serials are invalid', async () => {
      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [{ metric: { label_build_version: '2.1.0' } }] },
      });
      workerRepository.find.mockResolvedValueOnce([]);
      settingsRepository.findOne.mockResolvedValueOnce({
        settingKey: 'ndm_serial_id',
        settingValue: 'INVALID',
        serialId: 'BAD',
      });
      jest.spyOn(fs, 'readFile').mockResolvedValueOnce('serial_id=INVALID\n' as any);

      const result = await service.getAboutNdm();

      expect(result.product.serialId).toBe('N/A');
    });

    it('should fall back to file when DB lookup throws error', async () => {
      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [{ metric: { label_build_version: '2.1.0' } }] },
      });
      workerRepository.find.mockResolvedValueOnce([]);
      settingsRepository.findOne.mockRejectedValueOnce(new Error('db error'));
      jest.spyOn(fs, 'readFile').mockResolvedValueOnce('serial_id=97588888888888888888\n' as any);

      const result = await service.getAboutNdm();

      expect(result.product.serialId).toBe('97588888888888888888');
    });

    it('should return N/A when DB throws and file read also throws', async () => {
      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [{ metric: { label_build_version: '2.1.0' } }] },
      });
      workerRepository.find.mockResolvedValueOnce([]);
      settingsRepository.findOne.mockRejectedValueOnce(new Error('db timeout'));
      jest.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('ENOENT'));

      const result = await service.getAboutNdm();

      expect(result.product.serialId).toBe('N/A');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read serial ID from global_settings'),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read serial ID from serial file'),
      );
    });

    it('should return N/A when DB row is missing and file read throws', async () => {
      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [{ metric: { label_build_version: '2.1.0' } }] },
      });
      workerRepository.find.mockResolvedValueOnce([]);
      settingsRepository.findOne.mockResolvedValueOnce(null);
      jest.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('EACCES'));

      const result = await service.getAboutNdm();

      expect(result.product.serialId).toBe('N/A');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read serial ID from serial file'),
      );
    });
  });
});
