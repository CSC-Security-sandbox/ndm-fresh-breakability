import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PerformanceMetricsCsvGenerationActivity } from './performance-metrics-csv-generation.activity';
import { PrometheusClientService } from 'src/prometheus/prometheus-client.service';
import { PerformanceMetricsProcessorService } from './performance-metrics-processor.service';
import { ZipHandlerService } from 'src/services/zip-handler.service';
import PERFORMANCE_METRICS_QUERIES from './performance-metrics.constants';
import { ProcessedMetricsBatchResult } from './performance-metrics.interface';

describe('PerformanceMetricsCsvGenerationActivity', () => {
  let activity: PerformanceMetricsCsvGenerationActivity;
  let prometheusClient: jest.Mocked<PrometheusClientService>;
  let processorService: jest.Mocked<PerformanceMetricsProcessorService>;
  let zipHandler: jest.Mocked<ZipHandlerService>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(async () => {
    const mockPrometheusClient = {
      callPrometheusApi: jest.fn(),
    };

    const mockProcessorService = {
      processBatchMetrics: jest.fn(),
      createCombinedRedisMetricsCsv: jest.fn(),
    };

    const mockZipHandler = {
      addCsvToZip: jest.fn(),
    };

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      fatal: jest.fn(),
      setContext: jest.fn(),
      localInstance: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
        fatal: jest.fn(),
      },
    } as any;

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

    // Mock logger by replacing the private property
    (activity as any).logger = mockLogger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generatePerformanceMetricsCsv', () => {
    const mockPayload = {
      otherMetrics: ['Performance Metrics'],
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-01-02T00:00:00Z',
      zipLocation: '/path/to/zip.zip',
    };
    const traceId = 'test-trace-id';

    it('should skip generation when Performance Metrics not requested', async () => {
      const payload = {
        ...mockPayload,
        otherMetrics: ['Other Metrics'],
      };

      const result = await activity.generatePerformanceMetricsCsv({
        traceId,
        payload,
      });

      expect(result).toBe(
        'Performance Metrics CSV generation skipped - not requested',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Performance Metrics not requested in otherMetrics, skipping`,
      );
      expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
    });

    it('should skip generation when otherMetrics is undefined', async () => {
      const payload = {
        ...mockPayload,
        otherMetrics: undefined,
      };

      const result = await activity.generatePerformanceMetricsCsv({
        traceId,
        payload,
      });

      expect(result).toBe(
        'Performance Metrics CSV generation skipped - not requested',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Performance Metrics not requested in otherMetrics, skipping`,
      );
    });

    it('should skip generation when otherMetrics does not include Performance Metrics', async () => {
      const payload = {
        ...mockPayload,
        otherMetrics: ['System Inventory', 'Configuration Data'],
      };

      const result = await activity.generatePerformanceMetricsCsv({
        traceId,
        payload,
      });

      expect(result).toBe(
        'Performance Metrics CSV generation skipped - not requested',
      );
    });

    it('should successfully generate performance metrics CSV', async () => {
      const mockPrometheusResponse = {
        status: 'success' as const,
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { namespace: 'default', pod: 'test-pod' },
              values: [[1704067200, '50.5']],
            },
          ],
        },
      };

      const mockProcessedResults: ProcessedMetricsBatchResult = {
        CPU_PERCENT: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 50.5]],
          csvContent:
            'timestamp,namespace,pod,cpu_%\n2024-01-01T00:00:00.000Z,default,test-pod,50.5',
        },
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        mockProcessedResults,
      );
      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      const result = await activity.generatePerformanceMetricsCsv({
        traceId,
        payload: mockPayload,
      });

      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Starting Performance metrics CSV generation`,
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Performance metrics CSV generation completed successfully`,
      );
      expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(
        Object.keys(PERFORMANCE_METRICS_QUERIES).length,
      );
    });

    it('should handle prometheus API failures gracefully', async () => {
      const mockError = new Error('Prometheus API error');
      prometheusClient.callPrometheusApi.mockRejectedValue(mockError);

      processorService.processBatchMetrics.mockResolvedValue({});
      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      const result = await activity.generatePerformanceMetricsCsv({
        traceId,
        payload: mockPayload,
      });

      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should call prometheus API with correct parameters for each metric', async () => {
      const mockPrometheusResponse = {
        status: 'success' as const,
        data: { resultType: 'matrix', result: [] },
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue({});
      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await activity.generatePerformanceMetricsCsv({
        traceId,
        payload: mockPayload,
      });

      const expectedCalls = Object.entries(PERFORMANCE_METRICS_QUERIES).length;
      expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(
        expectedCalls,
      );

      // Verify each metric was called with correct parameters
      Object.entries(PERFORMANCE_METRICS_QUERIES).forEach(
        ([metric, config], index) => {
          expect(prometheusClient.callPrometheusApi).toHaveBeenNthCalledWith(
            index + 1,
            config.query,
            mockPayload.startDate,
            mockPayload.endDate,
            config.step,
          );
        },
      );
    });
  });

  describe('extractSuccessfulResults', () => {
    it('should extract successful results and log warnings for failures', async () => {
      const mockResults = [
        {
          status: 'fulfilled',
          value: { metric: 'CPU_PERCENT', response: { data: 'success' } },
        },
        {
          status: 'rejected',
          reason: { message: 'Network error' },
        },
        {
          status: 'fulfilled',
          value: { metric: 'MEMORY_MB', response: { data: 'success' } },
        },
      ];

      const extractedResults = (activity as any).extractSuccessfulResults(
        mockResults,
      );

      expect(extractedResults).toEqual([
        { metric: 'CPU_PERCENT', response: { data: 'success' } },
        null,
        { metric: 'MEMORY_MB', response: { data: 'success' } },
      ]);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch'),
      );
    });

    it('should handle all successful results', async () => {
      const mockResults = [
        {
          status: 'fulfilled',
          value: { metric: 'CPU_PERCENT', response: { data: 'success1' } },
        },
        {
          status: 'fulfilled',
          value: { metric: 'MEMORY_MB', response: { data: 'success2' } },
        },
      ];

      const extractedResults = (activity as any).extractSuccessfulResults(
        mockResults,
      );

      expect(extractedResults).toEqual([
        { metric: 'CPU_PERCENT', response: { data: 'success1' } },
        { metric: 'MEMORY_MB', response: { data: 'success2' } },
      ]);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle all failed results', async () => {
      const mockResults = [
        {
          status: 'rejected',
          reason: { message: 'Error 1' },
        },
        {
          status: 'rejected',
          reason: { message: 'Error 2' },
        },
      ];

      const extractedResults = (activity as any).extractSuccessfulResults(
        mockResults,
      );

      expect(extractedResults).toEqual([null, null]);
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('generateCsvFiles', () => {
    const traceId = 'test-trace';
    const zipLocation = '/path/to/zip.zip';
    const timestamp = 1704067200000;
    let dateNowSpy: jest.SpyInstance;

    beforeEach(() => {
      dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(timestamp);
    });

    afterEach(() => {
      dateNowSpy.mockRestore();
    });

    it('should generate CPU percent CSV file', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        CPU_PERCENT: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 50.5]],
          csvContent: 'timestamp,namespace,pod,cpu_%\ndata',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockData.CPU_PERCENT!.csvContent,
        `cpu-percent-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] CPU Percent CSV created: cpu-percent-${timestamp}.csv`,
      );
    });

    it('should generate memory CSV file', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        MEMORY_MB: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 1024]],
          csvContent: 'timestamp,namespace,pod,memory_mb\ndata',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockData.MEMORY_MB!.csvContent,
        `memory-mb-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Memory CSV created: memory-mb-${timestamp}.csv`,
      );
    });

    it('should generate disk read BPS CSV file', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        DISK_READ_BPS: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 1000]],
          csvContent: 'timestamp,namespace,pod,disk_read_bps\ndata',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockData.DISK_READ_BPS!.csvContent,
        `disk-read-bps-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Disk Read BPS CSV created: disk-read-bps-${timestamp}.csv`,
      );
    });

    it('should generate disk write BPS CSV file', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        DISK_WRITE_BPS: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 2000]],
          csvContent: 'timestamp,namespace,pod,disk_write_bps\ndata',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockData.DISK_WRITE_BPS!.csvContent,
        `disk-write-bps-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Disk Write BPS CSV created: disk-write-bps-${timestamp}.csv`,
      );
    });

    it('should generate network throughput CSV file', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        NETWORK_THROUGHPUT_BPS: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 3000]],
          csvContent: 'timestamp,namespace,pod,network_bps\ndata',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockData.NETWORK_THROUGHPUT_BPS!.csvContent,
        `network-throughput-bps-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Network Throughput BPS CSV created: network-throughput-bps-${timestamp}.csv`,
      );
    });

    it('should generate service request rate CSV file', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        SERVICE_REQUEST_RATE: {
          data: [['2024-01-01T00:00:00.000Z', 'GET', 'api-service', 100]],
          csvContent: 'timestamp,operation,service_name,request_rate\ndata',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockData.SERVICE_REQUEST_RATE!.csvContent,
        `service-request-rate-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Service Request Rate CSV created: service-request-rate-${timestamp}.csv`,
      );
    });

    it('should generate service latency P95 CSV file', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        SERVICE_LATENCY_P95: {
          data: [['2024-01-01T00:00:00.000Z', 'GET', 'api-service', 250]],
          csvContent: 'timestamp,operation,service_name,latency_p95_ms\ndata',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockData.SERVICE_LATENCY_P95!.csvContent,
        `service-latency-p95-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Service Latency P95 CSV created: service-latency-p95-${timestamp}.csv`,
      );
    });

    it('should generate client error rate CSV file', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        CLIENT_ERROR_RATE: {
          data: [['2024-01-01T00:00:00.000Z', 'api-service', 'client', 0.02]],
          csvContent:
            'timestamp,service_name,service_role,client_error_rate\ndata',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockData.CLIENT_ERROR_RATE!.csvContent,
        `client-error-rate-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Client Error Rate CSV created: client-error-rate-${timestamp}.csv`,
      );
    });

    it('should generate service error rate by type CSV file', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        SERVICE_ERROR_RATE_BY_TYPE: {
          data: [['2024-01-01T00:00:00.000Z', 'api-service', '5xx', 0.01]],
          csvContent: 'timestamp,service_name,error_type,error_rate\ndata',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockData.SERVICE_ERROR_RATE_BY_TYPE!.csvContent,
        `service-error-rate-by-type-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Service Error Rate by Type CSV created: service-error-rate-by-type-${timestamp}.csv`,
      );
    });

    it('should generate Redis metrics CSV file when data is available', async () => {
      const mockData: ProcessedMetricsBatchResult = {};

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent:
          'timestamp,instance,memory_used_kb\n2024-01-01T00:00:00.000Z,redis-1,2048',
        hasData: true,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(
        processorService.createCombinedRedisMetricsCsv,
      ).toHaveBeenCalledWith(mockData);
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'timestamp,instance,memory_used_kb\n2024-01-01T00:00:00.000Z,redis-1,2048',
        `redis-metrics-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Redis Metrics CSV created: redis-metrics-${timestamp}.csv`,
      );
    });

    it('should not generate Redis metrics CSV file when no data is available', async () => {
      const mockData: ProcessedMetricsBatchResult = {};

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(
        processorService.createCombinedRedisMetricsCsv,
      ).toHaveBeenCalledWith(mockData);
      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(0);
    });

    it('should skip generating CSV files when data is empty', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        CPU_PERCENT: {
          data: [],
          csvContent: '',
        },
        MEMORY_MB: {
          data: [],
          csvContent: '',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();
      expect(mockLogger.log).not.toHaveBeenCalledWith(
        expect.stringContaining('CSV created'),
      );
    });

    it('should generate multiple CSV files when multiple metrics have data', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        CPU_PERCENT: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 50.5]],
          csvContent: 'cpu,data',
        },
        MEMORY_MB: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 1024]],
          csvContent: 'memory,data',
        },
        SERVICE_REQUEST_RATE: {
          data: [['2024-01-01T00:00:00.000Z', 'GET', 'api-service', 100]],
          csvContent: 'service,data',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: 'redis,data',
        hasData: true,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(4); // 3 individual + 1 Redis combined
      expect(mockLogger.log).toHaveBeenCalledTimes(4);
    });

    it('should handle undefined data gracefully', async () => {
      const mockData: ProcessedMetricsBatchResult = {
        CPU_PERCENT: undefined,
        MEMORY_MB: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 1024]],
          csvContent: 'memory,data',
        },
      };

      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      await (activity as any).generateCsvFiles(traceId, mockData, zipLocation);

      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(1); // Only MEMORY_MB
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'memory,data',
        `memory-mb-${timestamp}.csv`,
        zipLocation,
        'Performance Metrics',
      );
    });
  });

  describe('integration test', () => {
    it('should handle complete workflow with mixed success and failure', async () => {
      const traceId = 'integration-test';
      const payload = {
        otherMetrics: ['Performance Metrics'],
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-02T00:00:00Z',
        zipLocation: '/path/to/test.zip',
      };

      // Mock some successful and some failed prometheus calls
      prometheusClient.callPrometheusApi
        .mockResolvedValueOnce({
          status: 'success' as const,
          data: {
            resultType: 'matrix',
            result: [
              {
                metric: { namespace: 'default', pod: 'test-pod' },
                values: [[1704067200, '75.5']],
              },
            ],
          },
        })
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          status: 'success' as const,
          data: { resultType: 'matrix', result: [] },
        });

      const mockProcessedResults: ProcessedMetricsBatchResult = {
        CPU_PERCENT: {
          data: [['2024-01-01T00:00:00.000Z', 'default', 'test-pod', 75.5]],
          csvContent:
            'timestamp,namespace,pod,cpu_%\n2024-01-01T00:00:00.000Z,default,test-pod,75.5',
        },
      };

      processorService.processBatchMetrics.mockResolvedValue(
        mockProcessedResults,
      );
      processorService.createCombinedRedisMetricsCsv.mockResolvedValue({
        csvContent: '',
        hasData: false,
      });

      const result = await activity.generatePerformanceMetricsCsv({
        traceId,
        payload,
      });

      expect(result).toBe(
        'Performance metrics CSV generation completed successfully',
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${traceId}] Starting Performance metrics CSV generation`,
      );
      expect(mockLogger.warn).toHaveBeenCalled(); // For the failed API call
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockProcessedResults.CPU_PERCENT!.csvContent,
        expect.stringContaining('cpu-percent-'),
        payload.zipLocation,
        'Performance Metrics',
      );
    });
  });
});
