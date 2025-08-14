/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable prettier/prettier */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrometheusService } from './prometheus.service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PrometheusService', () => {
  let service: PrometheusService;
  let configService: jest.Mocked<ConfigService>;
  let mockAxiosInstance: {
    get: jest.MockedFunction<any>;
  };

  beforeEach(async () => {
    // Create mock axios instance
    mockAxiosInstance = {
      get: jest.fn(),
    };

    // Mock axios.create to return our mock instance
    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    // Create mock ConfigService
    configService = {
      get: jest.fn(),
    } as any;

    // Set default config values
    configService.get.mockImplementation((key: string) => {
      switch (key) {
        case 'support-bundle.prometheus.baseUrl':
          return 'http://localhost:56825/api/v1';
        case 'support-bundle.prometheus.timeout':
          return 30000;
        default:
          return undefined;
      }
    });

    // Set up default mock response for all tests
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [],
        },
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrometheusService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PrometheusService>(PrometheusService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset the axios.create mock to clear call history
    mockedAxios.create.mockClear();
  });

  describe('Constructor', () => {
    it('should create service with default configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:56825/api/v1',
        timeout: 30000,
      });
    });

    it('should create service with custom base URL from config', async () => {
      // Create a new service with different config
      configService.get.mockImplementation((key: string) => {
        switch (key) {
          case 'support-bundle.prometheus.baseUrl':
            return 'https://custom-prometheus:9090/api/v1';
          case 'support-bundle.prometheus.timeout':
            return 30000;
          default:
            return undefined;
        }
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PrometheusService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      module.get<PrometheusService>(PrometheusService);

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://custom-prometheus:9090/api/v1',
        timeout: 30000,
      });
    });

    it('should create service with custom timeout from config', async () => {
      // Create a new service with different config
      configService.get.mockImplementation((key: string) => {
        switch (key) {
          case 'support-bundle.prometheus.baseUrl':
            return 'http://localhost:56825/api/v1';
          case 'support-bundle.prometheus.timeout':
            return 60000;
          default:
            return undefined;
        }
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PrometheusService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      module.get<PrometheusService>(PrometheusService);

      expect(mockedAxios.create).toHaveBeenLastCalledWith({
        baseURL: 'http://localhost:56825/api/v1',
        timeout: 60000,
      });
    });
  });

  describe('queryPrometheusRange', () => {
    const mockResponseData = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { __name__: 'up', job: 'prometheus' },
            values: [
              [1672531200, '1'],
              [1672531500, '1'],
            ],
          },
        ],
      },
    };

    beforeEach(() => {
      // Override with specific mock data for this test suite
      mockAxiosInstance.get.mockResolvedValue({
        data: mockResponseData,
      });
    });

    it('should successfully query Prometheus range with correct parameters', async () => {
      const query = 'up{job="prometheus"}';
      const startDate = '2025-01-01';
      const endDate = '2025-01-02';
      const step = '5m';

      const result = await service.queryPrometheusRange(
        query,
        startDate,
        endDate,
        step,
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'up{job="prometheus"}',
          start: '2025-01-01T00:00:00.000Z',
          end: '2025-01-02T23:59:59.000Z',
          step: '5m',
        },
      });

      expect(result).toEqual(mockResponseData);
    });

    it('should format start and end dates correctly', async () => {
      const query = 'cpu_usage';
      const startDate = '2024-12-31';
      const endDate = '2024-12-31';
      const step = '1m';

      await service.queryPrometheusRange(query, startDate, endDate, step);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'cpu_usage',
          start: '2024-12-31T00:00:00.000Z',
          end: '2024-12-31T23:59:59.000Z',
          step: '1m',
        },
      });
    });

    it('should handle complex Prometheus queries', async () => {
      const complexQuery =
        'rate(http_requests_total{job="api-server",status="200"}[5m])';
      const startDate = '2025-06-15';
      const endDate = '2025-06-16';
      const step = '30s';

      await service.queryPrometheusRange(
        complexQuery,
        startDate,
        endDate,
        step,
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: complexQuery,
          start: '2025-06-15T00:00:00.000Z',
          end: '2025-06-16T23:59:59.000Z',
          step: '30s',
        },
      });
    });

    it('should handle empty query parameter', async () => {
      const query = '';
      const startDate = '2025-01-01';
      const endDate = '2025-01-01';
      const step = '1h';

      await service.queryPrometheusRange(query, startDate, endDate, step);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: '',
          start: '2025-01-01T00:00:00.000Z',
          end: '2025-01-01T23:59:59.000Z',
          step: '1h',
        },
      });
    });

    it('should handle different step formats', async () => {
      const testCases = [
        { step: '1s', desc: 'seconds' },
        { step: '5m', desc: 'minutes' },
        { step: '2h', desc: 'hours' },
        { step: '1d', desc: 'days' },
        { step: '15', desc: 'plain number' },
      ];

      for (const testCase of testCases) {
        await service.queryPrometheusRange(
          'test_metric',
          '2025-01-01',
          '2025-01-01',
          testCase.step,
        );

        expect(mockAxiosInstance.get).toHaveBeenLastCalledWith('/query_range', {
          params: {
            query: 'test_metric',
            start: '2025-01-01T00:00:00.000Z',
            end: '2025-01-01T23:59:59.000Z',
            step: testCase.step,
          },
        });
      }
    });

    it('should handle special characters in query', async () => {
      const queryWithSpecialChars =
        'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))';
      const startDate = '2025-01-01';
      const endDate = '2025-01-01';
      const step = '1m';

      await service.queryPrometheusRange(
        queryWithSpecialChars,
        startDate,
        endDate,
        step,
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: queryWithSpecialChars,
          start: '2025-01-01T00:00:00.000Z',
          end: '2025-01-01T23:59:59.000Z',
          step: '1m',
        },
      });
    });
  });

  describe('Error Handling', () => {
    it('should propagate axios network errors', async () => {
      const networkError = new Error('Network Error');
      mockAxiosInstance.get.mockRejectedValue(networkError);

      await expect(
        service.queryPrometheusRange('up', '2025-01-01', '2025-01-01', '5m'),
      ).rejects.toThrow('Network Error');
    });

    it('should propagate axios timeout errors', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded');
      mockAxiosInstance.get.mockRejectedValue(timeoutError);

      await expect(
        service.queryPrometheusRange(
          'slow_query',
          '2025-01-01',
          '2025-01-01',
          '5m',
        ),
      ).rejects.toThrow('timeout of 30000ms exceeded');
    });

    it('should propagate HTTP 404 errors', async () => {
      const httpError = {
        response: {
          status: 404,
          statusText: 'Not Found',
          data: { error: 'bad_data', errorType: 'bad_data' },
        },
        isAxiosError: true,
      };
      mockAxiosInstance.get.mockRejectedValue(httpError);

      await expect(
        service.queryPrometheusRange(
          'nonexistent_metric',
          '2025-01-01',
          '2025-01-01',
          '5m',
        ),
      ).rejects.toEqual(httpError);
    });

    it('should propagate HTTP 400 bad request errors', async () => {
      const badRequestError = {
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'invalid query syntax', errorType: 'bad_data' },
        },
        isAxiosError: true,
      };
      mockAxiosInstance.get.mockRejectedValue(badRequestError);

      await expect(
        service.queryPrometheusRange(
          'invalid[query',
          '2025-01-01',
          '2025-01-01',
          '5m',
        ),
      ).rejects.toEqual(badRequestError);
    });

    it('should propagate HTTP 500 server errors', async () => {
      const serverError = {
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          data: { error: 'server error' },
        },
        isAxiosError: true,
      };
      mockAxiosInstance.get.mockRejectedValue(serverError);

      await expect(
        service.queryPrometheusRange('up', '2025-01-01', '2025-01-01', '5m'),
      ).rejects.toEqual(serverError);
    });

    it('should handle connection refused errors', async () => {
      const connectionError = {
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:52061',
        isAxiosError: true,
      };
      mockAxiosInstance.get.mockRejectedValue(connectionError);

      await expect(
        service.queryPrometheusRange('up', '2025-01-01', '2025-01-01', '5m'),
      ).rejects.toEqual(connectionError);
    });
  });

  describe('Response Data Handling', () => {
    it('should return response data for successful query', async () => {
      const expectedData = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [],
        },
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: expectedData,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      });

      const result = await service.queryPrometheusRange(
        'up',
        '2025-01-01',
        '2025-01-01',
        '5m',
      );

      expect(result).toEqual(expectedData);
    });

    it('should return response data with actual metric results', async () => {
      const prometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                __name__: 'cpu_usage_percent',
                instance: 'worker-1',
                job: 'node-exporter',
              },
              values: [
                [1672531200, '45.5'],
                [1672531500, '47.2'],
                [1672531800, '44.8'],
              ],
            },
            {
              metric: {
                __name__: 'cpu_usage_percent',
                instance: 'worker-2',
                job: 'node-exporter',
              },
              values: [
                [1672531200, '52.1'],
                [1672531500, '51.9'],
                [1672531800, '53.3'],
              ],
            },
          ],
        },
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: prometheusResponse,
      });

      const result = await service.queryPrometheusRange(
        'cpu_usage_percent',
        '2025-01-01',
        '2025-01-01',
        '5m',
      );

      expect(result).toEqual(prometheusResponse);
      expect(result.data.result).toHaveLength(2);
      expect(result.data.result[0].values).toHaveLength(3);
    });

    it('should return empty result set', async () => {
      const emptyResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [],
        },
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: emptyResponse,
      });

      const result = await service.queryPrometheusRange(
        'nonexistent_metric',
        '2025-01-01',
        '2025-01-01',
        '5m',
      );

      expect(result).toEqual(emptyResponse);
      expect(result.data.result).toHaveLength(0);
    });

    it('should handle Prometheus error responses', async () => {
      const errorResponse = {
        status: 'error',
        errorType: 'bad_data',
        error:
          'invalid parameter "query": 1:1: parse error: unexpected character: \'[\'',
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: errorResponse,
      });

      const result = await service.queryPrometheusRange(
        '[invalid',
        '2025-01-01',
        '2025-01-01',
        '5m',
      );

      expect(result).toEqual(errorResponse);
      expect(result.status).toBe('error');
    });
  });

  describe('Date Range Edge Cases', () => {
    it('should handle same start and end date', async () => {
      const sameDate = '2025-01-15';

      await service.queryPrometheusRange('up', sameDate, sameDate, '1m');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'up',
          start: '2025-01-15T00:00:00.000Z',
          end: '2025-01-15T23:59:59.000Z',
          step: '1m',
        },
      });
    });

    it('should handle year boundary dates', async () => {
      await service.queryPrometheusRange(
        'up',
        '2024-12-31',
        '2025-01-01',
        '1h',
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'up',
          start: '2024-12-31T00:00:00.000Z',
          end: '2025-01-01T23:59:59.000Z',
          step: '1h',
        },
      });
    });

    it('should handle month boundary dates', async () => {
      await service.queryPrometheusRange(
        'memory_usage',
        '2025-01-31',
        '2025-02-01',
        '30m',
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'memory_usage',
          start: '2025-01-31T00:00:00.000Z',
          end: '2025-02-01T23:59:59.000Z',
          step: '30m',
        },
      });
    });

    it('should handle leap year dates', async () => {
      await service.queryPrometheusRange(
        'disk_usage',
        '2024-02-29',
        '2024-03-01',
        '2h',
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'disk_usage',
          start: '2024-02-29T00:00:00.000Z',
          end: '2024-03-01T23:59:59.000Z',
          step: '2h',
        },
      });
    });
  });

  describe('Parameter Validation Edge Cases', () => {
    it('should handle undefined parameters gracefully', async () => {
      // TypeScript would normally prevent this, but testing runtime behavior
      const query = undefined as any;
      const startDate = undefined as any;
      const endDate = undefined as any;
      const step = undefined as any;

      await service.queryPrometheusRange(query, startDate, endDate, step);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: undefined,
          start: 'undefinedT00:00:00.000Z',
          end: 'undefinedT23:59:59.000Z',
          step: undefined,
        },
      });
    });

    it('should handle null parameters gracefully', async () => {
      const query = null as any;
      const startDate = null as any;
      const endDate = null as any;
      const step = null as any;

      await service.queryPrometheusRange(query, startDate, endDate, step);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: null,
          start: 'nullT00:00:00.000Z',
          end: 'nullT23:59:59.000Z',
          step: null,
        },
      });
    });

    it('should handle very long query strings', async () => {
      const longQuery = 'a'.repeat(10000);
      const startDate = '2025-01-01';
      const endDate = '2025-01-01';
      const step = '1m';

      await service.queryPrometheusRange(longQuery, startDate, endDate, step);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: longQuery,
          start: '2025-01-01T00:00:00.000Z',
          end: '2025-01-01T23:59:59.000Z',
          step: '1m',
        },
      });
    });

    it('should handle special characters in date strings', async () => {
      const startDate = '2025-01-01@special';
      const endDate = '2025-01-02#hash';

      await service.queryPrometheusRange('up', startDate, endDate, '1m');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'up',
          start: '2025-01-01@specialT00:00:00.000Z',
          end: '2025-01-02#hashT23:59:59.000Z',
          step: '1m',
        },
      });
    });
  });

  describe('Integration with HTTP Client', () => {
    it('should use the configured axios instance', async () => {
      await service.queryPrometheusRange(
        'up',
        '2025-01-01',
        '2025-01-01',
        '5m',
      );

      // Verify that the mock axios instance method was called
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'up',
          start: '2025-01-01T00:00:00.000Z',
          end: '2025-01-01T23:59:59.000Z',
          step: '5m',
        },
      });
    });

    it('should call axios instance only once per query', async () => {
      await service.queryPrometheusRange(
        'metric1',
        '2025-01-01',
        '2025-01-01',
        '1m',
      );
      await service.queryPrometheusRange(
        'metric2',
        '2025-01-02',
        '2025-01-02',
        '2m',
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('should make independent calls for concurrent queries', async () => {
      const promise1 = service.queryPrometheusRange(
        'metric1',
        '2025-01-01',
        '2025-01-01',
        '1m',
      );
      const promise2 = service.queryPrometheusRange(
        'metric2',
        '2025-01-02',
        '2025-01-02',
        '2m',
      );

      await Promise.all([promise1, promise2]);

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });
  });
});
