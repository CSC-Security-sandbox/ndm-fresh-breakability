import { Test, TestingModule } from '@nestjs/testing';
import { PerformanceMetricsCsvGenerationActivity } from './performance-metrics-csv-generation.activity';
import { PrometheusClientService } from 'src/prometheus/prometheus-client.service';
import { PerformanceMetricsProcessorService } from './performance-metrics-processor.service';
import { ZipHandlerService } from 'src/services/zip-handler.service';
import { PrometheusResponse } from 'src/prometheus/prometheus.interface';
import { ProcessedMetricsBatchResult } from './performance-metrics.interface';

// Mock the constants
jest.mock('./performance-metrics.constants', () => ({
  __esModule: true,
  default: {
    CPU_PERCENT: {
      query:
        'sum(rate(container_cpu_usage_seconds_total{container!="",pod!=""}[5m])) by (namespace, pod) * 100',
      step: '1h',
    },
    MEMORY_MB: {
      query:
        'sum(container_memory_usage_bytes{container!="",pod!=""}) by (namespace, pod) / (1024*1024)',
      step: '1h',
    },
    DISK_WRITE_BPS: {
      query:
        'sum(rate(container_fs_writes_bytes_total{container!="",pod!=""}[5m])) by (namespace, pod) * 8',
      step: '1h',
    },
    DISK_READ_BPS: {
      query:
        'sum(rate(container_fs_reads_bytes_total{container!="",pod!=""}[5m])) by (namespace, pod) * 8',
      step: '1h',
    },
    NETWORK_THROUGHPUT_BPS: {
      query:
        '(sum(rate(container_network_receive_bytes_total{pod!=""}[2m])) by (namespace, pod) + sum(rate(container_network_transmit_bytes_total{pod!=""}[2m])) by (namespace, pod)) * 8',
      step: '1h',
    },
    SERVICE_REQUEST_RATE: {
      query:
        'sum by (operation, service_name, service_role) (rate(service_requests[2m]))',
      step: '1h',
    },
    SERVICE_LATENCY_P95: {
      query:
        'histogram_quantile(0.95, sum(rate(service_latency_bucket[5m])) by (operation, service_name, service_role, le)) * 1000',
      step: '1h',
    },
    CLIENT_ERROR_RATE: {
      query: 'sum by (service_name, service_role) (rate(client_errors[5m]))',
      step: '1h',
    },
    SERVICE_ERROR_RATE_BY_TYPE: {
      query:
        'sum by (service_name, error_type) (rate(service_errors_with_type[5m]))',
      step: '1h',
    },
  },
}));

describe('PerformanceMetricsCsvGenerationActivity', () => {
  let activity: PerformanceMetricsCsvGenerationActivity;
  let prometheusClient: jest.Mocked<PrometheusClientService>;
  let processorService: jest.Mocked<PerformanceMetricsProcessorService>;
  let zipHandler: jest.Mocked<ZipHandlerService>;
  let loggerSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Mock environment variables for step values
    process.env.STEP_1hr = '1h';

    const mockPrometheusClient = {
      callPrometheusApi: jest.fn(),
    };

    const mockProcessorService = {
      processBatchMetrics: jest.fn(),
    };

    const mockZipHandler = {
      addCsvToZip: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceMetricsCsvGenerationActivity,
        {
          provide: PrometheusClientService,
          useValue: mockPrometheusClient,
        },
        {
          provide: PerformanceMetricsProcessorService,
          useValue: mockProcessorService,
        },
        {
          provide: ZipHandlerService,
          useValue: mockZipHandler,
        },
      ],
    }).compile();

    activity = module.get<PerformanceMetricsCsvGenerationActivity>(
      PerformanceMetricsCsvGenerationActivity,
    );
    prometheusClient = module.get(PrometheusClientService);
    processorService = module.get(PerformanceMetricsProcessorService);
    zipHandler = module.get(ZipHandlerService);

    loggerSpy = jest.spyOn(activity['logger'], 'log').mockImplementation();
    loggerWarnSpy = jest.spyOn(activity['logger'], 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(activity).toBeDefined();
  });

  describe('generatePerformanceMetricsCsv', () => {
    const mockTraceId = 'test-trace-id';
    const mockPayload = {
      startDate: '2023-01-01',
      endDate: '2023-01-02',
      zipLocation: '/test/path/bundle.zip',
      otherMetrics: ['Performance Metrics'],
    };

    const mockPrometheusResponse: PrometheusResponse = {
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

    const mockProcessedResults: ProcessedMetricsBatchResult = {
      CPU_PERCENT: {
        data: [['2023-01-01T00:00:00.000Z', 'default', 'pod1', 0.5]],
        csvContent:
          'timestamp,namespace,pod,cpu_%\n2023-01-01T00:00:00.000Z,default,pod1,0.5',
      },
      MEMORY_MB: {
        data: [['2023-01-01T00:00:00.000Z', 'default', 'pod1', 512]],
        csvContent:
          'timestamp,namespace,pod,memory_mb\n2023-01-01T00:00:00.000Z,default,pod1,512',
      },
    };

    beforeEach(() => {
      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        mockProcessedResults,
      );
      zipHandler.addCsvToZip.mockResolvedValue();
    });

    it('should successfully generate performance metrics CSV', async () => {
      const result = await activity.generatePerformanceMetricsCsv({
        traceId: mockTraceId,
        payload: mockPayload,
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        `[${mockTraceId}] Starting Performance metrics CSV generation`,
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `[${mockTraceId}] Performance metrics CSV generation completed successfully`,
      );

      expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(9); // 9 different metrics (5 infrastructure + 4 service)
      expect(processorService.processBatchMetrics).toHaveBeenCalledTimes(1);
      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(2); // CPU_PERCENT and MEMORY_MB

      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
    });

    it('should handle Prometheus API failures gracefully', async () => {
      // Make first call succeed, second call fail
      prometheusClient.callPrometheusApi
        .mockResolvedValueOnce(mockPrometheusResponse)
        .mockRejectedValueOnce(new Error('Prometheus API error'));

      const result = await activity.generatePerformanceMetricsCsv({
        traceId: mockTraceId,
        payload: mockPayload,
      });

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch'),
      );
      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
    });

    it('should handle partial failures in metric queries', async () => {
      // Mock some successful and some failed calls
      prometheusClient.callPrometheusApi
        .mockResolvedValueOnce(mockPrometheusResponse)
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce(mockPrometheusResponse)
        .mockRejectedValueOnce(new Error('Query error'))
        .mockResolvedValueOnce(mockPrometheusResponse);

      const result = await activity.generatePerformanceMetricsCsv({
        traceId: mockTraceId,
        payload: mockPayload,
      });

      expect(loggerWarnSpy).toHaveBeenCalledTimes(2);
      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
    });

    it('should call Prometheus API with correct parameters for each metric', async () => {
      await activity.generatePerformanceMetricsCsv({
        traceId: mockTraceId,
        payload: mockPayload,
      });

      // Verify that each metric query was called with correct parameters
      // Should be called 9 times (5 infrastructure + 4 service metrics)
      expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(9);

      // Check that each call includes the step parameter (from env STEP_1hr)
      expect(prometheusClient.callPrometheusApi).toHaveBeenCalledWith(
        expect.any(String),
        mockPayload.startDate,
        mockPayload.endDate,
        '1h', // step parameter from process.env.STEP_1hr
      );
    });

    it('should handle processor service errors', async () => {
      processorService.processBatchMetrics.mockRejectedValue(
        new Error('Processing failed'),
      );

      await expect(
        activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: mockPayload,
        }),
      ).rejects.toThrow('Processing failed');
    });

    it('should handle zip handler errors', async () => {
      zipHandler.addCsvToZip.mockRejectedValue(
        new Error('Zip creation failed'),
      );

      await expect(
        activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: mockPayload,
        }),
      ).rejects.toThrow('Zip creation failed');
    });

    describe('otherMetrics validation', () => {
      it('should skip processing when otherMetrics is not in array', async () => {
        const payloadWithoutPerformanceMetrics = {
          ...mockPayload,
          otherMetrics: ['Other Metric', 'Another Metric'], // Doesn't include 'Performance Metrics'
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithoutPerformanceMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Performance Metrics not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'Performance Metrics CSV generation skipped - not requested',
        );
      });

      it('should skip processing when otherMetrics is empty array', async () => {
        const payloadWithEmptyArray = {
          ...mockPayload,
          otherMetrics: [], // Empty array
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithEmptyArray,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Performance Metrics not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'Performance Metrics CSV generation skipped - not requested',
        );
      });

      it('should skip processing when otherMetrics is undefined', async () => {
        const payloadWithUndefinedOtherMetrics = {
          ...mockPayload,
          otherMetrics: undefined, // Undefined
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithUndefinedOtherMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Performance Metrics not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'Performance Metrics CSV generation skipped - not requested',
        );
      });

      it('should skip processing when otherMetrics property is missing', async () => {
        const payloadWithoutOtherMetrics = {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation: '/test/path/bundle.zip',
          // No otherMetrics property
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithoutOtherMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Performance Metrics not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'Performance Metrics CSV generation skipped - not requested',
        );
      });

      it('should process when Performance Metrics is included in otherMetrics array', async () => {
        const payloadWithPerformanceMetrics = {
          ...mockPayload,
          otherMetrics: [
            'Other Metric',
            'Performance Metrics',
            'Another Metric',
          ], // Includes 'Performance Metrics'
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithPerformanceMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Starting Performance metrics CSV generation`,
        );
        expect(loggerSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('skipping'),
        );

        expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(9);
        expect(processorService.processBatchMetrics).toHaveBeenCalledTimes(1);
        expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(2);

        expect(result).toBe(
          'Performance metrics CSV generation completed successfully',
        );
      });

      it('should be case sensitive when checking for Performance Metrics', async () => {
        const payloadWithWrongCase = {
          ...mockPayload,
          otherMetrics: [
            'performance metrics',
            'PERFORMANCE METRICS',
            'Performance metrics',
          ], // Wrong cases
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithWrongCase,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Performance Metrics not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'Performance Metrics CSV generation skipped - not requested',
        );
      });

      it('should skip when otherMetrics is null', async () => {
        const payloadWithNullOtherMetrics = {
          ...mockPayload,
          otherMetrics: null, // Null
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithNullOtherMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Performance Metrics not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'Performance Metrics CSV generation skipped - not requested',
        );
      });

      it('should process when otherMetrics is a string containing Performance Metrics', async () => {
        const payloadWithStringOtherMetrics = {
          ...mockPayload,
          otherMetrics: 'Performance Metrics', // String - should work since strings have includes method
        };

        prometheusClient.callPrometheusApi.mockResolvedValue(
          mockPrometheusResponse,
        );
        processorService.processBatchMetrics.mockResolvedValue(
          mockProcessedResults,
        );
        zipHandler.addCsvToZip.mockResolvedValue(undefined);

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithStringOtherMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Starting Performance metrics CSV generation`,
        );

        expect(prometheusClient.callPrometheusApi).toHaveBeenCalled();
        expect(processorService.processBatchMetrics).toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).toHaveBeenCalled();

        expect(result).toBe(
          'Performance metrics CSV generation completed successfully',
        );
      });

      it('should skip when otherMetrics string does not contain Performance Metrics', async () => {
        const payloadWithWrongString = {
          ...mockPayload,
          otherMetrics: 'Other Metrics Only', // String without 'Performance Metrics'
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithWrongString,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Performance Metrics not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'Performance Metrics CSV generation skipped - not requested',
        );
      });

      it('should skip when otherMetrics is a partial match string', async () => {
        const payloadWithPartialMatch = {
          ...mockPayload,
          otherMetrics: 'Performance', // Partial match - should not work
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithPartialMatch,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Performance Metrics not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'Performance Metrics CSV generation skipped - not requested',
        );
      });

      it('should handle payload being null when checking otherMetrics', async () => {
        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: null,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${mockTraceId}] Performance Metrics not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'Performance Metrics CSV generation skipped - not requested',
        );
      });

      it('should proceed when otherMetrics contains only Performance Metrics', async () => {
        const payloadWithOnlyPerformanceMetrics = {
          ...mockPayload,
          otherMetrics: ['Performance Metrics'], // Only Performance Metrics
        };

        const result = await activity.generatePerformanceMetricsCsv({
          traceId: mockTraceId,
          payload: payloadWithOnlyPerformanceMetrics,
        });

        expect(loggerSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('skipping'),
        );

        expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(9);
        expect(processorService.processBatchMetrics).toHaveBeenCalledTimes(1);
        expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(2);

        expect(result).toBe(
          'Performance metrics CSV generation completed successfully',
        );
      });
    });
  });

  describe('extractSuccessfulResults', () => {
    it('should extract successful results and log failures', () => {
      const results = [
        {
          status: 'fulfilled',
          value: { metric: 'CPU_PERCENT', response: mockPrometheusResponse },
        },
        { status: 'rejected', reason: new Error('API Error') },
        {
          status: 'fulfilled',
          value: { metric: 'MEMORY_MB', response: mockPrometheusResponse },
        },
        { status: 'rejected', reason: new Error('Network Error') },
      ];

      const extractedResults = activity['extractSuccessfulResults'](results);

      expect(extractedResults).toHaveLength(4);
      expect(extractedResults[0]).toEqual({
        metric: 'CPU_PERCENT',
        response: mockPrometheusResponse,
      });
      expect(extractedResults[1]).toBeNull();
      expect(extractedResults[2]).toEqual({
        metric: 'MEMORY_MB',
        response: mockPrometheusResponse,
      });
      expect(extractedResults[3]).toBeNull();

      expect(loggerWarnSpy).toHaveBeenCalledTimes(2);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Failed to fetch MEMORY_MB: API Error',
      );
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Failed to fetch DISK_READ_BPS: Network Error',
      );
    });

    it('should handle results with no failures', () => {
      const results = [
        {
          status: 'fulfilled',
          value: { metric: 'CPU_PERCENT', response: mockPrometheusResponse },
        },
        {
          status: 'fulfilled',
          value: { metric: 'MEMORY_MB', response: mockPrometheusResponse },
        },
      ];

      const extractedResults = activity['extractSuccessfulResults'](results);

      expect(extractedResults).toHaveLength(2);
      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle all failed results', () => {
      const results = [
        { status: 'rejected', reason: new Error('Error 1') },
        { status: 'rejected', reason: new Error('Error 2') },
      ];

      const extractedResults = activity['extractSuccessfulResults'](results);

      expect(extractedResults).toEqual([null, null]);
      expect(loggerWarnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('generateCsvFiles', () => {
    const mockTraceId = 'test-trace-id';
    const mockZipLocation = '/test/bundle.zip';
    const timestamp = Date.now();

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(timestamp);
      zipHandler.addCsvToZip.mockResolvedValue();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const mockData: ProcessedMetricsBatchResult = {
      CPU_PERCENT: {
        data: [['2023-01-01', 'default', 'pod1', 0.5]],
        csvContent: 'csv,content',
      },
      MEMORY_MB: {
        data: [['2023-01-01', 'default', 'pod1', 512]],
        csvContent: 'memory,csv,content',
      },
      DISK_READ_BPS: {
        data: [['2023-01-01', 'default', 'pod1', 1024]],
        csvContent: 'disk,read,content',
      },
      DISK_WRITE_BPS: {
        data: [['2023-01-01', 'default', 'pod1', 2048]],
        csvContent: 'disk,write,content',
      },
      NETWORK_THROUGHPUT_BPS: {
        data: [['2023-01-01', 'default', 'pod1', 4096]],
        csvContent: 'network,content',
      },
    };

    it('should generate CSV files for all available metrics', async () => {
      await activity['generateCsvFiles'](
        mockTraceId,
        mockData,
        mockZipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(5);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'csv,content',
        `Performance metrics/cpu_percent_${timestamp}.csv`,
        mockZipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'memory,csv,content',
        `Performance metrics/memory_mb_${timestamp}.csv`,
        mockZipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'disk,read,content',
        `Performance metrics/disk_read_bps_${timestamp}.csv`,
        mockZipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'disk,write,content',
        `Performance metrics/disk_write_bps_${timestamp}.csv`,
        mockZipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'network,content',
        `Performance metrics/network_throughput_bps_${timestamp}.csv`,
        mockZipLocation,
      );

      expect(loggerSpy).toHaveBeenCalledTimes(5);
    });

    it('should skip metrics with no data', async () => {
      const dataWithEmptyMetrics: ProcessedMetricsBatchResult = {
        CPU_PERCENT: {
          data: [],
          csvContent: '',
        },
        MEMORY_MB: {
          data: [['2023-01-01', 'default', 'pod1', 512]],
          csvContent: 'memory,csv,content',
        },
      };

      await activity['generateCsvFiles'](
        mockTraceId,
        dataWithEmptyMetrics,
        mockZipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(1);
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'memory,csv,content',
        `Performance metrics/memory_mb_${timestamp}.csv`,
        mockZipLocation,
      );
    });

    it('should skip metrics with null data', async () => {
      const dataWithNullMetrics: ProcessedMetricsBatchResult = {
        CPU_PERCENT: {
          data: null as any,
          csvContent: 'cpu,content',
        },
        MEMORY_MB: {
          data: [['2023-01-01', 'default', 'pod1', 512]],
          csvContent: 'memory,csv,content',
        },
      };

      await activity['generateCsvFiles'](
        mockTraceId,
        dataWithNullMetrics,
        mockZipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(1);
    });

    it('should skip undefined metrics', async () => {
      const dataWithUndefinedMetrics: ProcessedMetricsBatchResult = {
        CPU_PERCENT: undefined as any,
        MEMORY_MB: {
          data: [['2023-01-01', 'default', 'pod1', 512]],
          csvContent: 'memory,csv,content',
        },
      };

      await activity['generateCsvFiles'](
        mockTraceId,
        dataWithUndefinedMetrics,
        mockZipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(1);
    });

    it('should handle zip handler failures for individual files', async () => {
      zipHandler.addCsvToZip
        .mockResolvedValueOnce() // CPU_PERCENT succeeds
        .mockRejectedValueOnce(new Error('Zip error')); // MEMORY_MB fails

      await expect(
        activity['generateCsvFiles'](mockTraceId, mockData, mockZipLocation),
      ).rejects.toThrow('Zip error');
    });

    it('should handle empty data object', async () => {
      await activity['generateCsvFiles'](mockTraceId, {}, mockZipLocation);

      expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('CSV created'),
      );
    });
  });

  describe('edge cases and error scenarios', () => {
    const mockPrometheusResponse: PrometheusResponse = {
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

    it('should handle missing payload properties', async () => {
      const incompletePayload = {
        startDate: '2023-01-01',
        otherMetrics: ['Performance Metrics'],
        // Missing endDate and zipLocation
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue({});

      const result = await activity.generatePerformanceMetricsCsv({
        traceId: 'test-trace',
        payload: incompletePayload,
      });

      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
    });

    it('should handle null payload', async () => {
      const result = await activity.generatePerformanceMetricsCsv({
        traceId: 'test-trace',
        payload: null as any,
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        '[test-trace] Performance Metrics not requested in otherMetrics, skipping',
      );

      expect(result).toBe(
        'Performance Metrics CSV generation skipped - not requested',
      );
    });

    it('should handle empty traceId', async () => {
      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue({});

      const result = await activity.generatePerformanceMetricsCsv({
        traceId: '',
        payload: {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation: '/test',
          otherMetrics: ['Performance Metrics'],
        },
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        '[] Starting Performance metrics CSV generation',
      );
      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
    });

    it('should handle very long traceId', async () => {
      const longTraceId = 'x'.repeat(1000);
      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue({});

      const result = await activity.generatePerformanceMetricsCsv({
        traceId: longTraceId,
        payload: {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation: '/test',
          otherMetrics: ['Performance Metrics'],
        },
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        `[${longTraceId}] Starting Performance metrics CSV generation`,
      );
      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
    });

    it('should handle Prometheus API returning non-standard responses', async () => {
      prometheusClient.callPrometheusApi.mockResolvedValue({
        status: 'unknown',
        customField: 'custom value',
      } as any);

      processorService.processBatchMetrics.mockResolvedValue({});

      const result = await activity.generatePerformanceMetricsCsv({
        traceId: 'test-trace',
        payload: {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation: '/test',
          otherMetrics: ['Performance Metrics'],
        },
      });

      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
    });
  });

  describe('Service Metrics CSV Generation', () => {
    const mockServiceMetricsData: ProcessedMetricsBatchResult = {
      SERVICE_REQUEST_RATE: {
        data: [
          ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 150.5],
        ],
        csvContent:
          'timestamp,operation,service_name,request_rate\n2023-01-01T00:00:00.000Z,get_users,user-service,150.5',
      },
      SERVICE_LATENCY_P95: {
        data: [
          ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 245.8],
        ],
        csvContent:
          'timestamp,operation,service_name,latency_p95_ms\n2023-01-01T00:00:00.000Z,get_users,user-service,245.8',
      },
      CLIENT_ERROR_RATE: {
        data: [['2023-01-01T00:00:00.000Z', 'user-service', 'api', 2.5]],
        csvContent:
          'timestamp,service_name,service_role,client_error_rate\n2023-01-01T00:00:00.000Z,user-service,api,2.5',
      },
      SERVICE_ERROR_RATE_BY_TYPE: {
        data: [['2023-01-01T00:00:00.000Z', 'user-service', 'timeout', 5.2]],
        csvContent:
          'timestamp,service_name,error_type,error_rate\n2023-01-01T00:00:00.000Z,user-service,timeout,5.2',
      },
    };

    it('should generate CSV files for all service metrics', async () => {
      const traceId = 'test-trace';
      const zipLocation = '/test/zip/path';

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        mockServiceMetricsData,
      );
      zipHandler.addCsvToZip.mockResolvedValue(undefined);

      const result = await activity.generatePerformanceMetricsCsv({
        traceId,
        payload: {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation,
          otherMetrics: ['Performance Metrics'],
        },
      });

      // Verify ZIP handler was called for each service metric
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockServiceMetricsData.SERVICE_REQUEST_RATE!.csvContent,
        expect.stringMatching(
          /Performance metrics\/service_request_rate_\d+\.csv/,
        ),
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockServiceMetricsData.SERVICE_LATENCY_P95!.csvContent,
        expect.stringMatching(
          /Performance metrics\/service_latency_p95_\d+\.csv/,
        ),
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockServiceMetricsData.CLIENT_ERROR_RATE!.csvContent,
        expect.stringMatching(
          /Performance metrics\/client_error_rate_\d+\.csv/,
        ),
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockServiceMetricsData.SERVICE_ERROR_RATE_BY_TYPE!.csvContent,
        expect.stringMatching(
          /Performance metrics\/service_error_rate_by_type_\d+\.csv/,
        ),
        zipLocation,
      );

      // Verify logging for each service metric
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[test-trace\] Service Request Rate CSV created: Performance metrics\/service_request_rate_\d+\.csv/,
        ),
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[test-trace\] Service Latency P95 CSV created: Performance metrics\/service_latency_p95_\d+\.csv/,
        ),
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[test-trace\] Client Error Rate CSV created: Performance metrics\/client_error_rate_\d+\.csv/,
        ),
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[test-trace\] Service Error Rate by Type CSV created: Performance metrics\/service_error_rate_by_type_\d+\.csv/,
        ),
      );

      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
    });

    it('should skip service metrics with no data', async () => {
      const traceId = 'test-trace';
      const zipLocation = '/test/zip/path';

      const dataWithEmptyMetrics: ProcessedMetricsBatchResult = {
        SERVICE_REQUEST_RATE: {
          data: [], // Empty data
          csvContent: '',
        },
        SERVICE_LATENCY_P95: {
          data: [
            ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 245.8],
          ],
          csvContent: 'mock csv',
        },
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        dataWithEmptyMetrics,
      );
      zipHandler.addCsvToZip.mockResolvedValue(undefined);

      await activity.generatePerformanceMetricsCsv({
        traceId,
        payload: {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation,
          otherMetrics: ['Performance Metrics'],
        },
      });

      // Should not call zip handler for SERVICE_REQUEST_RATE (empty data)
      expect(zipHandler.addCsvToZip).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/service_request_rate/),
        expect.anything(),
      );

      // Should call zip handler for SERVICE_LATENCY_P95 (has data)
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'mock csv',
        expect.stringMatching(/service_latency_p95/),
        zipLocation,
      );

      // Should not log creation of empty metrics
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Service Request Rate CSV created'),
      );

      // Should log creation of metrics with data
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Service Latency P95 CSV created/),
      );
    });

    it('should handle service metrics with null data property', async () => {
      const traceId = 'test-trace';
      const zipLocation = '/test/zip/path';

      const dataWithNullMetrics: ProcessedMetricsBatchResult = {
        SERVICE_REQUEST_RATE: {
          data: null as any, // Null data
          csvContent: 'mock csv',
        },
        CLIENT_ERROR_RATE: {
          data: [['2023-01-01T00:00:00.000Z', 'user-service', 'api', 2.5]],
          csvContent: 'mock csv',
        },
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        dataWithNullMetrics,
      );
      zipHandler.addCsvToZip.mockResolvedValue(undefined);

      await activity.generatePerformanceMetricsCsv({
        traceId,
        payload: {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation,
          otherMetrics: ['Performance Metrics'],
        },
      });

      // Should not call zip handler for SERVICE_REQUEST_RATE (null data)
      expect(zipHandler.addCsvToZip).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(/service_request_rate/),
        expect.anything(),
      );

      // Should call zip handler for CLIENT_ERROR_RATE (has valid data)
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'mock csv',
        expect.stringMatching(/client_error_rate/),
        zipLocation,
      );
    });

    it('should handle individual service metric properties being undefined', async () => {
      const traceId = 'test-trace';
      const zipLocation = '/test/zip/path';

      const partialData: ProcessedMetricsBatchResult = {
        SERVICE_REQUEST_RATE: undefined as any, // Completely undefined
        SERVICE_LATENCY_P95: {
          data: [
            ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 245.8],
          ],
          csvContent: 'latency csv',
        },
        CLIENT_ERROR_RATE: null as any, // Null metric
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [['2023-01-01T00:00:00.000Z', 'user-service', 'timeout', 5.2]],
          csvContent: 'error csv',
        },
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(partialData);
      zipHandler.addCsvToZip.mockResolvedValue(undefined);

      await activity.generatePerformanceMetricsCsv({
        traceId,
        payload: {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation,
          otherMetrics: ['Performance Metrics'],
        },
      });

      // Should only call zip handler for metrics that exist and have data
      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(2); // Only SERVICE_LATENCY_P95 and SERVICE_ERROR_RATE_BY_TYPE

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'latency csv',
        expect.stringMatching(/service_latency_p95/),
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'error csv',
        expect.stringMatching(/service_error_rate_by_type/),
        zipLocation,
      );

      // Should only log creation of valid metrics
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Service Latency P95 CSV created/),
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Service Error Rate by Type CSV created/),
      );

      // Should not log creation of undefined/null metrics
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Service Request Rate CSV created'),
      );

      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Client Error Rate CSV created'),
      );
    });

    it('should handle service metrics zip failures gracefully', async () => {
      const traceId = 'test-trace';
      const zipLocation = '/test/zip/path';

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue({
        SERVICE_REQUEST_RATE: {
          data: [
            ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 150.5],
          ],
          csvContent: 'test csv',
        },
      });

      zipHandler.addCsvToZip.mockRejectedValue(new Error('Zip write failed'));

      await expect(
        activity.generatePerformanceMetricsCsv({
          traceId,
          payload: {
            startDate: '2023-01-01',
            endDate: '2023-01-02',
            zipLocation,
            otherMetrics: ['Performance Metrics'],
          },
        }),
      ).rejects.toThrow('Zip write failed');
    });

    it('should use consistent timestamp for all service metric file names', async () => {
      const traceId = 'test-trace';
      const zipLocation = '/test/zip/path';

      // Mock Date.now to return consistent timestamp
      const mockTimestamp = 1672531200000;
      jest.spyOn(Date, 'now').mockReturnValue(mockTimestamp);

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        mockServiceMetricsData,
      );
      zipHandler.addCsvToZip.mockResolvedValue(undefined);

      await activity.generatePerformanceMetricsCsv({
        traceId,
        payload: {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation,
          otherMetrics: ['Performance Metrics'],
        },
      });

      // Verify all service metrics use the same timestamp
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        expect.anything(),
        `Performance metrics/service_request_rate_${mockTimestamp}.csv`,
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        expect.anything(),
        `Performance metrics/service_latency_p95_${mockTimestamp}.csv`,
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        expect.anything(),
        `Performance metrics/client_error_rate_${mockTimestamp}.csv`,
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        expect.anything(),
        `Performance metrics/service_error_rate_by_type_${mockTimestamp}.csv`,
        zipLocation,
      );

      // Restore Date.now
      jest.restoreAllMocks();
    });

    it('should handle mixed infrastructure and service metrics', async () => {
      const traceId = 'test-trace';
      const zipLocation = '/test/zip/path';

      const mixedData: ProcessedMetricsBatchResult = {
        CPU_PERCENT: {
          data: [['2023-01-01T00:00:00.000Z', 'default', 'pod1', 50.0]],
          csvContent: 'cpu csv',
        },
        SERVICE_REQUEST_RATE: {
          data: [
            ['2023-01-01T00:00:00.000Z', 'get_users', 'user-service', 150.5],
          ],
          csvContent: 'request rate csv',
        },
        MEMORY_MB: {
          data: [['2023-01-01T00:00:00.000Z', 'default', 'pod1', 1024.0]],
          csvContent: 'memory csv',
        },
        CLIENT_ERROR_RATE: {
          data: [['2023-01-01T00:00:00.000Z', 'user-service', 'api', 2.5]],
          csvContent: 'client error csv',
        },
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(mixedData);
      zipHandler.addCsvToZip.mockResolvedValue(undefined);

      await activity.generatePerformanceMetricsCsv({
        traceId,
        payload: {
          startDate: '2023-01-01',
          endDate: '2023-01-02',
          zipLocation,
          otherMetrics: ['Performance Metrics'],
        },
      });

      // Should create files for both infrastructure and service metrics
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'cpu csv',
        expect.stringMatching(/cpu_percent_\d+\.csv/),
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'memory csv',
        expect.stringMatching(/memory_mb_\d+\.csv/),
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'request rate csv',
        expect.stringMatching(/service_request_rate_\d+\.csv/),
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'client error csv',
        expect.stringMatching(/client_error_rate_\d+\.csv/),
        zipLocation,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(4);
    });
  });

  const mockPrometheusResponse: PrometheusResponse = {
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
});
