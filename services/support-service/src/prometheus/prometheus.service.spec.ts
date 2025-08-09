import { Test, TestingModule } from '@nestjs/testing';
import { PrometheusService } from './prometheus.service';
import axios, { AxiosInstance } from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PrometheusService', () => {
  let service: PrometheusService;
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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should create axios instance with default configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:52061/api/v1',
        timeout: 30000,
      });
    });

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
      };
      mockHttpClient.get.mockRejectedValue(httpError);

      await expect(
        service.queryPrometheusRange(
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
      const timeoutError = new Error('timeout of 30000ms exceeded') as any;
      timeoutError.code = 'ECONNABORTED';
      mockHttpClient.get.mockRejectedValue(timeoutError);

      await expect(
        service.queryPrometheusRange(
          mockQuery,
          mockStartDate,
          mockEndDate,
          mockStep,
        ),
      ).rejects.toThrow('timeout of 30000ms exceeded');
    });

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
