import { Test, TestingModule } from '@nestjs/testing';
import { PerformanceMetricsProcessorService } from './performance-metrics-processor.service';
import { PrometheusResponse } from 'src/prometheus/prometheus.interface';
import { writeToString } from 'fast-csv';

// Mock fast-csv
jest.mock('fast-csv', () => ({
  writeToString: jest.fn(),
}));

const mockWriteToString = writeToString as jest.MockedFunction<
  typeof writeToString
>;

describe('PerformanceMetricsProcessorService', () => {
  let service: PerformanceMetricsProcessorService;
  let loggerSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceMetricsProcessorService],
    }).compile();

    service = module.get<PerformanceMetricsProcessorService>(
      PerformanceMetricsProcessorService,
    );
    loggerSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateCsvContent', () => {
    it('should generate CSV content with headers', async () => {
      const mockCsvContent =
        'timestamp,namespace,pod,value\n2023-01-01,default,pod1,0.5';
      mockWriteToString.mockResolvedValue(mockCsvContent);

      const headers = ['timestamp', 'namespace', 'pod', 'value'];
      const rows = [['2023-01-01', 'default', 'pod1', '0.5']];

      const result = await service['generateCsvContent'](headers, rows);

      expect(mockWriteToString).toHaveBeenCalledWith(rows, { headers });
      expect(result).toBe(mockCsvContent);
    });

    it('should generate CSV content without headers', async () => {
      const mockCsvContent = '2023-01-01,default,pod1,0.5';
      mockWriteToString.mockResolvedValue(mockCsvContent);

      const rows = [['2023-01-01', 'default', 'pod1', '0.5']];

      const result = await service['generateCsvContent'](false, rows);

      expect(mockWriteToString).toHaveBeenCalledWith(rows, { headers: false });
      expect(result).toBe(mockCsvContent);
    });
  });

  describe('convertPrometheusResultToRows', () => {
    const mockResponse: PrometheusResponse = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { namespace: 'default', pod: 'pod1' },
            values: [
              [1672531200, '0.5'],
              [1672531500, '0.7'],
            ],
          },
          {
            metric: { namespace: 'kube-system', pod: 'pod2' },
            values: [[1672531200, '1.2']],
          },
        ],
      },
    };

    it('should convert Prometheus response to rows without value parser', () => {
      const result = service['convertPrometheusResultToRows'](mockResponse);

      expect(result).toEqual([
        ['2023-01-01T00:00:00.000Z', 'default', 'pod1', 0.5],
        ['2023-01-01T00:05:00.000Z', 'default', 'pod1', 0.7],
        ['2023-01-01T00:00:00.000Z', 'kube-system', 'pod2', 1.2],
      ]);
    });

    it('should convert Prometheus response to rows with value parser', () => {
      const valueParser = (v: number) => Number((v * 100).toFixed(2));
      const result = service['convertPrometheusResultToRows'](
        mockResponse,
        valueParser,
      );

      expect(result).toEqual([
        ['2023-01-01T00:00:00.000Z', 'default', 'pod1', 50],
        ['2023-01-01T00:05:00.000Z', 'default', 'pod1', 70],
        ['2023-01-01T00:00:00.000Z', 'kube-system', 'pod2', 120],
      ]);
    });

    it('should handle missing metric properties', () => {
      const responseWithMissingMetrics: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {},
              values: [[1672531200, '0.5']],
            },
          ],
        },
      };

      const result = service['convertPrometheusResultToRows'](
        responseWithMissingMetrics,
      );

      expect(result).toEqual([['2023-01-01T00:00:00.000Z', '', '', 0.5]]);
    });

    it('should return empty array for empty response', () => {
      const emptyResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [],
        },
      };

      const result = service['convertPrometheusResultToRows'](emptyResponse);

      expect(result).toEqual([]);
    });

    it('should return empty array for null response data', () => {
      const nullResponse: PrometheusResponse = {
        status: 'success',
      };

      const result = service['convertPrometheusResultToRows'](nullResponse);

      expect(result).toEqual([]);
    });

    it('should return empty array for missing result property', () => {
      const missingResultResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: undefined as any,
        },
      };

      const result = service['convertPrometheusResultToRows'](
        missingResultResponse,
      );

      expect(result).toEqual([]);
    });

    it('should handle empty values array', () => {
      const responseWithEmptyValues: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'default', pod: 'pod1' },
              values: [],
            },
          ],
        },
      };

      const result = service['convertPrometheusResultToRows'](
        responseWithEmptyValues,
      );

      expect(result).toEqual([]);
    });

    it('should handle missing values property', () => {
      const responseWithMissingValues: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'default', pod: 'pod1' },
            } as any,
          ],
        },
      };

      const result = service['convertPrometheusResultToRows'](
        responseWithMissingValues,
      );

      expect(result).toEqual([]);
    });
  });

  describe('processMetricData', () => {
    const mockResponse: PrometheusResponse = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { namespace: 'default', pod: 'pod1' },
            values: [
              [1672531200, '0.5'],
              [1672531500, '0.7'],
            ],
          },
        ],
      },
    };

    beforeEach(() => {
      mockWriteToString.mockResolvedValue('mock,csv,content');
    });

    it('should process CPU_PERCENT metric', async () => {
      const result = await service.processMetricData(
        'CPU_PERCENT',
        mockResponse,
      );

      expect(result.data).toEqual([
        ['2023-01-01T00:00:00.000Z', 'default', 'pod1', 0.5],
        ['2023-01-01T00:05:00.000Z', 'default', 'pod1', 0.7],
      ]);
      expect(result.csvContent).toBe('mock,csv,content');
      expect(mockWriteToString).toHaveBeenCalledWith(
        [
          ['2023-01-01T00:00:00.000Z', 'default', 'pod1', 0.5],
          ['2023-01-01T00:05:00.000Z', 'default', 'pod1', 0.7],
        ],
        { headers: ['timestamp', 'namespace', 'pod', 'cpu_%'] },
      );
    });

    it('should process MEMORY_MB metric', async () => {
      const result = await service.processMetricData('MEMORY_MB', mockResponse);

      expect(result.data).toEqual([
        ['2023-01-01T00:00:00.000Z', 'default', 'pod1', 0.5],
        ['2023-01-01T00:05:00.000Z', 'default', 'pod1', 0.7],
      ]);
      expect(result.csvContent).toBe('mock,csv,content');
      expect(mockWriteToString).toHaveBeenCalledWith(expect.any(Array), {
        headers: ['timestamp', 'namespace', 'pod', 'memory_mb'],
      });
    });

    it('should process DISK_WRITE_BPS metric', async () => {
      const result = await service.processMetricData(
        'DISK_WRITE_BPS',
        mockResponse,
      );

      expect(result.csvContent).toBe('mock,csv,content');
      expect(mockWriteToString).toHaveBeenCalledWith(expect.any(Array), {
        headers: ['timestamp', 'namespace', 'pod', 'disk_write_bps'],
      });
    });

    it('should process DISK_READ_BPS metric', async () => {
      const result = await service.processMetricData(
        'DISK_READ_BPS',
        mockResponse,
      );

      expect(result.csvContent).toBe('mock,csv,content');
      expect(mockWriteToString).toHaveBeenCalledWith(expect.any(Array), {
        headers: ['timestamp', 'namespace', 'pod', 'disk_read_bps'],
      });
    });

    it('should process NETWORK_THROUGHPUT_KBPS metric', async () => {
      const result = await service.processMetricData(
        'NETWORK_THROUGHPUT_KBPS',
        mockResponse,
      );

      expect(result.csvContent).toBe('mock,csv,content');
      expect(mockWriteToString).toHaveBeenCalledWith(expect.any(Array), {
        headers: ['timestamp', 'namespace', 'pod', 'network_bps'],
      });
    });

    it('should handle unknown metric', async () => {
      const result = await service.processMetricData(
        'UNKNOWN_METRIC' as any,
        mockResponse,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
      expect(loggerSpy).toHaveBeenCalledWith(
        'No CSV mapping found for metric: UNKNOWN_METRIC',
      );
    });

    it('should handle null response', async () => {
      const result = await service.processMetricData(
        'CPU_PERCENT',
        null as any,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });

    it('should handle response without data', async () => {
      const responseWithoutData: PrometheusResponse = {
        status: 'success',
      };

      const result = await service.processMetricData(
        'CPU_PERCENT',
        responseWithoutData,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });

    it('should handle response without result', async () => {
      const responseWithoutResult: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: null as any,
        },
      };

      const result = await service.processMetricData(
        'CPU_PERCENT',
        responseWithoutResult,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });
  });

  describe('processBatchMetrics', () => {
    const mockResponse: PrometheusResponse = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { namespace: 'default', pod: 'pod1' },
            values: [[1672531200, '0.5']],
          },
        ],
      },
    };

    beforeEach(() => {
      mockWriteToString.mockResolvedValue('mock,csv,content');
    });

    it('should process multiple metrics successfully', async () => {
      const metricsData = [
        { metric: 'CPU_PERCENT' as any, response: mockResponse },
        { metric: 'MEMORY_MB' as any, response: mockResponse },
        { metric: 'DISK_READ_BPS' as any, response: mockResponse },
      ];

      const result = await service.processBatchMetrics(metricsData);

      expect(result).toHaveProperty('CPU_PERCENT');
      expect(result).toHaveProperty('MEMORY_MB');
      expect(result).toHaveProperty('DISK_READ_BPS');

      expect(result.CPU_PERCENT).toHaveProperty('data');
      expect(result.CPU_PERCENT).toHaveProperty('csvContent');
      expect(result.MEMORY_MB).toHaveProperty('data');
      expect(result.MEMORY_MB).toHaveProperty('csvContent');
      expect(result.DISK_READ_BPS).toHaveProperty('data');
      expect(result.DISK_READ_BPS).toHaveProperty('csvContent');
    });

    it('should skip metrics with null data', async () => {
      const metricsData = [
        { metric: 'CPU_PERCENT' as any, response: mockResponse },
        { metric: 'UNKNOWN_METRIC' as any, response: mockResponse },
      ];

      const result = await service.processBatchMetrics(metricsData);

      expect(result).toHaveProperty('CPU_PERCENT');
      expect(result).not.toHaveProperty('UNKNOWN_METRIC');
    });

    it('should handle empty metrics array', async () => {
      const result = await service.processBatchMetrics([]);

      expect(result).toEqual({});
    });

    it('should handle metrics with failed responses', async () => {
      const metricsData = [
        { metric: 'CPU_PERCENT' as any, response: mockResponse },
        { metric: 'MEMORY_MB' as any, response: null as any },
      ];

      const result = await service.processBatchMetrics(metricsData);

      expect(result).toHaveProperty('CPU_PERCENT');
      expect(result).not.toHaveProperty('MEMORY_MB');
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should handle writeToString errors gracefully', async () => {
      mockWriteToString.mockRejectedValue(new Error('CSV generation failed'));

      const mockResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'default', pod: 'pod1' },
              values: [[1672531200, '0.5']],
            },
          ],
        },
      };

      await expect(
        service.processMetricData('CPU_PERCENT', mockResponse),
      ).rejects.toThrow('CSV generation failed');
    });

    it('should handle invalid timestamp values', () => {
      const invalidTimestampResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'default', pod: 'pod1' },
              values: [
                [0, '0.5'], // Valid timestamp (epoch)
                [-1, '0.7'], // Negative timestamp
              ],
            },
          ],
        },
      };

      const result = service['convertPrometheusResultToRows'](
        invalidTimestampResponse,
      );

      expect(result).toEqual([
        ['1970-01-01T00:00:00.000Z', 'default', 'pod1', 0.5], // Epoch
        ['1969-12-31T23:59:59.000Z', 'default', 'pod1', 0.7], // Negative becomes valid date
      ]);
    });

    it('should handle non-numeric metric values', () => {
      const nonNumericResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'default', pod: 'pod1' },
              values: [
                [1672531200, 'non-numeric'],
                [1672531500, ''],
                [1672531800, null as any],
              ],
            },
          ],
        },
      };

      const result =
        service['convertPrometheusResultToRows'](nonNumericResponse);

      expect(result).toEqual([
        ['2023-01-01T00:00:00.000Z', 'default', 'pod1', NaN],
        ['2023-01-01T00:05:00.000Z', 'default', 'pod1', 0],
        ['2023-01-01T00:10:00.000Z', 'default', 'pod1', 0],
      ]);
    });

    it('should handle very large numeric values', () => {
      const largeValueResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'default', pod: 'pod1' },
              values: [
                [1672531200, '1.7976931348623157e+308'], // Near max number
                [1672531500, '1e-10'], // Very small number
              ],
            },
          ],
        },
      };

      const valueParser = (v: number) => Number(v.toFixed(4));
      const result = service['convertPrometheusResultToRows'](
        largeValueResponse,
        valueParser,
      );

      expect(result[0][3]).toBe(1.7976931348623157e308);
      expect(result[1][3]).toBe(0);
    });
  });

  describe('createCombinedServiceMetricsCsv', () => {
    beforeEach(() => {
      mockWriteToString.mockImplementation(async (rows, options) => {
        const headers = options?.headers
          ? 'timestamp,operation,service_name,service_role,error_type,request_rate,latency_p95_ms,client_error_rate,service_error_rate\n'
          : '';
        const csvRows = rows.map((row: any[]) => row.join(',')).join('\n');
        return headers + csvRows;
      });
    });

    it('should create combined CSV with all service metrics', async () => {
      const mockData = {
        SERVICE_REQUEST_RATE: {
          data: [
            [
              '2025-08-10T10:00:00.000Z',
              'get_users',
              'user-service',
              'api',
              150.5,
            ],
            [
              '2025-08-10T10:01:00.000Z',
              'create_user',
              'user-service',
              'api',
              75.2,
            ],
          ] as any[][],
          csvContent: 'mock csv',
        },
        SERVICE_LATENCY_P95: {
          data: [
            [
              '2025-08-10T10:00:00.000Z',
              'get_users',
              'user-service',
              'api',
              245.8,
            ],
            [
              '2025-08-10T10:01:00.000Z',
              'create_user',
              'user-service',
              'api',
              380.1,
            ],
          ] as any[][],
          csvContent: 'mock csv',
        },
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [
            [
              '2025-08-10T10:00:00.000Z',
              'get_users',
              'user-service',
              'api',
              'timeout',
              5.2,
            ],
          ] as any[][],
          csvContent: 'mock csv',
        },
      } as any;

      const result = await service.createCombinedServiceMetricsCsv(mockData);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toContain(
        'timestamp,operation,service_name,service_role,error_type,request_rate,latency_p95_ms,client_error_rate,service_error_rate',
      );
      expect(result.csvContent).toContain(
        '2025-08-10T10:00:00.000Z,get_users,user-service,api,,150.5,,,',
      );
      expect(result.csvContent).toContain(
        '2025-08-10T10:00:00.000Z,get_users,user-service,api,,,245.8,,',
      );
      expect(result.csvContent).toContain(
        '2025-08-10T10:00:00.000Z,get_users,user-service,api,timeout,,,,5.2',
      );
    });

    it('should return hasData false when no service metrics available', async () => {
      const mockDataNoService = {
        CPU_PERCENT: {
          data: [['timestamp', 'namespace', 'pod', 50]] as any[][],
          csvContent: 'mock csv',
        },
      } as any;

      const result =
        await service.createCombinedServiceMetricsCsv(mockDataNoService);

      expect(result.hasData).toBe(false);
      expect(result.csvContent).toBe('');
    });

    it('should handle empty data object', async () => {
      const result = await service.createCombinedServiceMetricsCsv({});

      expect(result.hasData).toBe(false);
      expect(result.csvContent).toBe('');
    });

    it('should handle SERVICE_ERROR_RATE_BY_TYPE with error_type properly', async () => {
      const mockData = {
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [
            [
              '2025-08-10T10:00:00.000Z',
              'get_users',
              'user-service',
              'api',
              'timeout',
              5.2,
            ],
            [
              '2025-08-10T10:00:00.000Z',
              'get_users',
              'user-service',
              'api',
              'validation',
              3.1,
            ],
          ] as any[][],
          csvContent: 'mock csv',
        },
      } as any;

      const result = await service.createCombinedServiceMetricsCsv(mockData);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toContain('timeout,,,,5.2');
      expect(result.csvContent).toContain('validation,,,,3.1');
    });

    it('should handle mixed SERVICE_ERROR_RATE_BY_TYPE data with and without error_type', async () => {
      const mockData = {
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [
            // Row with error_type (5 elements)
            [
              '2025-08-10T10:00:00.000Z',
              'get_users',
              'user-service',
              'timeout',
              5.2,
            ],
            // Row without error_type (4 elements)
            ['2025-08-10T10:00:00.000Z', 'get_users', 'user-service', 3.1],
          ] as any[][],
          csvContent: 'mock csv',
        },
      } as any;

      const result = await service.createCombinedServiceMetricsCsv(mockData);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toContain('timeout');
    });

    it('should handle empty rest array in combined CSV processing', async () => {
      const mockData = {
        SERVICE_REQUEST_RATE: {
          data: [
            [
              '2025-08-10T10:00:00.000Z',
              'get_users',
              'user-service',
              // Missing value (empty rest array)
            ],
          ] as any[][],
          csvContent: 'mock csv',
        },
      } as any;

      const result = await service.createCombinedServiceMetricsCsv(mockData);

      expect(result.hasData).toBe(true);
      // Should handle empty rest array with default value 0
      expect(result.csvContent).toContain('0');
    });
  });

  describe('convertServiceMetricResultToRows', () => {
    it('should handle response with null data', () => {
      const response: PrometheusResponse = {
        status: 'success',
        data: null as any,
      };

      const result = service['convertServiceMetricResultToRows'](response, [
        'operation',
        'service_name',
      ]);

      expect(result).toEqual([]);
    });

    it('should handle response with null result', () => {
      const response: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: null as any,
        },
      };

      const result = service['convertServiceMetricResultToRows'](response, [
        'operation',
        'service_name',
      ]);

      expect(result).toEqual([]);
    });

    it('should handle missing metric fields', () => {
      const response: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { operation: 'get_users' }, // missing service_name
              values: [[1672531200, '150.5']],
            },
          ],
        },
      };

      const result = service['convertServiceMetricResultToRows'](response, [
        'operation',
        'service_name',
        'missing_field',
      ]);

      expect(result).toEqual([
        ['2023-01-01T00:00:00.000Z', 'get_users', '', '', 150.5],
      ]);
    });

    it('should apply valueParser correctly', () => {
      const response: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { operation: 'get_users', service_name: 'user-service' },
              values: [[1672531200, '150.5555']],
            },
          ],
        },
      };

      const valueParser = (v: number) => Number(v.toFixed(2));
      const result = service['convertServiceMetricResultToRows'](
        response,
        ['operation', 'service_name'],
        valueParser,
      );

      expect(result).toEqual([
        ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 150.56],
      ]);
    });

    it('should handle NaN values with valueParser', () => {
      const response: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { operation: 'get_users', service_name: 'user-service' },
              values: [[1672531200, 'NaN']],
            },
          ],
        },
      };

      const valueParser = (v: number) =>
        isNaN(v) ? 'NaN' : Number(v.toFixed(2));
      const result = service['convertServiceMetricResultToRows'](
        response,
        ['operation', 'service_name'],
        valueParser,
      );

      expect(result).toEqual([
        ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 'NaN'],
      ]);
    });

    it('should handle empty values array', () => {
      const response: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { operation: 'get_users', service_name: 'user-service' },
              values: [], // empty values
            },
          ],
        },
      };

      const result = service['convertServiceMetricResultToRows'](response, [
        'operation',
        'service_name',
      ]);

      expect(result).toEqual([]);
    });

    it('should handle null values array', () => {
      const response: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { operation: 'get_users', service_name: 'user-service' },
              values: null as any, // null values
            },
          ],
        },
      };

      const result = service['convertServiceMetricResultToRows'](response, [
        'operation',
        'service_name',
      ]);

      expect(result).toEqual([]);
    });
  });

  describe('Service metric processing with NaN handling', () => {
    const mockServiceResponse: PrometheusResponse = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { operation: 'get_users', service_name: 'user-service' },
            values: [
              [1672531200, 'NaN'], // NaN value
              [1672531500, '150.5555'], // Normal value
            ],
          },
        ],
      },
    };

    beforeEach(() => {
      mockWriteToString.mockResolvedValue('mock,csv,content');
    });

    it('should handle NaN values in SERVICE_REQUEST_RATE', async () => {
      const result = await service.processMetricData(
        'SERVICE_REQUEST_RATE',
        mockServiceResponse,
      );

      expect(result.data).toEqual([
        ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 'NaN'],
        ['2023-01-01T00:05:00.000Z', 'get_users', 'user-service', 150.5555],
      ]);
    });

    it('should handle NaN values in SERVICE_LATENCY_P95', async () => {
      const result = await service.processMetricData(
        'SERVICE_LATENCY_P95',
        mockServiceResponse,
      );

      expect(result.data).toEqual([
        ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 'NaN'],
        ['2023-01-01T00:05:00.000Z', 'get_users', 'user-service', 150.56],
      ]);
    });

    it('should handle NaN values in CLIENT_ERROR_RATE', async () => {
      const clientErrorResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { service_name: 'user-service', service_role: 'api' },
              values: [[1672531200, 'NaN']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'CLIENT_ERROR_RATE',
        clientErrorResponse,
      );

      expect(result.data).toEqual([
        ['2023-01-01T00:00:00.000Z', 'user-service', 'api', 'NaN'],
      ]);
    });

    it('should handle NaN values in SERVICE_ERROR_RATE_BY_TYPE', async () => {
      const errorTypeResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { service_name: 'user-service', error_type: 'timeout' },
              values: [[1672531200, 'NaN']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_ERROR_RATE_BY_TYPE',
        errorTypeResponse,
      );

      expect(result.data).toEqual([
        ['2023-01-01T00:00:00.000Z', 'user-service', 'timeout', 'NaN'],
      ]);
    });
  });

  describe('Edge cases for processMetricData', () => {
    beforeEach(() => {
      mockWriteToString.mockResolvedValue('mock,csv,content');
    });

    it('should handle response with empty result array', async () => {
      const emptyResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_REQUEST_RATE',
        emptyResponse,
      );

      expect(result.data).toEqual([]);
      expect(result.csvContent).toBe('mock,csv,content');
    });

    it('should handle undefined response', async () => {
      const result = await service.processMetricData(
        'SERVICE_REQUEST_RATE',
        undefined as any,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });
  });
});
