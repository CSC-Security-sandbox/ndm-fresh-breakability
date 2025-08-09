import { Test, TestingModule } from '@nestjs/testing';
import { PrometheusService } from './prometheus.service';
import axios from 'axios';
import axios, { AxiosInstance } from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PrometheusService', () => {
  let service: PrometheusService;
  let mockAxiosCreate: jest.Mock;
  let mockHttpClient: jest.Mocked<any>;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a mock HTTP client
  let mockHttpClient: jest.Mocked<AxiosInstance>;

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();

    // Mock axios.create to return our mock instance
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };

    // Mock axios.create to return our mock client
    mockAxiosCreate = jest.fn().mockReturnValue(mockHttpClient);
    mockedAxios.create = mockAxiosCreate;
      patch: jest.fn(),
      request: jest.fn(),
      create: jest.fn(),
      defaults: {} as any,
      interceptors: {
        request: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() } as any,
        response: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() } as any,
      },
      getUri: jest.fn(),
      head: jest.fn(),
      options: jest.fn(),
      postForm: jest.fn(),
      putForm: jest.fn(),
      patchForm: jest.fn(),
    } as any;

    mockedAxios.create.mockReturnValue(mockHttpClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrometheusService],
    }).compile();

    service = module.get<PrometheusService>(PrometheusService);
  });

  afterEach(() => {
    // Clear environment variables after each test
    delete process.env.PROMETHEUS_BASE_URL;
    delete process.env.PROMETHEUS_TIMEOUT;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should create axios client with default configuration', () => {
      expect(mockAxiosCreate).toHaveBeenCalledWith({
    it('should create axios instance with default configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:52061/api/v1',
        timeout: 30000,
      });
    });

    it('should use environment variables for configuration', () => {
      // Set environment variables
      process.env.PROMETHEUS_BASE_URL = 'http://custom-prometheus:9090/api/v1';
      process.env.PROMETHEUS_TIMEOUT = '60000';

      // Clear the mock to get a fresh count
      mockAxiosCreate.mockClear();

      // Create a new instance to test the constructor
      new PrometheusService();

      expect(mockAxiosCreate).toHaveBeenCalledWith({
        baseURL: 'http://custom-prometheus:9090/api/v1',
        timeout: 60000,
      });
    });

    it('should handle invalid timeout environment variable', () => {
      process.env.PROMETHEUS_TIMEOUT = 'invalid';
      delete process.env.PROMETHEUS_BASE_URL; // Reset base URL

      // Clear the mock to get a fresh count
      mockAxiosCreate.mockClear();

      // Create a new instance
      new PrometheusService();

      // When parseInt('invalid', 10) returns NaN, axios will receive NaN
      const calls = mockAxiosCreate.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0].baseURL).toBe('http://localhost:52061/api/v1');
      expect(Number.isNaN(calls[0][0].timeout)).toBe(true);
    it('should create axios instance with environment variables', () => {
      // Mock environment variables
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        PROMETHEUS_BASE_URL: 'http://custom-prometheus:9090/api/v1',
        PROMETHEUS_TIMEOUT: '60000',
      };

      // Clear previous mock calls
      jest.clearAllMocks();

      // Create new instance
      new PrometheusService();

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://custom-prometheus:9090/api/v1',
        timeout: 60000,
      });

      // Restore environment
      process.env = originalEnv;
    });

    it('should handle invalid timeout environment variable', () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        PROMETHEUS_TIMEOUT: 'invalid-number',
      };

      jest.clearAllMocks();
      new PrometheusService();

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:52061/api/v1',
        timeout: NaN, // parseInt will return NaN for invalid string
      });

      process.env = originalEnv;
    });

    it('should handle empty timeout environment variable', () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        PROMETHEUS_TIMEOUT: '',
      };

      jest.clearAllMocks();
      new PrometheusService();

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:52061/api/v1',
        timeout: 30000, // Should fall back to default
      });

      process.env = originalEnv;
    });
  });

  describe('queryPrometheusRange', () => {
    it('should make successful query_range request with correct parameters', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: {
            result: [
              {
                metric: { job: 'node-exporter' },
                values: [[1691539200, '85.5']],
              },
            ],
          },
        },
      };

      mockHttpClient.get.mockResolvedValue(mockResponse);

      const result = await service.queryPrometheusRange(
        'up',
        '2023-08-01',
        '2023-08-02',
        '5m',
    const mockQuery = 'cpu_usage';
    const mockStartDate = '2023-01-01';
    const mockEndDate = '2023-01-02';
    const mockStep = '5m';
    const mockResponseData = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { instance: 'localhost:9090' },
            values: [
              [1672531200, '0.5'],
              [1672531500, '0.7'],
            ],
          },
        ],
      },
    };

    it('should successfully query Prometheus range API', async () => {
      mockHttpClient.get.mockResolvedValue({ data: mockResponseData });

      const result = await service.queryPrometheusRange(
        mockQuery,
        mockStartDate,
        mockEndDate,
        mockStep,
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'up',
          start: '2023-08-01T00:00:00.000Z',
          end: '2023-08-02T23:59:59.000Z',
          step: '5m',
        },
      });

      expect(result).toEqual(mockResponse.data);
    });

    it('should format dates correctly with time components', async () => {
      const mockResponse = {
        data: { status: 'success', data: { result: [] } },
      };
      mockHttpClient.get.mockResolvedValue(mockResponse);

      await service.queryPrometheusRange(
        'cpu_usage',
        '2023-12-25',
        '2023-12-26',
        '1h',
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'cpu_usage',
          start: '2023-12-25T00:00:00.000Z',
          end: '2023-12-26T23:59:59.000Z',
          step: '1h',
        },
      });
    });

    it('should handle complex Prometheus queries', async () => {
      const complexQuery = 'rate(http_requests_total[5m])';
      const mockResponse = {
        data: { status: 'success', data: { result: [] } },
      };
      mockHttpClient.get.mockResolvedValue(mockResponse);

      await service.queryPrometheusRange(
        complexQuery,
        '2023-08-01',
        '2023-08-01',
        '30s',
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: complexQuery,
          start: '2023-08-01T00:00:00.000Z',
          end: '2023-08-01T23:59:59.000Z',
          step: '30s',
        },
      });
          query: mockQuery,
          start: '2023-01-01T00:00:00.000Z',
          end: '2023-01-02T23:59:59.000Z',
          step: mockStep,
        },
      });

      expect(result).toEqual(mockResponseData);
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network Error');
      networkError.name = 'AxiosError';
      mockHttpClient.get.mockRejectedValue(networkError);

      await expect(
        service.queryPrometheusRange('up', '2023-08-01', '2023-08-02', '5m'),
      mockHttpClient.get.mockRejectedValue(networkError);

      await expect(
        service.queryPrometheusRange(
          mockQuery,
          mockStartDate,
          mockEndDate,
          mockStep,
        ),
      ).rejects.toThrow('Network Error');

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'up',
          start: '2023-08-01T00:00:00.000Z',
          end: '2023-08-02T23:59:59.000Z',
          step: '5m',
          query: mockQuery,
          start: '2023-01-01T00:00:00.000Z',
          end: '2023-01-02T23:59:59.000Z',
          step: mockStep,
        },
      });
    });

    it('should handle HTTP error responses', async () => {
      const httpError = {
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'invalid query' },
        },
        message: 'Request failed with status code 400',
      };

      };
      mockHttpClient.get.mockRejectedValue(httpError);

      await expect(
        service.queryPrometheusRange(
          'invalid{',
          '2023-08-01',
          '2023-08-02',
          '5m',
        ),
      ).rejects.toMatchObject({
        message: 'Request failed with status code 400',
          mockQuery,
          mockStartDate,
          mockEndDate,
          mockStep,
        ),
      ).rejects.toEqual(httpError);
    });

    it('should format date parameters correctly with different inputs', async () => {
      mockHttpClient.get.mockResolvedValue({ data: mockResponseData });

      await service.queryPrometheusRange(
        'memory_usage',
        '2023-12-31',
        '2024-01-01',
        '1m',
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'memory_usage',
          start: '2023-12-31T00:00:00.000Z',
          end: '2024-01-01T23:59:59.000Z',
          step: '1m',
        },
      });
    });

    it('should handle empty string parameters', async () => {
      mockHttpClient.get.mockResolvedValue({ data: mockResponseData });

      await service.queryPrometheusRange('', '', '', '');

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: '',
          start: 'T00:00:00.000Z',
          end: 'T23:59:59.000Z',
          step: '',
        },
      });
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded');
      timeoutError.name = 'AxiosError';
      const timeoutError = new Error('timeout of 30000ms exceeded') as any;
      timeoutError.code = 'ECONNABORTED';
      mockHttpClient.get.mockRejectedValue(timeoutError);

      await expect(
        service.queryPrometheusRange(
          'slow_query',
          '2023-08-01',
          '2023-08-02',
          '1s',
          mockQuery,
          mockStartDate,
          mockEndDate,
          mockStep,
        ),
      ).rejects.toThrow('timeout of 30000ms exceeded');
    });

    it('should handle empty date strings gracefully', async () => {
      const mockResponse = {
        data: { status: 'success', data: { result: [] } },
      };
      mockHttpClient.get.mockResolvedValue(mockResponse);

      await service.queryPrometheusRange('up', '', '', '5m');

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'up',
          start: 'T00:00:00.000Z',
          end: 'T23:59:59.000Z',
          step: '5m',
        },
      });
    });

    it('should handle special characters in query', async () => {
      const queryWithSpecialChars =
        'label_replace(up, "new_label", "$1", "job", "(.+)")';
      const mockResponse = {
        data: { status: 'success', data: { result: [] } },
      };
      mockHttpClient.get.mockResolvedValue(mockResponse);

      await service.queryPrometheusRange(
        queryWithSpecialChars,
        '2023-08-01',
        '2023-08-02',
        '5m',
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: queryWithSpecialChars,
          start: '2023-08-01T00:00:00.000Z',
          end: '2023-08-02T23:59:59.000Z',
          step: '5m',
        },
      });
    });

    it('should handle different step values', async () => {
      const mockResponse = {
        data: { status: 'success', data: { result: [] } },
      };
      mockHttpClient.get.mockResolvedValue(mockResponse);

      const stepValues = ['1s', '30s', '1m', '5m', '15m', '1h', '1d'];

      for (const step of stepValues) {
        mockHttpClient.get.mockClear();
        await service.queryPrometheusRange(
          'up',
          '2023-08-01',
          '2023-08-01',
          step,
        );

        expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
          params: {
            query: 'up',
            start: '2023-08-01T00:00:00.000Z',
            end: '2023-08-01T23:59:59.000Z',
            step: step,
          },
        });
      }
    });

    it('should return response data directly', async () => {
      const expectedData = {
        status: 'success',
        data: {
          result: [
            {
              metric: { job: 'prometheus' },
              values: [[1691539200, '1']],
            },
          ],
        },
      };

      mockHttpClient.get.mockResolvedValue({ data: expectedData });

      const result = await service.queryPrometheusRange(
        'up',
        '2023-08-01',
        '2023-08-02',
        '5m',
      );

      expect(result).toEqual(expectedData);
    });
  });

  describe('error handling', () => {
    it('should propagate axios errors without modification', async () => {
      const originalError = new Error('Connection refused');
      originalError.name = 'AxiosError';
      (originalError as any).code = 'ECONNREFUSED';

      mockHttpClient.get.mockRejectedValue(originalError);

      await expect(
        service.queryPrometheusRange('up', '2023-08-01', '2023-08-02', '5m'),
      ).rejects.toBe(originalError);
    });

    it('should handle malformed response data', async () => {
      const malformedResponse = { data: null };
      mockHttpClient.get.mockResolvedValue(malformedResponse);

      const result = await service.queryPrometheusRange(
        'up',
        '2023-08-01',
        '2023-08-02',
        '5m',
    it('should handle connection refused errors', async () => {
      const connectionError = new Error(
        'connect ECONNREFUSED 127.0.0.1:52061',
      ) as any;
      connectionError.code = 'ECONNREFUSED';
      mockHttpClient.get.mockRejectedValue(connectionError);

      await expect(
        service.queryPrometheusRange(
          mockQuery,
          mockStartDate,
          mockEndDate,
          mockStep,
        ),
      ).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:52061');
    });

    it('should handle malformed response', async () => {
      mockHttpClient.get.mockResolvedValue({ data: null });

      const result = await service.queryPrometheusRange(
        mockQuery,
        mockStartDate,
        mockEndDate,
        mockStep,
      );

      expect(result).toBeNull();
    });

    it('should handle response with undefined data', async () => {
      mockHttpClient.get.mockResolvedValue({});

      const result = await service.queryPrometheusRange(
        mockQuery,
        mockStartDate,
        mockEndDate,
        mockStep,
      );

      expect(result).toBeUndefined();
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should handle special characters in query', async () => {
      const specialQuery = 'cpu_usage{instance=~".*"}[5m]';
      mockHttpClient.get.mockResolvedValue({
        data: { status: 'success', data: { result: [] } },
      });

      await service.queryPrometheusRange(
        specialQuery,
        '2023-01-01',
        '2023-01-02',
        '5m',
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: specialQuery,
          start: '2023-01-01T00:00:00.000Z',
          end: '2023-01-02T23:59:59.000Z',
          step: '5m',
        },
      });
    });

    it('should handle very long date strings', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { status: 'success', data: { result: [] } },
      });

      const longDate = '2023-01-01-with-extra-information';
      await service.queryPrometheusRange(
        'test_query',
        longDate,
        longDate,
        '1h',
      );

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'test_query',
          start: `${longDate}T00:00:00.000Z`,
          end: `${longDate}T23:59:59.000Z`,
          step: '1h',
        },
      });
    });
  });
});
