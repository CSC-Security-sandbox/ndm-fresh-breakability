import { Test, TestingModule } from '@nestjs/testing';
import { AboutNdmService } from './about-ndm.service';
import { PrometheusService } from '../utils/prometheus';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';

jest.mock('fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

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
        case 'VERSIONS_CONF_PATH':
          return '/opt/datamigrator/conf/versions.conf';
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

    prometheusService.queryPrometheus.mockClear();
    mockLogger.log.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
    mockedFs.existsSync.mockReset();
    mockedFs.readFileSync.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create logger with correct name', () => {
    expect(mockLoggerFactory.create).toHaveBeenCalledWith('AboutNdmService');
  });

  describe('getAboutNdm', () => {
    it('should read CP version from versions.conf and worker version from Prometheus', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('CP_VERSION=1.2.3\nWORKER_VERSION=1.2.3\n');

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

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockWorkerResponse);

      const result = await service.getAboutNdm();

      expect(prometheusService.queryPrometheus).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        product: { name: 'NDM', version: 'Preview' },
        build: {
          worker_version: { version: '1.2.4', time: null },
          controlPlane_version: { version: '1.2.3', time: null },
        },
        contact: {
          email: 'niharika@netapp.com',
          phone: null,
          website: null,
        },
      });

      expect(mockLogger.debug).toHaveBeenCalledWith('Read CP version from file: 1.2.3');
    });

    it('should return N/A for CP version when versions.conf does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

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

      prometheusService.queryPrometheus.mockResolvedValueOnce(mockWorkerResponse);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');
      expect(result.build.worker_version.version).toBe('1.2.5');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('versions.conf not found'),
      );
    });

    it('should return N/A for CP version when CP_VERSION key is missing from file', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('WORKER_VERSION=1.0.0\n');

      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [] },
      });

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');
      expect(mockLogger.warn).toHaveBeenCalledWith('CP_VERSION not found in versions.conf');
    });

    it('should handle versions.conf with quoted values', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('CP_VERSION="2.0.0"\n');

      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [] },
      });

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('2.0.0');
    });

    it('should handle versions.conf read errors gracefully', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: {
          result: [
            { metric: { label_build_version: '1.0.0', __name__: 'worker_info' } },
          ],
        },
      });

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('N/A');
      expect(result.build.worker_version.version).toBe('1.0.0');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error reading versions.conf'),
      );
    });

    it('should return N/A for worker when Prometheus has empty results', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('CP_VERSION=1.0.0\n');

      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [] },
      });

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('1.0.0');
      expect(result.build.worker_version.version).toBe('N/A');
    });

    it('should return N/A for worker when Prometheus query fails', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('CP_VERSION=1.0.0\n');

      prometheusService.queryPrometheus.mockRejectedValueOnce(
        new Error('Worker query failed'),
      );

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('1.0.0');
      expect(result.build.worker_version.version).toBe('N/A');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Prometheus query was rejected:',
        expect.any(Error),
      );
    });

    it('should handle invalid Prometheus response structure', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('CP_VERSION=1.0.0\n');

      const mockInvalidResponse = { invalid: 'structure' };
      prometheusService.queryPrometheus.mockResolvedValueOnce(mockInvalidResponse);

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('1.0.0');
      expect(result.build.worker_version.version).toBe('N/A');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid Prometheus response structure:',
        mockInvalidResponse,
      );
    });

    it('should handle versions.conf with comments and blank lines', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        '# NDM Versions\n\nWORKER_VERSION=1.0.0\nCP_VERSION=3.0.0\n# end\n',
      );

      prometheusService.queryPrometheus.mockResolvedValueOnce({
        data: { result: [] },
      });

      const result = await service.getAboutNdm();

      expect(result.build.controlPlane_version.version).toBe('3.0.0');
    });
  });
});
