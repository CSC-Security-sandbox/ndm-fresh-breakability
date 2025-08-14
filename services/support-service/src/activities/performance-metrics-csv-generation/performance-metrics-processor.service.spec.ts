import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PerformanceMetricsProcessorService } from './performance-metrics-processor.service';
import { PrometheusResponse } from '../state-data-csv-generation/state-data-csv-generation.interface';
import { ProcessedMetricsBatchResult } from './performance-metrics.interface';
import * as fastCsv from 'fast-csv';

jest.mock('fast-csv');

describe('PerformanceMetricsProcessorService', () => {
  let service: PerformanceMetricsProcessorService;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(async () => {
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceMetricsProcessorService],
    }).compile();

    service = module.get<PerformanceMetricsProcessorService>(
      PerformanceMetricsProcessorService,
    );

    // Mock the logger
    (service as any).logger = mockLogger;

    // Mock fast-csv writeToString
    (fastCsv.writeToString as jest.Mock).mockResolvedValue(
      'mocked,csv,content\n',
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processMetricData', () => {
    const mockPrometheusResponse: PrometheusResponse = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: {
              namespace: 'test-namespace',
              pod: 'test-pod',
              instance: 'redis:6379',
            },
            values: [
              ['1641024000', '50.5'],
              ['1641027600', '60.2'],
            ],
          },
        ],
      },
    };

    it('should process CPU_PERCENT metric correctly', async () => {
      const result = await service.processMetricData(
        'CPU_PERCENT',
        mockPrometheusResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ), // ISO timestamp
            'test-namespace',
            'test-pod',
            50.5,
          ]),
        ]),
        { headers: ['timestamp', 'namespace', 'pod', 'cpu_%'] },
      );
    });

    it('should process MEMORY_MB metric correctly', async () => {
      const result = await service.processMetricData(
        'MEMORY_MB',
        mockPrometheusResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'test-namespace',
            'test-pod',
            50.5,
          ]),
        ]),
        { headers: ['timestamp', 'namespace', 'pod', 'memory_mb'] },
      );
    });

    it('should process DISK_WRITE_BPS metric correctly', async () => {
      const result = await service.processMetricData(
        'DISK_WRITE_BPS',
        mockPrometheusResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'test-namespace',
            'test-pod',
            50.5,
          ]),
        ]),
        { headers: ['timestamp', 'namespace', 'pod', 'disk_write_bps'] },
      );
    });

    it('should process DISK_READ_BPS metric correctly', async () => {
      const result = await service.processMetricData(
        'DISK_READ_BPS',
        mockPrometheusResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'test-namespace',
            'test-pod',
            50.5,
          ]),
        ]),
        { headers: ['timestamp', 'namespace', 'pod', 'disk_read_bps'] },
      );
    });

    it('should process NETWORK_THROUGHPUT_BPS metric correctly', async () => {
      const result = await service.processMetricData(
        'NETWORK_THROUGHPUT_BPS',
        mockPrometheusResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });

    it('should process REDIS_CONNECTED_CLIENTS metric correctly', async () => {
      const redisResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                instance: 'redis-master:6379',
              },
              values: [
                ['1641024000', '25.7'],
                ['1641027600', '30.0'],
              ],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_CONNECTED_CLIENTS',
        redisResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'redis-master:6379',
            25, // Math.floor(25.7)
          ]),
        ]),
        { headers: ['timestamp', 'instance', 'connected_clients'] },
      );
    });

    it('should process REDIS_HIT_RATIO metric correctly', async () => {
      const redisResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                instance: 'redis-slave:6379',
              },
              values: [['1641024000', '0.85123']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_HIT_RATIO',
        redisResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'redis-slave:6379',
            85.12, // (0.85123 * 100).toFixed(2) = 85.12
          ]),
        ]),
        { headers: ['timestamp', 'instance', 'hit_ratio'] },
      );
    });

    it('should process REDIS_MEMORY_USED_KB metric correctly', async () => {
      const redisResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                instance: 'redis:6379',
              },
              values: [['1641024000', '2048.789']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_MEMORY_USED_KB',
        redisResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'redis:6379',
            2048.79, // toFixed(2)
          ]),
        ]),
        { headers: ['timestamp', 'instance', 'memory_used_kb'] },
      );
    });

    it('should process REDIS_UPTIME_SECONDS metric correctly', async () => {
      const redisResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                instance: 'redis:6379',
              },
              values: [['1641024000', '86400.9']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_UPTIME_SECONDS',
        redisResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'redis:6379',
            86400, // Math.floor(86400.9)
          ]),
        ]),
        { headers: ['timestamp', 'instance', 'uptime_seconds'] },
      );
    });

    it('should process SERVICE_REQUEST_RATE metric correctly', async () => {
      const serviceResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                operation: 'GET /api',
                service_name: 'api-service',
              },
              values: [
                ['1641024000', '120.5'],
                ['1641027600', '130.2'],
              ],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_REQUEST_RATE',
        serviceResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'GET /api',
            'api-service',
            120.5,
          ]),
        ]),
        { headers: ['timestamp', 'operation', 'service_name', 'request_rate'] },
      );
    });

    it('should process SERVICE_LATENCY_P95 metric correctly', async () => {
      const serviceResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                operation: 'POST /data',
                service_name: 'data-service',
              },
              values: [['1641024000', '250.789']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_LATENCY_P95',
        serviceResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'POST /data',
            'data-service',
            250.79, // rounded to 2 decimal places
          ]),
        ]),
        {
          headers: ['timestamp', 'operation', 'service_name', 'latency_p95_ms'],
        },
      );
    });

    it('should process CLIENT_ERROR_RATE metric correctly', async () => {
      const serviceResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                service_name: 'auth-service',
                service_role: 'backend',
              },
              values: [['1641024000', '0.05123']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'CLIENT_ERROR_RATE',
        serviceResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'auth-service',
            'backend',
            0.0512, // rounded to 4 decimal places
          ]),
        ]),
        {
          headers: [
            'timestamp',
            'service_name',
            'service_role',
            'client_error_rate',
          ],
        },
      );
    });

    it('should process SERVICE_ERROR_RATE_BY_TYPE metric correctly', async () => {
      const serviceResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                service_name: 'api-service',
                error_type: '500_internal_error',
              },
              values: [['1641024000', '0.012345']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_ERROR_RATE_BY_TYPE',
        serviceResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'api-service',
            '500_internal_error',
            0.0123, // rounded to 4 decimal places
          ]),
        ]),
        { headers: ['timestamp', 'service_name', 'error_type', 'error_rate'] },
      );
    });

    it('should process LATENCY metric correctly', async () => {
      const latencyResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {
                worker_id: 'worker-1',
                control_plane_ip: '10.0.0.1',
                metric_type: 'avg',
              },
              values: [['1641024000', '12.345']],
            },
            {
              metric: {
                worker_id: 'worker-2',
                control_plane_ip: '10.0.0.1',
                metric_type: 'min',
              },
              values: [['1641024000', '8.567']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'LATENCY',
        latencyResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'worker-1',
            '10.0.0.1',
            'avg',
            12.35, // rounded to 2 decimal places
          ]),
          expect.arrayContaining([
            expect.stringMatching(
              /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
            ),
            'worker-2',
            '10.0.0.1',
            'min',
            8.57, // rounded to 2 decimal places
          ]),
        ]),
        {
          headers: [
            'timestamp',
            'worker_id',
            'control_plane_ip',
            'metric_type',
            'latency_ms',
          ],
        },
      );
    });

    it('should process unknown metric type and return default case', async () => {
      const result = await service.processMetricData(
        'UNKNOWN_METRIC' as any,
        mockPrometheusResponse,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });

    it('should handle null or empty response', async () => {
      const result = await service.processMetricData(
        'CPU_PERCENT',
        null as any,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });

    it('should handle response without data', async () => {
      const emptyResponse: PrometheusResponse = {
        status: 'success',
        data: null as any,
      };

      const result = await service.processMetricData(
        'CPU_PERCENT',
        emptyResponse,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });

    it('should handle response without result', async () => {
      const emptyResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: null as any,
        },
      };

      const result = await service.processMetricData(
        'CPU_PERCENT',
        emptyResponse,
      );

      expect(result.data).toBeNull();
      expect(result.csvContent).toBe('');
    });

    it('should handle NaN values correctly', async () => {
      const responseWithNaN: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'test', pod: 'test-pod' },
              values: [['1641024000', 'NaN']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'CPU_PERCENT',
        responseWithNaN,
      );

      expect(result.data).toBeTruthy();
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.any(String),
            'test',
            'test-pod',
            'NaN',
          ]),
        ]),
        expect.any(Object),
      );
    });

    it('should handle empty metric data correctly', async () => {
      const emptyMetricResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {},
              values: [],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'CPU_PERCENT',
        emptyMetricResponse,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });
  });

  describe('processBatchMetrics', () => {
    const mockMetricsData = [
      {
        metric: 'CPU_PERCENT' as const,
        response: {
          status: 'success',
          data: {
            resultType: 'matrix',
            result: [
              {
                metric: { namespace: 'test', pod: 'test-pod' },
                values: [['1641024000', '50.5']],
              },
            ],
          },
        } as PrometheusResponse,
      },
      {
        metric: 'MEMORY_MB' as const,
        response: {
          status: 'success',
          data: {
            resultType: 'matrix',
            result: [
              {
                metric: { namespace: 'test', pod: 'test-pod' },
                values: [['1641024000', '1024']],
              },
            ],
          },
        } as PrometheusResponse,
      },
    ];

    it('should process batch metrics correctly', async () => {
      const result = await service.processBatchMetrics(mockMetricsData);

      expect(result).toHaveProperty('CPU_PERCENT');
      expect(result).toHaveProperty('MEMORY_MB');
      expect(result.CPU_PERCENT).toHaveProperty('data');
      expect(result.CPU_PERCENT).toHaveProperty('csvContent');
      expect(result.MEMORY_MB).toHaveProperty('data');
      expect(result.MEMORY_MB).toHaveProperty('csvContent');
    });

    it('should handle empty metrics data', async () => {
      const result = await service.processBatchMetrics([]);

      expect(result).toEqual({});
    });

    it('should skip metrics with null data', async () => {
      const metricsWithNull = [
        {
          metric: 'CPU_PERCENT' as const,
          response: null as any,
        },
        {
          metric: 'MEMORY_MB' as const,
          response: mockMetricsData[1].response,
        },
      ];

      const result = await service.processBatchMetrics(metricsWithNull);

      expect(result).not.toHaveProperty('CPU_PERCENT');
      expect(result).toHaveProperty('MEMORY_MB');
    });
  });

  describe('createCombinedServiceMetricsCsv', () => {
    it('should handle empty processed results', async () => {
      const result = await service.createCombinedServiceMetricsCsv({});

      expect(result.hasData).toBe(false);
      expect(result.csvContent).toBe('');
    });

    it('should handle results without service metrics', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        CPU_PERCENT: {
          data: [['2022-01-01T12:00:00.000Z', 'default', 'test-pod', 50.5]],
          csvContent:
            'timestamp,namespace,pod,cpu_%\n2022-01-01T12:00:00.000Z,default,test-pod,50.5\n',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(false);
      expect(result.csvContent).toBe('');
    });

    it('should create combined service metrics CSV with service metrics', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        SERVICE_REQUEST_RATE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'GET /api',
              'api-service',
              120.5,
            ] as any,
          ],
          csvContent:
            'timestamp,operation,service_name,service_role,request_rate\n',
        },
        SERVICE_LATENCY_P95: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'GET /api',
              'api-service',
              250.3,
            ] as any,
          ],
          csvContent:
            'timestamp,operation,service_name,service_role,latency_p95_ms\n',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalled();
    });

    it('should handle SERVICE_ERROR_RATE_BY_TYPE metric correctly', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'api-service',
              '500_error',
              10.5,
            ] as any,
          ],
          csvContent: 'timestamp,service_name,error_type,error_rate\n',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalled();
    });

    it('should handle CLIENT_ERROR_RATE with proper data structure', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        CLIENT_ERROR_RATE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'GET /api',
              'auth-service',
              'backend',
              0.05,
            ] as any,
          ],
          csvContent:
            'timestamp,operation,service_name,service_role,client_error_rate\n',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });

    it('should handle SERVICE_ERROR_RATE_BY_TYPE with insufficient rest elements', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [
            ['2022-01-01T12:00:00.000Z', 'api-service', 0.01] as any, // Missing error_type, should trigger else branch
          ],
          csvContent: 'timestamp,service_name,service_error_rate\n',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });

    it('should handle service metrics with no rest elements', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        SERVICE_REQUEST_RATE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'GET /api',
              'api-service',
              // No value provided, should default to 0
            ] as any,
          ],
          csvContent: 'timestamp,operation,service_name,request_rate\n',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });

    it('should handle mixed service metrics including unsupported types', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        SERVICE_REQUEST_RATE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'GET /api',
              'api-service',
              'backend',
              120.5,
            ] as any,
          ],
          csvContent:
            'timestamp,operation,service_name,service_role,request_rate\n',
        },
        // Adding a non-service metric that should be filtered out
        CPU_PERCENT: {
          data: [
            ['2022-01-01T12:00:00.000Z', 'default', 'test-pod', 50.5] as any,
          ],
          csvContent: 'timestamp,namespace,pod,cpu_%\n',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });

    it('should handle SERVICE_ERROR_RATE_BY_TYPE with empty rest array', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'GET /api',
              'api-service',
              // No error_type or value provided - empty rest array case
            ] as any,
          ],
          csvContent:
            'timestamp,operation,service_name,error_type,service_error_rate\n',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });

    it('should skip completely unsupported metric types in default case', async () => {
      const mockProcessedResults = {
        COMPLETELY_UNKNOWN_METRIC: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'GET /api',
              'api-service',
              'backend',
              123,
            ] as any,
          ],
          csvContent:
            'timestamp,operation,service_name,service_role,unknown_value\n',
        },
        SERVICE_REQUEST_RATE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'POST /data',
              'data-service',
              'backend',
              456,
            ] as any,
          ],
          csvContent:
            'timestamp,operation,service_name,service_role,request_rate\n',
        },
      } as ProcessedMetricsBatchResult;

      const result =
        await service.createCombinedServiceMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });
  });

  describe('createCombinedRedisMetricsCsv', () => {
    it('should create combined Redis metrics CSV', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        REDIS_MEMORY_USED_KB: {
          data: [['2022-01-01T12:00:00.000Z', 'redis:6379', 2048] as any],
          csvContent: 'timestamp,instance,memory_used_kb\n',
        },
        REDIS_CONNECTED_CLIENTS: {
          data: [['2022-01-01T12:00:00.000Z', 'redis:6379', 25] as any],
          csvContent: 'timestamp,instance,connected_clients\n',
        },
        REDIS_HIT_RATIO: {
          data: [['2022-01-01T12:00:00.000Z', 'redis:6379', 85.5] as any],
          csvContent: 'timestamp,instance,hit_ratio\n',
        },
      };

      const result =
        await service.createCombinedRedisMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            '2022-01-01T12:00:00.000Z',
            'redis:6379',
            2048,
            25,
            '',
            85.5,
          ]),
        ]),
        {
          headers: [
            'timestamp',
            'instance',
            'memory_used_kb',
            'connected_clients',
            'uptime_seconds',
            'hit_ratio_percent',
          ],
        },
      );
    });

    it('should handle empty Redis metrics', async () => {
      const result = await service.createCombinedRedisMetricsCsv({});

      expect(result.hasData).toBe(false);
      expect(result.csvContent).toBe('');
    });

    it('should handle multiple Redis instances and timestamps', async () => {
      const mockProcessedResults: ProcessedMetricsBatchResult = {
        REDIS_MEMORY_USED_KB: {
          data: [
            ['2022-01-01T12:00:00.000Z', 'redis-master:6379', 2048] as any,
            ['2022-01-01T12:00:00.000Z', 'redis-slave:6379', 1024] as any,
            ['2022-01-01T13:00:00.000Z', 'redis-master:6379', 2100] as any,
          ],
          csvContent: 'timestamp,instance,memory_used_kb\n',
        },
        REDIS_CONNECTED_CLIENTS: {
          data: [
            ['2022-01-01T12:00:00.000Z', 'redis-master:6379', 25] as any,
            ['2022-01-01T12:00:00.000Z', 'redis-slave:6379', 15] as any,
          ],
          csvContent: 'timestamp,instance,connected_clients\n',
        },
        REDIS_UPTIME_SECONDS: {
          data: [
            ['2022-01-01T12:00:00.000Z', 'redis-master:6379', 86400] as any,
          ],
          csvContent: 'timestamp,instance,uptime_seconds\n',
        },
      };

      const result =
        await service.createCombinedRedisMetricsCsv(mockProcessedResults);

      expect(result.hasData).toBe(true);
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });
  });

  describe('error handling scenarios', () => {
    it('should handle writeToString errors gracefully', async () => {
      (fastCsv.writeToString as jest.Mock).mockRejectedValue(
        new Error('CSV generation failed'),
      );

      const mockResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'test', pod: 'test-pod' },
              values: [['1641024000', '50.5']],
            },
          ],
        },
      };

      await expect(
        service.processMetricData('CPU_PERCENT', mockResponse),
      ).rejects.toThrow('CSV generation failed');
    });

    it('should handle invalid timestamp values', async () => {
      const responseWithInvalidTimestamp: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'test', pod: 'test-pod' },
              values: [['abc', '50.5']], // invalid numeric timestamp
            },
          ],
        },
      };

      // Should throw because Date constructor with invalid timestamp will cause toISOString() to fail
      await expect(
        service.processMetricData('CPU_PERCENT', responseWithInvalidTimestamp),
      ).rejects.toThrow();
    });

    it('should handle missing metric labels', async () => {
      const responseWithMissingLabels: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: null as any,
              values: [['1641024000', '50.5']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'CPU_PERCENT',
        responseWithMissingLabels,
      );

      expect(result.data).toBeTruthy();
      expect(result.csvContent).toBe('mocked,csv,content\n');
    });
  });

  describe('value parsing', () => {
    const mockResponse: PrometheusResponse = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { namespace: 'test', pod: 'test-pod' },
            values: [['1641024000', '50.123456789']],
          },
        ],
      },
    };

    it('should format CPU_PERCENT values to 4 decimal places', async () => {
      const result = await service.processMetricData(
        'CPU_PERCENT',
        mockResponse,
      );

      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.any(String),
            'test',
            'test-pod',
            50.1235, // rounded to 4 decimal places
          ]),
        ]),
        expect.any(Object),
      );
    });

    it('should format MEMORY_MB values to 4 decimal places', async () => {
      const result = await service.processMetricData('MEMORY_MB', mockResponse);

      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.any(String),
            'test',
            'test-pod',
            50.1235, // rounded to 4 decimal places
          ]),
        ]),
        expect.any(Object),
      );
    });

    it('should format disk I/O values to 2 decimal places', async () => {
      const result = await service.processMetricData(
        'DISK_WRITE_BPS',
        mockResponse,
      );

      expect(fastCsv.writeToString).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.any(String),
            'test',
            'test-pod',
            50.12, // rounded to 2 decimal places
          ]),
        ]),
        expect.any(Object),
      );
    });
  });

  describe('createCombinedServiceMetricsCsv - additional branch coverage', () => {
    let mockWriteToString: jest.Mock;

    beforeEach(() => {
      mockWriteToString = jest
        .fn()
        .mockResolvedValue(
          'timestamp,operation,service_name,service_role,error_type,request_rate,latency_p95_ms,client_error_rate,service_error_rate\n2022-01-01T12:00:00.000Z,GET /api,api-service,backend,,,,123,\n',
        );
      (fastCsv.writeToString as jest.Mock) = mockWriteToString;
    });

    // This test targets lines 294-295: else if (rest.length > 0) condition for SERVICE_ERROR_RATE_BY_TYPE with rest.length === 1
    it('should hit else-if branch for SERVICE_ERROR_RATE_BY_TYPE with rest.length === 1', async () => {
      const processedResults: ProcessedMetricsBatchResult = {
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z', // timestamp
              'GET /api', // operation
              'api-service', // service_name
              // service_role is missing, so rest = []
              // This creates rest.length === 0, so it hits the final else branch
            ] as any,
          ],
          csvContent: '',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(processedResults);

      expect(result.hasData).toBe(true);
      expect(mockWriteToString).toHaveBeenCalled();
    });

    // This test targets lines 294-295: else if (rest.length > 0) for regular service metrics
    it('should hit else-if branch for SERVICE_REQUEST_RATE with rest.length > 0', async () => {
      const processedResults: ProcessedMetricsBatchResult = {
        SERVICE_REQUEST_RATE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z', // timestamp
              'GET /api', // operation
              'api-service', // service_name
              'backend', // service_role
              150, // rest[0] - this makes rest.length = 1 > 0
              // Since it's not SERVICE_ERROR_RATE_BY_TYPE and rest.length > 0,
              // it should hit the else if (rest.length > 0) branch at lines 294-295
            ] as any,
          ],
          csvContent: '',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(processedResults);

      expect(result.hasData).toBe(true);
      expect(mockWriteToString).toHaveBeenCalled();
    });

    // Test that covers the case where SERVICE_ERROR_RATE_BY_TYPE has exactly 1 element in rest
    it('should hit else-if branch for SERVICE_ERROR_RATE_BY_TYPE with rest.length === 1', async () => {
      const processedResults: ProcessedMetricsBatchResult = {
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z', // timestamp
              'GET /api', // operation
              'api-service', // service_name
              'backend', // service_role
              'timeout_error', // rest[0] - only one element, so rest.length === 1
              // Since rest.length === 1 (not > 1), the first condition fails
              // and it should hit else if (rest.length > 0) at lines 294-295
            ] as any,
          ],
          csvContent: '',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(processedResults);

      expect(result.hasData).toBe(true);
      expect(mockWriteToString).toHaveBeenCalled();
    });

    // Testing multiple scenarios to ensure comprehensive branch coverage
    it('should test comprehensive branch coverage scenarios', async () => {
      const processedResults: ProcessedMetricsBatchResult = {
        // Case 1: SERVICE_REQUEST_RATE with rest.length > 0 (should hit else-if branch)
        SERVICE_REQUEST_RATE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'GET /api',
              'api-service',
              'backend',
              150,
            ] as any,
          ],
          csvContent: '',
        },
        // Case 2: CLIENT_ERROR_RATE with rest.length > 0 (should hit else-if branch)
        CLIENT_ERROR_RATE: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'POST /data',
              'data-service',
              'backend',
              0.05,
            ] as any,
          ],
          csvContent: '',
        },
        // Case 3: SERVICE_LATENCY_P95 with rest.length > 0 (should hit else-if branch)
        SERVICE_LATENCY_P95: {
          data: [
            [
              '2022-01-01T12:00:00.000Z',
              'PUT /update',
              'update-service',
              'backend',
              250,
            ] as any,
          ],
          csvContent: '',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(processedResults);

      expect(result.hasData).toBe(true);
      expect(mockWriteToString).toHaveBeenCalled();
      const callArgs = mockWriteToString.mock.calls[0][0];
      expect(callArgs.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases for helper methods - improving branch coverage', () => {
    it('should handle service metrics with missing values array', async () => {
      const responseWithoutValues = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                service_name: 'test-service',
                service_role: 'backend',
              },
              // No values property, should use empty array fallback
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_REQUEST_RATE',
        responseWithoutValues,
      );

      expect(result.data).toEqual([]);
      expect(result.csvContent).toBeDefined();
    });

    it('should handle service metrics with null values array', async () => {
      const responseWithNullValues = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                service_name: 'test-service',
                service_role: 'backend',
              },
              values: null as any, // Null values should use empty array fallback
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'CLIENT_ERROR_RATE',
        responseWithNullValues,
      );

      expect(result.data).toEqual([]);
      expect(result.csvContent).toBeDefined();
    });

    it('should handle redis metrics with missing values array', async () => {
      const responseWithoutValues = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                instance: 'redis-1',
              },
              // No values property, should use empty array fallback
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_MEMORY_USED_KB',
        responseWithoutValues,
      );

      expect(result.data).toEqual([]);
      expect(result.csvContent).toBeDefined();
    });

    it('should handle redis metrics with missing instance label', async () => {
      const responseWithoutInstance = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                // No instance property, should default to 'redis'
              },
              values: [['1699123456', '1024']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_CONNECTED_CLIENTS',
        responseWithoutInstance,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][0]).toBeDefined(); // timestamp
      expect(result.data?.[0][1]).toBe('redis'); // default instance
      expect(result.data?.[0][2]).toBe(1024); // value
    });

    it('should handle service metrics with missing label fields', async () => {
      const responseWithMissingLabels = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                // Missing service_name and service_role, should use empty strings
              },
              values: [['1699123456', '0.05']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_ERROR_RATE_BY_TYPE',
        responseWithMissingLabels,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][0]).toBeDefined(); // timestamp
      expect(result.data?.[0][1]).toBe(''); // empty service_name
      expect(result.data?.[0][2]).toBe(''); // empty error_type (for SERVICE_ERROR_RATE_BY_TYPE)
      expect(result.data?.[0][3]).toBe(0.05); // value
    });

    it('should handle response without data property', async () => {
      const responseWithoutData = {
        status: 'success' as const,
        // No data property
      } as any;

      const result = await service.processMetricData(
        'CPU_PERCENT',
        responseWithoutData,
      );

      expect(result.data).toBe(null);
      expect(result.csvContent).toBe('');
    });

    it('should handle response without result property', async () => {
      const responseWithoutResult = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          // No result property
        },
      } as any;

      const result = await service.processMetricData(
        'MEMORY_MB',
        responseWithoutResult,
      );

      expect(result.data).toBe(null);
      expect(result.csvContent).toBe('');
    });

    // Additional edge case to try to hit the final branches for 75% coverage
    it('should handle precise branching scenario for SERVICE_ERROR_RATE_BY_TYPE', async () => {
      const processedResults: ProcessedMetricsBatchResult = {
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [
            // This should hit the condition where metric === 'SERVICE_ERROR_RATE_BY_TYPE' and rest.length === 1 (not > 1)
            // so it falls through to else if (rest.length > 0)
            [
              '2022-01-01T12:00:00.000Z',
              'GET /api',
              'api-service',
              'just_one_element', // rest.length = 1, so first condition fails, hits else-if
            ] as any,
          ],
          csvContent: '',
        },
      };

      const result =
        await service.createCombinedServiceMetricsCsv(processedResults);

      expect(result.hasData).toBe(true);
    });
  });

  describe('NaN value handling - comprehensive branch coverage', () => {
    it('should handle NaN values in CPU_PERCENT metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                namespace: 'test',
                pod: 'test-pod',
              },
              values: [
                ['1699123456', 'NaN'], // This will create NaN value
              ],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'CPU_PERCENT',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][3]).toBe('NaN'); // Should use 'NaN' string when isNaN(v) is true
    });

    it('should handle NaN values in MEMORY_MB metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                namespace: 'test',
                pod: 'test-pod',
              },
              values: [
                ['1699123456', 'invalid'], // This will create NaN value
              ],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'MEMORY_MB',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][3]).toBe('NaN'); // Should hit isNaN(v) ? 'NaN' : branch
    });

    it('should handle NaN values in DISK_WRITE_BPS metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                namespace: 'test',
                pod: 'test-pod',
              },
              values: [['1699123456', 'not-a-number']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'DISK_WRITE_BPS',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][3]).toBe('NaN');
    });

    it('should handle NaN values in DISK_READ_BPS metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                namespace: 'test',
                pod: 'test-pod',
              },
              values: [['1699123456', 'xyz']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'DISK_READ_BPS',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][3]).toBe('NaN');
    });

    it('should handle NaN values in NETWORK_THROUGHPUT_BPS metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                namespace: 'test',
                pod: 'test-pod',
              },
              values: [['1699123456', 'abc']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'NETWORK_THROUGHPUT_BPS',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][3]).toBe('NaN');
    });

    it('should handle NaN values in SERVICE_REQUEST_RATE metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                service_name: 'test-service',
                service_role: 'backend',
              },
              values: [['1699123456', 'not_a_number']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_REQUEST_RATE',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][3]).toBe('NaN'); // Should hit isNaN branch
    });

    it('should handle NaN values in SERVICE_LATENCY_P95 metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                service_name: 'test-service',
                service_role: 'backend',
              },
              values: [['1699123456', 'infinity']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_LATENCY_P95',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][3]).toBe('NaN');
    });

    it('should handle NaN values in LATENCY metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                worker_id: 'worker-1',
                control_plane_ip: '10.0.0.1',
                metric_type: 'avg',
              },
              values: [['1699123456', 'invalid_latency']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'LATENCY',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][4]).toBe('NaN'); // latency_ms field
    });

    it('should handle NaN values in CLIENT_ERROR_RATE metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                service_name: 'test-service',
                service_role: 'backend',
              },
              values: [['1699123456', 'undefined']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'CLIENT_ERROR_RATE',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][3]).toBe('NaN');
    });

    it('should handle NaN values in SERVICE_ERROR_RATE_BY_TYPE metric', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                service_name: 'test-service',
                error_type: 'timeout',
              },
              values: [['1699123456', 'null']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'SERVICE_ERROR_RATE_BY_TYPE',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][3]).toBe('NaN');
    });

    it('should handle NaN values in Redis metrics', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                instance: 'redis-1',
              },
              values: [['1699123456', 'not_a_number']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_MEMORY_USED_KB',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][2]).toBe('NaN');
    });

    it('should handle NaN values in REDIS_CONNECTED_CLIENTS with floor operation', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                instance: 'redis-1',
              },
              values: [['1699123456', 'text']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_CONNECTED_CLIENTS',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][2]).toBe('NaN'); // Should hit isNaN(v) ? 'NaN' : Math.floor(v) branch
    });

    it('should handle NaN values in REDIS_UPTIME_SECONDS with floor operation', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                instance: 'redis-1',
              },
              values: [['1699123456', 'bad_value']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_UPTIME_SECONDS',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][2]).toBe('NaN');
    });

    it('should handle NaN values in REDIS_HIT_RATIO with percentage conversion', async () => {
      const responseWithNaN = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                instance: 'redis-1',
              },
              values: [['1699123456', 'invalid_ratio']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'REDIS_HIT_RATIO',
        responseWithNaN,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][2]).toBe('NaN'); // Should hit isNaN(v) ? 'NaN' : Number((v * 100).toFixed(2)) branch
    });
  });

  describe('optional property access and fallback coverage', () => {
    it('should handle missing namespace and pod in Prometheus metrics', async () => {
      const responseWithMissingLabels = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                // No namespace or pod properties
              },
              values: [['1699123456', '50.5']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'CPU_PERCENT',
        responseWithMissingLabels,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][1]).toBe(''); // namespace should be empty string fallback
      expect(result.data?.[0][2]).toBe(''); // pod should be empty string fallback
    });

    it('should handle undefined metric object in Prometheus response', async () => {
      const responseWithUndefinedMetric = {
        status: 'success' as const,
        data: {
          resultType: 'vector',
          result: [
            {
              // No metric property at all
              values: [['1699123456', '100']],
            },
          ],
        },
      };

      const result = await service.processMetricData(
        'MEMORY_MB',
        responseWithUndefinedMetric,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0][1]).toBe(''); // Should use fallback for undefined metric?.namespace
      expect(result.data?.[0][2]).toBe(''); // Should use fallback for undefined metric?.pod
    });
  });
});
