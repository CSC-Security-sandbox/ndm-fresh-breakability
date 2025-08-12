import { Test, TestingModule } from '@nestjs/testing';
import { PrometheusService } from './prometheus';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PrometheusService', () => {
  let service: PrometheusService;
  let mockAxiosInstance: jest.Mocked<any>;

  beforeEach(async () => {
    // Reset environment variables
    delete process.env.PROMETHEUS_BASE_URL;
    delete process.env.PROMETHEUS_TIMEOUT;

    mockAxiosInstance = {
      get: jest.fn(),
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrometheusService],
    }).compile();

    service = module.get<PrometheusService>(PrometheusService);

    // Clear mock call history but keep the configuration
    mockAxiosInstance.get.mockClear();

    // Reset axios.isAxiosError mock
    jest.restoreAllMocks();
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.PROMETHEUS_BASE_URL;
    delete process.env.PROMETHEUS_TIMEOUT;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    beforeEach(() => {
      mockedAxios.create.mockClear();
    });

    it('should create axios instance with default configuration', () => {
      // Create a new instance to test constructor
      new PrometheusService();

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:52061/api/v1',
        timeout: 30000,
      });
    });

    it('should create axios instance with custom PROMETHEUS_BASE_URL', () => {
      process.env.PROMETHEUS_BASE_URL = 'http://custom-prometheus:9090/api/v1';

      // Create a new service instance to test constructor with env var
      new PrometheusService();

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://custom-prometheus:9090/api/v1',
        timeout: 30000,
      });
    });

    it('should create axios instance with custom PROMETHEUS_TIMEOUT', () => {
      process.env.PROMETHEUS_TIMEOUT = '60000';

      // Create a new service instance to test constructor with env var
      new PrometheusService();

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:52061/api/v1',
        timeout: 60000,
      });
    });

    it('should create axios instance with both custom env variables', () => {
      process.env.PROMETHEUS_BASE_URL = 'http://prod-prometheus:9090/api/v1';
      process.env.PROMETHEUS_TIMEOUT = '45000';

      // Create a new service instance to test constructor with both env vars
      new PrometheusService();

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://prod-prometheus:9090/api/v1',
        timeout: 45000,
      });
    });

    it('should handle invalid timeout value and use default', () => {
      process.env.PROMETHEUS_TIMEOUT = 'invalid_number';

      // Create a new service instance to test constructor with invalid timeout
      new PrometheusService();

      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:52061/api/v1',
        timeout: NaN, // parseInt returns NaN for invalid strings
      });
    });
  });

  describe('queryPrometheus', () => {
    it('should make GET request to /query with correct parameters', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              {
                metric: { label_build_version: '1.0.0' },
                value: [1628000000, '1'],
              },
            ],
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const query = 'kube_pod_labels{label_build_version!=""}';
      const result = await service.queryPrometheus(query);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query', {
        params: {
          query,
        },
      });

      expect(result).toEqual(mockResponse.data);
    });

    it('should handle different query types', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [],
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const query = 'worker_info';
      await service.queryPrometheus(query);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query', {
        params: {
          query: 'worker_info',
        },
      });
    });

    it('should handle empty query string', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [],
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      await service.queryPrometheus('');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query', {
        params: {
          query: '',
        },
      });
    });

    it('should handle complex queries with special characters', async () => {
      const mockResponse = {
        data: {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [],
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const complexQuery = 'rate(http_requests_total{job="api-server"}[5m])';
      await service.queryPrometheus(complexQuery);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query', {
        params: {
          query: complexQuery,
        },
      });
    });

    it('should propagate axios errors with enhanced error message', async () => {
      const axiosError: any = new Error('Network Error');
      // Mock axios.isAxiosError to return true for this error
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      axiosError.response = undefined; // No response data

      mockAxiosInstance.get.mockRejectedValue(axiosError);

      await expect(service.queryPrometheus('test_query')).rejects.toThrow(
        'Prometheus query failed: Network Error | Query: test_query',
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/query', {
        params: {
          query: 'test_query',
        },
      });
    });

    it('should handle HTTP error responses with enhanced error message', async () => {
      const httpError: any = new Error('Request failed with status code 400');
      httpError.response = {
        status: 400,
        statusText: 'Bad Request',
        data: {
          status: 'error',
          error: 'invalid query syntax',
        },
      };

      // Mock axios.isAxiosError to return true for this error
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      mockAxiosInstance.get.mockRejectedValue(httpError);

      await expect(service.queryPrometheus('invalid{query')).rejects.toThrow(
        'Prometheus query failed: Request failed with status code 400 | Status: 400 Bad Request | Response: {"status":"error","error":"invalid query syntax"} | Query: invalid{query',
      );
    });

    it('should handle timeout errors with enhanced error message', async () => {
      const timeoutError: any = new Error('timeout of 30000ms exceeded');
      // Mock axios.isAxiosError to return true for timeout errors
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      timeoutError.response = undefined; // No response for timeout

      mockAxiosInstance.get.mockRejectedValue(timeoutError);

      await expect(service.queryPrometheus('slow_query')).rejects.toThrow(
        'Prometheus query failed: timeout of 30000ms exceeded | Query: slow_query',
      );
    });

    it('should handle non-axios errors', async () => {
      const nonAxiosError = new Error('Some other error');
      // Mock axios.isAxiosError to return false for non-axios errors
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);

      mockAxiosInstance.get.mockRejectedValue(nonAxiosError);

      await expect(service.queryPrometheus('test_query')).rejects.toThrow(
        'Some other error',
      );
    });

    it('should handle Prometheus error responses', async () => {
      const prometheusErrorResponse = {
        data: {
          status: 'error',
          errorType: 'bad_data',
          error:
            'parse error at char 1: vector selector must contain label matchers or metric name',
        },
      };

      mockAxiosInstance.get.mockResolvedValue(prometheusErrorResponse);

      const result = await service.queryPrometheus('{');

      expect(result).toEqual(prometheusErrorResponse.data);
    });

    it('should handle successful response with empty results', async () => {
      const emptyResponse = {
        data: {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [],
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(emptyResponse);

      const result = await service.queryPrometheus('nonexistent_metric');

      expect(result).toEqual(emptyResponse.data);
    });

    it('should handle response with multiple metrics', async () => {
      const multiMetricResponse = {
        data: {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              {
                metric: { label_build_version: '1.0.0', pod: 'pod1' },
                value: [1628000000, '1'],
              },
              {
                metric: { label_build_version: '1.0.1', pod: 'pod2' },
                value: [1628000001, '1'],
              },
            ],
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValue(multiMetricResponse);

      const result = await service.queryPrometheus('kube_pod_labels');

      expect(result).toEqual(multiMetricResponse.data);
    });
  });
});
