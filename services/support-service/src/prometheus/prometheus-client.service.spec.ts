import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { PrometheusClientService } from './prometheus-client.service';
import { PrometheusService } from './prometheus.service';

describe('PrometheusClientService', () => {
  let service: PrometheusClientService;
  let prometheusService: jest.Mocked<PrometheusService>;

  beforeEach(async () => {
    const mockPrometheusService = {
      queryPrometheusRange: jest.fn(),
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('callPrometheusApi', () => {
    const query = 'cpu_usage';
    const startDate = '2023-01-01T00:00:00Z';
    const endDate = '2023-01-01T01:00:00Z';
    const step = '5m';

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should successfully call Prometheus API and return response', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { __name__: 'cpu_usage' },
              values: [[1672531200, '50']],
            },
          ],
        },
      };

      prometheusService.queryPrometheusRange.mockResolvedValue(mockResponse);

      const result = await service.callPrometheusApi(
        query,
        startDate,
        endDate,
        step,
      );

      expect(result).toEqual(mockResponse);
      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledWith(
        query,
        startDate,
        endDate,
        step,
      );
      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledTimes(1);
    });

    it('should use default step value when not provided', async () => {
      const mockResponse = { status: 'success', data: {} };
      prometheusService.queryPrometheusRange.mockResolvedValue(mockResponse);

      await service.callPrometheusApi(query, startDate, endDate);

      expect(prometheusService.queryPrometheusRange).toHaveBeenCalledWith(
        query,
        startDate,
        endDate,
        '5m',
      );
    });

    it('should throw InternalServerErrorException when Prometheus returns non-success status', async () => {
      const mockResponse = {
        status: 'error',
        error: 'Query failed',
      };

      prometheusService.queryPrometheusRange.mockResolvedValue(mockResponse);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException when Prometheus returns non-success status without error message', async () => {
      const mockResponse = {
        status: 'error',
      };

      prometheusService.queryPrometheusRange.mockResolvedValue(mockResponse);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException when Prometheus returns error status', async () => {
      const mockError = {
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'Query execution failed' },
        },
        message: 'Request failed with status code 400',
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(mockError);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Prometheus API error: 400 - Bad Request. Data: {"error":"Query execution failed"}',
        ),
      );
    });

    it('should throw InternalServerErrorException when Prometheus returns unknown error', async () => {
      const mockError = {
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          data: { error: 'Unknown error' },
        },
        message: 'Request failed with status code 500',
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(mockError);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Prometheus API error: 500 - Internal Server Error. Data: {"error":"Unknown error"}',
        ),
      );
    });

    it('should handle ECONNREFUSED error', async () => {
      const error = new Error('Connection refused');
      error['code'] = 'ECONNREFUSED';

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Cannot connect to Prometheus. Make sure Prometheus is running on localhost:52061',
        ),
      );
    });

    it('should handle ENOTFOUND error', async () => {
      const error = new Error('Not found');
      error['code'] = 'ENOTFOUND';

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Prometheus server not found. Check if the URL is correct.',
        ),
      );
    });

    it('should handle HTTP response error with status and data', async () => {
      const error = {
        message: 'HTTP Error',
        response: {
          status: 404,
          statusText: 'Not Found',
          data: { error: 'Endpoint not found' },
        },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Prometheus API error: 404 - Not Found. Data: {"error":"Endpoint not found"}',
        ),
      );
    });

    it('should handle HTTP response error without data', async () => {
      const error = {
        message: 'HTTP Error',
        response: {
          status: 500,
          statusText: 'Internal Server Error',
        },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Prometheus API error: 500 - Internal Server Error. Data: undefined',
        ),
      );
    });

    it('should handle generic error', async () => {
      const error = new Error('Generic error message');

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(
        new InternalServerErrorException(
          'Failed to call Prometheus API: Generic error message',
        ),
      );
    });

    it('should log error details when response data is present', async () => {
      const loggerSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation();

      const error = {
        message: 'HTTP Error',
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'Invalid query' },
        },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Prometheus response data: {"error":"Invalid query"}',
      );

      loggerSpy.mockRestore();
    });

    it('should log request params when config params are present', async () => {
      const loggerSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation();

      const error = {
        message: 'HTTP Error',
        config: {
          params: { query: 'cpu_usage', start: startDate, end: endDate },
        },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);

      expect(loggerSpy).toHaveBeenCalledWith(
        `Request params: {"query":"cpu_usage","start":"${startDate}","end":"${endDate}"}`,
      );

      loggerSpy.mockRestore();
    });

    it('should log both response data and request params when both are present', async () => {
      const loggerSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation();

      const error = {
        message: 'HTTP Error',
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'Invalid query' },
        },
        config: {
          params: { query: 'invalid_metric' },
        },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Prometheus response data: {"error":"Invalid query"}',
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        'Request params: {"query":"invalid_metric"}',
      );

      loggerSpy.mockRestore();
    });

    it('should not log error details when response data is missing', async () => {
      const loggerSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation();

      const error = {
        message: 'HTTP Error',
        response: {
          status: 400,
          statusText: 'Bad Request',
        },
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);

      // Should not call logger.error with response data since it's missing
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Prometheus response data:'),
      );

      loggerSpy.mockRestore();
    });

    it('should not log request params when config params are missing', async () => {
      const loggerSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation();

      const error = {
        message: 'HTTP Error',
        config: {},
      };

      prometheusService.queryPrometheusRange.mockRejectedValue(error);

      await expect(
        service.callPrometheusApi(query, startDate, endDate, step),
      ).rejects.toThrow(InternalServerErrorException);

      // Should not call logger.error with request params since they're missing
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Request params:'),
      );

      loggerSpy.mockRestore();
    });
  });
});
