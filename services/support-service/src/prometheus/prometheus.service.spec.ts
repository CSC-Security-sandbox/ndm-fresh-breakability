import { Test, TestingModule } from '@nestjs/testing';
import { PrometheusService } from './prometheus.service';
import axios from 'axios';

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
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };

    // Mock axios.create to return our mock client
    mockAxiosCreate = jest.fn().mockReturnValue(mockHttpClient);
    mockedAxios.create = mockAxiosCreate;

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
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network Error');
      networkError.name = 'AxiosError';
      mockHttpClient.get.mockRejectedValue(networkError);

      await expect(
        service.queryPrometheusRange('up', '2023-08-01', '2023-08-02', '5m'),
      ).rejects.toThrow('Network Error');

      expect(mockHttpClient.get).toHaveBeenCalledWith('/query_range', {
        params: {
          query: 'up',
          start: '2023-08-01T00:00:00.000Z',
          end: '2023-08-02T23:59:59.000Z',
          step: '5m',
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
      });
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded');
      timeoutError.name = 'AxiosError';
      mockHttpClient.get.mockRejectedValue(timeoutError);

      await expect(
        service.queryPrometheusRange(
          'slow_query',
          '2023-08-01',
          '2023-08-02',
          '1s',
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
      );

      expect(result).toBeNull();
    });
  });
});
