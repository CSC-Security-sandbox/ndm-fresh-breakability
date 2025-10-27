import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { PrometheusClientService } from './prometheus-client.service';
import { PrometheusService } from './prometheus.service';
import { PrometheusResponse } from '../activities/state-data-csv-generation/state-data-csv-generation.interface';

describe('PrometheusClientService', () => {
  let service: PrometheusClientService;
  let prometheusService: jest.Mocked<PrometheusService>;
  let mockLogger: Partial<Logger>;

  beforeEach(async () => {
    const mockPrometheusService = {
      queryPrometheusRange: jest.fn(),
    };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrometheusClientService,
        {
          provide: PrometheusService,
          useValue: mockPrometheusService,
        },
      ],
    }).compile();

    service = module.get<PrometheusClientService>(PrometheusClientService);
    prometheusService = module.get(PrometheusService);

    // Replace the logger with our mock
    (service as any).logger = mockLogger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('callPrometheusApi', () => {
    const query = 'up{job="prometheus"}';
    const startDate = '2025-01-01T00:00:00Z';
    const endDate = '2025-01-02T00:00:00Z';
    const step = '5m';

    const mockSuccessResponse: PrometheusResponse = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { job: 'prometheus' },
            values: [
              ['1641024000', '1'],
              ['1641027600', '1'],
            ],
          },
        ],
      },
    };

    it('should successfully call Prometheus API and return response', async () => {
      prometheusService.queryPrometheusRange.mockResolvedValue(
        mockSuccessResponse,
      );

      const result = await service.callPrometheusApi(
        query,
        startDate,
        endDate,
        step,
      );

      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledWith(
        query,
        startDate,
        endDate,
        step,
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `Calling Prometheus API with query: ${query}`,
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `Date params - start: ${startDate}, end: ${endDate}`,
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Prometheus API response status: success',
      );
      expect(result).toEqual(mockSuccessResponse);
    });

    it('should use default step value when not provided', async () => {
      prometheusService.queryPrometheusRange.mockResolvedValue(
        mockSuccessResponse,
      );

      await service.callPrometheusApi(query, startDate, endDate);

      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledWith(
        query,
        startDate,
        endDate,
        '5m',
      );
    });

    it('should throw InternalServerErrorException when Prometheus returns error status', async () => {
      const mockErrorResponse: PrometheusResponse = {
        status: 'error',
        error: 'Bad query syntax',
        errorType: 'bad_data',
      };

      prometheusService.queryPrometheusRange.mockResolvedValue(
        mockErrorResponse,
      );

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Prometheus API response status: error',
      );
    });

    it('should throw InternalServerErrorException with unknown error when error message is missing', async () => {
      const mockErrorResponse: PrometheusResponse = {
        status: 'error',
        errorType: 'bad_data',
      };

      prometheusService.queryPrometheusRange.mockResolvedValue(
        mockErrorResponse,
      );

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle ECONNREFUSED error and throw appropriate message', async () => {
      const econnrefusedError = new Error('Connection refused');
      (econnrefusedError as any).code = 'ECONNREFUSED';

      prometheusService.queryPrometheusRange.mockRejectedValue(
        econnrefusedError,
      );

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Cannot connect to Prometheus. Make sure Prometheus is running on localhost:52061',
        ),
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error calling Prometheus API: Connection refused',
      );
    });

    it('should handle ENOTFOUND error and throw appropriate message', async () => {
      const enotfoundError = new Error('Host not found');
      (enotfoundError as any).code = 'ENOTFOUND';

      prometheusService.queryPrometheusRange.mockRejectedValue(enotfoundError);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Prometheus server not found. Check if the URL is correct.',
        ),
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error calling Prometheus API: Host not found',
      );
    });

    it('should handle HTTP response errors with status and data', async () => {
      const httpError = new Error('HTTP Error');
      (httpError as any).response = {
        status: 400,
        statusText: 'Bad Request',
        data: { error: 'Invalid query parameter' },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(httpError);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Prometheus API error: 400 - Bad Request. Data: {"error":"Invalid query parameter"}',
        ),
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error calling Prometheus API: HTTP Error',
      );
    });

    it('should handle generic errors and throw InternalServerErrorException', async () => {
      const genericError = new Error('Something went wrong');

      prometheusService.queryPrometheusRange.mockRejectedValue(genericError);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to call Prometheus API: Something went wrong',
        ),
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error calling Prometheus API: Something went wrong',
      );
    });

    it('should log response data when error has response data', async () => {
      const errorWithResponseData = new Error('API Error');
      (errorWithResponseData as any).response = {
        status: 500,
        statusText: 'Internal Server Error',
        data: { message: 'Internal error occurred' },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(
        errorWithResponseData,
      );

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Prometheus response data: {"message":"Internal error occurred"}',
      );
    });

    it('should log request params when error has config params', async () => {
      const errorWithConfig = new Error('Request Error');
      (errorWithConfig as any).config = {
        params: {
          query: query,
          start: startDate,
          end: endDate,
          step: step,
        },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(errorWithConfig);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);

      const expectedLogMessage = `Request params: ${JSON.stringify({
        query: query,
        start: startDate,
        end: endDate,
        step: step,
      })}`;

      expect(mockLogger.error).toHaveBeenCalledWith(expectedLogMessage);
    });

    it('should log both response data and request params when both are present', async () => {
      const errorWithBoth = new Error('Complete Error');
      (errorWithBoth as any).response = {
        status: 422,
        statusText: 'Unprocessable Entity',
        data: { error: 'Validation failed' },
      };
      (errorWithBoth as any).config = {
        params: { query: 'invalid_query' },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(errorWithBoth);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Prometheus response data: {"error":"Validation failed"}',
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Request params: {"query":"invalid_query"}',
      );
    });

    it('should handle errors without response or config gracefully', async () => {
      const simpleError = new Error('Simple error');

      prometheusService.queryPrometheusRange.mockRejectedValue(simpleError);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to call Prometheus API: Simple error',
        ),
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error calling Prometheus API: Simple error',
      );
      // Should not log response data or request params
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('Prometheus response data:'),
      );
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('Request params:'),
      );
    });
  });

  describe('handlePrometheusError (private method)', () => {
    it('should be called when an error occurs in callPrometheusApi', async () => {
      const handleErrorSpy = jest.spyOn(
        service as any,
        'handlePrometheusError',
      );
      const testError = new Error('Test error');

      prometheusService.queryPrometheusRange.mockRejectedValue(testError);

      await expect(
        service.callPrometheusApi('test_query', '2025-01-01', '2025-01-02'),
      ).rejects.toThrow(InternalServerErrorException);

      expect(handleErrorSpy).toHaveBeenCalledWith(testError);
    });
  });

  describe('logErrorDetails (private method)', () => {
    it('should not log anything when error has no response or config', () => {
      const error = new Error('Simple error');

      // Access private method for testing
      (service as any).logErrorDetails(error);

      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('Prometheus response data:'),
      );
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('Request params:'),
      );
    });

    it('should log response data when present', () => {
      const error = {
        response: {
          data: { message: 'Response error' },
        },
      };

      (service as any).logErrorDetails(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Prometheus response data: {"message":"Response error"}',
      );
    });

    it('should log request params when present', () => {
      const error = {
        config: {
          params: { query: 'test_query', step: '1m' },
        },
      };

      (service as any).logErrorDetails(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Request params: {"query":"test_query","step":"1m"}',
      );
    });
  });

  describe('edge cases and boundary conditions', () => {
    const startDate = '2025-01-01T00:00:00Z';
    const endDate = '2025-01-02T00:00:00Z';

    it('should handle empty query string', async () => {
      prometheusService.queryPrometheusRange.mockResolvedValue({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      });

      await service.callPrometheusApi('', startDate, endDate);

      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledWith(
        '',
        startDate,
        endDate,
        '5m',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Calling Prometheus API with query: ',
      );
    });

    it('should handle null/undefined error properties gracefully', async () => {
      const errorWithNullProps = new Error('Null props error');
      (errorWithNullProps as any).response = null;
      (errorWithNullProps as any).config = undefined;

      prometheusService.queryPrometheusRange.mockRejectedValue(
        errorWithNullProps,
      );

      await expect(
        service.callPrometheusApi('test', '2025-01-01', '2025-01-02'),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to call Prometheus API: Null props error',
        ),
      );
    });

    it('should handle different step values correctly', async () => {
      const customSteps = ['1m', '15m', '1h', '1d'];

      prometheusService.queryPrometheusRange.mockResolvedValue({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      });

      for (const customStep of customSteps) {
        await service.callPrometheusApi(
          'test_query',
          '2025-01-01',
          '2025-01-02',
          customStep,
        );

        expect(prometheusService.queryPrometheusRange).toHaveBeenCalledWith(
          'test_query',
          '2025-01-01',
          '2025-01-02',
          customStep,
        );
      }

      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledTimes(
        customSteps.length,
      );
    });

    it('should handle very long query strings', async () => {
      const longQuery = 'a'.repeat(1000);

      prometheusService.queryPrometheusRange.mockResolvedValue({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      });

      await service.callPrometheusApi(longQuery, '2025-01-01', '2025-01-02');

      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledWith(
        longQuery,
        '2025-01-01',
        '2025-01-02',
        '5m',
      );
    });

    it('should handle malformed date strings', async () => {
      prometheusService.queryPrometheusRange.mockResolvedValue({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      });

      const malformedStartDate = 'invalid-date';
      const malformedEndDate = '2025-13-45T25:00:00Z';

      await service.callPrometheusApi(
        'test',
        malformedStartDate,
        malformedEndDate,
      );

      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledWith(
        'test',
        malformedStartDate,
        malformedEndDate,
        '5m',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `Date params - start: ${malformedStartDate}, end: ${malformedEndDate}`,
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex Prometheus responses with multiple metrics', async () => {
      const complexResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { job: 'api-server', instance: 'localhost:8080' },
              values: [
                ['1641024000', '1'],
                ['1641027600', '0.8'],
              ],
            },
            {
              metric: { job: 'worker', instance: 'localhost:8081' },
              values: [
                ['1641024000', '0.9'],
                ['1641027600', '1'],
              ],
            },
          ],
        },
      };

      prometheusService.queryPrometheusRange.mockResolvedValue(complexResponse);

      const result = await service.callPrometheusApi(
        'up{job=~"api-server|worker"}',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z',
        '1h',
      );

      expect(result).toEqual(complexResponse);
      expect(result.data?.result).toHaveLength(2);
    });

    it('should handle concurrent API calls', async () => {
      prometheusService.queryPrometheusRange.mockResolvedValue({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      });

      const queries = ['query1', 'query2', 'query3'];
      const promises = queries.map((query) =>
        service.callPrometheusApi(query, '2025-01-01', '2025-01-02'),
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledTimes(3);
      results.forEach((result) => {
        expect(result.status).toBe('success');
      });
    });
  });
});
