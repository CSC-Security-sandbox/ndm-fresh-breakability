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

      expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(5); // 5 different metrics
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
      // Should be called 5 times (CPU_PERCENT, MEMORY_MB, DISK_WRITE_BPS, DISK_READ_BPS, NETWORK_THROUGHPUT_BPS)
      expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(5);

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
      await expect(
        activity.generatePerformanceMetricsCsv({
          traceId: 'test-trace',
          payload: null as any,
        }),
      ).rejects.toThrow(TypeError);
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
        },
      });

      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
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
