import { Test, TestingModule } from '@nestjs/testing';
import { AboutNdmService } from './about-ndm.service';
import { PrometheusService } from '../utils/prometheus';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigService } from '@nestjs/config';
import BUILD_VERSION_QUERIES from './about-ndm.constants';

describe('AboutNdmService', () => {
  let service: AboutNdmService;
  let prometheusService: jest.Mocked<PrometheusService>;

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
      ],
    }).compile();

    service = module.get<AboutNdmService>(AboutNdmService);
    prometheusService = module.get(PrometheusService);

    // Clear mocks after service instantiation, except for the create method
    prometheusService.queryPrometheus.mockClear();
    mockLogger.log.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create logger with correct name', () => {
    // Logger is created in constructor, so it should already be called
    expect(mockLoggerFactory.create).toHaveBeenCalledWith('AboutNdmService');
  });

  describe('getAboutNdm', () => {
    it('should extract label_build_version from successful Prometheus responses', async () => {
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

      prometheusService.queryPrometheus
        .mockResolvedValueOnce(mockControlPlaneResponse)
        .mockResolvedValueOnce(mockWorkerResponse);

      const result = await service.getAboutNdm();

      expect(prometheusService.queryPrometheus).toHaveBeenCalledTimes(2);
      expect(prometheusService.queryPrometheus).toHaveBeenCalledWith(
        BUILD_VERSION_QUERIES.CONTROL_PLANE,
      );
      expect(prometheusService.queryPrometheus).toHaveBeenCalledWith(
        BUILD_VERSION_QUERIES.WORKER,
      );

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
        'Found build version: 1.2.3',
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Found build version: 1.2.4',
      );
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

      prometheusService.queryPrometheus
        .mockResolvedValueOnce(mockResponseWithoutBuildVersion)
        .mockResolvedValueOnce(mockResponseWithoutBuildVersion);

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
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
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No label_build_version found in Prometheus results',
      );
    });

    it('should return unknown when Prometheus response has empty results', async () => {
      const mockEmptyResponse = {
        data: {
          result: [],
        },
      };

      prometheusService.queryPrometheus
        .mockResolvedValueOnce(mockEmptyResponse)
        .mockResolvedValueOnce(mockEmptyResponse);

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
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
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No label_build_version found in Prometheus results',
      );
    });

    it('should handle invalid Prometheus response structure', async () => {
      const mockInvalidResponse = {
        invalid: 'structure',
      };

      prometheusService.queryPrometheus
        .mockResolvedValueOnce(mockInvalidResponse)
        .mockResolvedValueOnce(mockInvalidResponse);

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
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
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid Prometheus response structure:',
        mockInvalidResponse,
      );
    });

    it('should handle Prometheus query rejections gracefully', async () => {
      const mockWorkerResponse = {
        data: {
          result: [
            {
              metric: {
                label_build_version: '1.2.5',
                __name__: 'worker_info',
              },
            },
          ],
        },
      };

      prometheusService.queryPrometheus
        .mockRejectedValueOnce(new Error('Control plane query failed'))
        .mockResolvedValueOnce(mockWorkerResponse);

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
        },
        build: {
          worker_version: {
            version: '1.2.5',
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
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Prometheus query was rejected:',
        expect.any(Error),
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

      prometheusService.queryPrometheus
        .mockResolvedValueOnce(mockControlPlaneResponse)
        .mockResolvedValueOnce(mockWorkerResponse);

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
        },
        build: {
          worker_version: {
            version: '2.0.0',
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
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Found build version: 2.0.0',
      );
    });

    it('should handle response with null data', async () => {
      const mockNullDataResponse = {
        data: null,
      };

      prometheusService.queryPrometheus
        .mockResolvedValueOnce(mockNullDataResponse)
        .mockResolvedValueOnce(mockNullDataResponse);

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
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
      });

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

      prometheusService.queryPrometheus
        .mockResolvedValueOnce(mockUndefinedResultResponse)
        .mockResolvedValueOnce(mockUndefinedResultResponse);

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
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
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid Prometheus response structure:',
        mockUndefinedResultResponse,
      );
    });

    it('should handle Prometheus response with null metric causing iteration error', async () => {
      const mockResponseWithNullMetric = {
        data: {
          result: [
            {
              metric: null,
            },
          ],
        },
      };

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

      prometheusService.queryPrometheus
        .mockResolvedValueOnce(mockResponseWithNullMetric)
        .mockResolvedValueOnce(mockWorkerResponse);

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
        },
        build: {
          worker_version: {
            version: '1.0.0',
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
      });
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

      prometheusService.queryPrometheus
        .mockResolvedValueOnce(mockControlPlaneResponse)
        .mockRejectedValueOnce(new Error('Worker query failed'));

      const result = await service.getAboutNdm();

      expect(result).toEqual({
        product: {
          name: 'NDM',
          version: 'Preview',
        },
        build: {
          worker_version: {
            version: 'unknown',
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
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Found build version: 1.0.0',
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Prometheus query was rejected:',
        expect.any(Error),
      );
    });
  });
});
