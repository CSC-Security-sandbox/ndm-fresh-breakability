import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PrometheusDataProcessorService } from './prometheus-data-processor.service';
import { PrometheusClientService } from './prometheus-client.service';
import { PROMETHEUS_QUERIES } from '../activities/state-data-csv-generation/state-data-csv-generation.constants';
import { createWorkerQueriesForMultipleWorkers } from '../utils/prometheus-query.utils';

// Mock the utility function
jest.mock('../utils/prometheus-query.utils', () => ({
  createWorkerQueriesForMultipleWorkers: jest.fn(),
}));

describe('PrometheusDataProcessorService', () => {
  let service: PrometheusDataProcessorService;
  let prometheusClientService: jest.Mocked<PrometheusClientService>;
  let mockLogger: Partial<Logger>;

  const mockCreateWorkerQueriesForMultipleWorkers =
    createWorkerQueriesForMultipleWorkers as jest.MockedFunction<
      typeof createWorkerQueriesForMultipleWorkers
    >;

  beforeEach(async () => {
    const mockPrometheusClientService = {
      callPrometheusApi: jest.fn(),
    };

    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrometheusDataProcessorService,
        {
          provide: PrometheusClientService,
          useValue: mockPrometheusClientService,
        },
      ],
    }).compile();

    service = module.get<PrometheusDataProcessorService>(
      PrometheusDataProcessorService,
    );
    prometheusClientService = module.get(PrometheusClientService);

    // Replace the logger with our mock
    (service as any).logger = mockLogger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPrometheusMetrics', () => {
    const startDate = '2025-01-01T00:00:00Z';
    const endDate = '2025-01-02T00:00:00Z';

    const mockServicePodResponse = {
      status: 'success' as const,
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: {
              namespace: 'test-namespace',
              pod: 'test-pod-1',
              phase: 'Running',
            },
            values: [['1641024000', '1']],
          },
          {
            metric: {
              namespace: 'test-namespace-2',
              pod: 'test-pod-2',
              phase: 'Running',
            },
            values: [['1641024000', '1']],
          },
        ],
      },
    };

    const mockMetricsResponse = {
      status: 'success' as const,
      data: {
        resultType: 'matrix',
        result: [
          {
            values: [
              ['1641024000', '50.5'],
              ['1641027600', '60.2'],
            ],
          },
        ],
      },
    };

    const mockBuildDetailsResponse = {
      status: 'success' as const,
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: {
              pod: 'control-plane-pod',
              label_build_version: 'v1.0.0',
            },
            values: [['1641024000', '1']],
          },
        ],
      },
    };

    const mockWorkerBuildDetailsResponse = {
      status: 'success' as const,
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: {
              job: 'worker-job',
              label_build_version: 'v1.0.0',
              platform: 'linux',
              worker_id: 'worker-1',
            },
            values: [['1641024000', '1']],
          },
        ],
      },
    };

    it('should successfully process metrics without worker IDs', async () => {
      const mockResponses = [
        mockServicePodResponse,
        mockMetricsResponse,
        mockMetricsResponse,
        mockMetricsResponse,
        mockMetricsResponse,
        mockMetricsResponse,
        mockBuildDetailsResponse,
        mockWorkerBuildDetailsResponse,
      ];

      prometheusClientService.callPrometheusApi
        .mockResolvedValueOnce(mockResponses[0])
        .mockResolvedValueOnce(mockResponses[1])
        .mockResolvedValueOnce(mockResponses[2])
        .mockResolvedValueOnce(mockResponses[3])
        .mockResolvedValueOnce(mockResponses[4])
        .mockResolvedValueOnce(mockResponses[5])
        .mockResolvedValueOnce(mockResponses[6])
        .mockResolvedValueOnce(mockResponses[7]);

      const result = await service.getPrometheusMetrics(startDate, endDate);

      expect(prometheusClientService.callPrometheusApi).toHaveBeenCalledTimes(
        8,
      );
      expect(result).toEqual({
        servicePods: [
          {
            Namespace: 'test-namespace',
            Pod: 'test-pod-1',
            Status: 'Running',
            Timestamp: 'Saturday, 1 January 2022 at 1:30 pm',
          },
          {
            Namespace: 'test-namespace-2',
            Pod: 'test-pod-2',
            Status: 'Running',
            Timestamp: 'Saturday, 1 January 2022 at 1:30 pm',
          },
        ],
        allMetrics: expect.any(Array),
        buildDetails: [
          {
            Pod: 'control-plane-pod',
            'Build Version': 'v1.0.0',
            Timestamp: 'Saturday, 1 January 2022 at 1:30 pm',
          },
          {
            Pod: 'worker-job',
            'Worker Id': 'worker-1',
            Platform: 'linux',
            'Build Version': 'v1.0.0',
            Timestamp: 'Saturday, 1 January 2022 at 1:30 pm',
          },
        ],
      });

      expect(result.allMetrics).toHaveLength(10); // 2 values * 5 metrics
    });

    it('should successfully process metrics with worker IDs', async () => {
      const workerIds = ['worker-1', 'worker-2'];
      const modifiedQuery = 'modified_query_with_workers';

      mockCreateWorkerQueriesForMultipleWorkers.mockReturnValue(modifiedQuery);

      prometheusClientService.callPrometheusApi
        .mockResolvedValueOnce(mockServicePodResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockBuildDetailsResponse)
        .mockResolvedValueOnce(mockWorkerBuildDetailsResponse);

      const result = await service.getPrometheusMetrics(
        startDate,
        endDate,
        workerIds,
      );

      expect(mockCreateWorkerQueriesForMultipleWorkers).toHaveBeenCalledTimes(
        3,
      );
      expect(prometheusClientService.callPrometheusApi).toHaveBeenCalledTimes(
        8,
      );
      expect(result).toBeDefined();
      expect(result.servicePods).toHaveLength(2);
      expect(result.allMetrics).toBeDefined();
      expect(result.buildDetails).toHaveLength(2);
    });

    it('should handle empty worker IDs array', async () => {
      const workerIds: string[] = [];

      prometheusClientService.callPrometheusApi
        .mockResolvedValueOnce(mockServicePodResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockBuildDetailsResponse)
        .mockResolvedValueOnce(mockWorkerBuildDetailsResponse);

      await service.getPrometheusMetrics(startDate, endDate, workerIds);

      expect(mockCreateWorkerQueriesForMultipleWorkers).not.toHaveBeenCalled();
      expect(prometheusClientService.callPrometheusApi).toHaveBeenCalledTimes(
        8,
      );
    });

    it('should handle partial failures in Prometheus queries', async () => {
      const mockError = new Error('Prometheus query failed');

      prometheusClientService.callPrometheusApi
        .mockResolvedValueOnce(mockServicePodResponse)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockMetricsResponse)
        .mockResolvedValueOnce(mockBuildDetailsResponse)
        .mockResolvedValueOnce(mockWorkerBuildDetailsResponse);

      const result = await service.getPrometheusMetrics(startDate, endDate);

      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch'),
      );
      expect(result).toBeDefined();
      expect(result.servicePods).toHaveLength(2);
    });

    it('should handle complete failure and propagate error', async () => {
      const mockError = new Error('Complete failure');

      // Mock the buildQueries method to throw an error
      jest.spyOn(service as any, 'buildQueries').mockImplementation(() => {
        throw mockError;
      });

      await expect(
        service.getPrometheusMetrics(startDate, endDate),
      ).rejects.toThrow(mockError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error fetching Prometheus metrics'),
      );
    });

    it('should handle null/undefined responses from Prometheus', async () => {
      const mockNullResponse = {
        status: 'success' as const,
        data: undefined,
      };

      prometheusClientService.callPrometheusApi.mockImplementation(() =>
        Promise.resolve(mockNullResponse),
      );

      const result = await service.getPrometheusMetrics(startDate, endDate);

      expect(result).toEqual({
        servicePods: [],
        allMetrics: [],
        buildDetails: [],
      });
    });
  });

  describe('processServicePods', () => {
    it('should process valid service pod data correctly', () => {
      const servicePodData = {
        data: {
          result: [
            {
              metric: {
                namespace: 'test-ns',
                pod: 'pod-1',
                phase: 'Running',
              },
              values: [['1641024000', '1']],
            },
            {
              metric: {
                namespace: 'test-ns',
                pod: 'pod-2',
                phase: 'Pending',
              },
              values: [['1641024001', '1']],
            },
          ],
        },
      };

      const result = (service as any).processServicePods(servicePodData);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        Namespace: 'test-ns',
        Pod: 'pod-1',
        Status: 'Running',
        Timestamp: 'Saturday, 1 January 2022 at 1:30 pm',
      });
    });

    it('should handle duplicate pods and keep unique entries', () => {
      const servicePodData = {
        data: {
          result: [
            {
              metric: {
                namespace: 'test-ns',
                pod: 'pod-1',
                phase: 'Running',
              },
              values: [['1641024000', '1']],
            },
            {
              metric: {
                namespace: 'test-ns',
                pod: 'pod-1',
                phase: 'Running',
              },
              values: [['1641024000', '1']],
            },
          ],
        },
      };

      const result = (service as any).processServicePods(servicePodData);

      expect(result).toHaveLength(1);
    });

    it('should filter out invalid pod data', () => {
      const servicePodData = {
        data: {
          result: [
            {
              metric: {
                namespace: 'test-ns',
                pod: 'pod-1',
                phase: 'Running',
              },
              values: [['1641024000', '1']],
            },
            {
              metric: {
                namespace: 'test-ns',
                // Missing pod
                phase: 'Running',
              },
              values: [['1641024000', '1']],
            },
            {
              metric: {
                namespace: 'test-ns',
                pod: 'pod-3',
                phase: 'Running',
              },
              // Missing values
            },
          ],
        },
      };

      const result = (service as any).processServicePods(servicePodData);

      expect(result).toHaveLength(1);
      expect(result[0].Pod).toBe('pod-1');
    });

    it('should return empty array for null/undefined input', () => {
      expect((service as any).processServicePods(null)).toEqual([]);
      expect((service as any).processServicePods(undefined)).toEqual([]);
      expect((service as any).processServicePods({})).toEqual([]);
      expect((service as any).processServicePods({ data: null })).toEqual([]);
    });
  });

  describe('isValidPodData', () => {
    it('should return true for valid pod data', () => {
      const validData = {
        metric: {
          namespace: 'test-ns',
          pod: 'test-pod',
          phase: 'Running',
        },
        values: [['1641024000', '1']],
      };

      expect((service as any).isValidPodData(validData)).toBe(true);
    });

    it('should return false for invalid pod data', () => {
      const invalidCases = [
        {
          metric: { pod: 'test-pod', phase: 'Running' },
          values: [['1641024000', '1']],
        }, // missing namespace
        {
          metric: { namespace: 'test-ns', phase: 'Running' },
          values: [['1641024000', '1']],
        }, // missing pod
        {
          metric: { namespace: 'test-ns', pod: 'test-pod' },
          values: [['1641024000', '1']],
        }, // missing phase
        { metric: { namespace: 'test-ns', pod: 'test-pod', phase: 'Running' } }, // missing values
        {
          metric: { namespace: 'test-ns', pod: 'test-pod', phase: 'Running' },
          values: [],
        }, // empty values
        {
          metric: { namespace: 'test-ns', pod: 'test-pod', phase: 'Running' },
          values: [[]],
        }, // empty first value
      ];

      invalidCases.forEach((invalidData) => {
        expect((service as any).isValidPodData(invalidData)).toBeFalsy();
      });
    });
  });

  describe('processAllMetrics', () => {
    const mockMetricsData = {
      cpuUsageCP: {
        data: {
          result: [
            {
              values: [
                ['1641024000', '50.5'],
                ['1641027600', '60.2'],
              ],
            },
          ],
        },
      },
      memoryUsageCP: {
        data: {
          result: [
            {
              values: [['1641024000', '70.1']],
            },
          ],
        },
      },
      cpuUsageWorker: null,
      memoryUsageWorker: undefined,
      systemUpTime: {
        data: {
          result: [
            {
              values: [['1641024000', '100.0']],
            },
          ],
        },
      },
    };

    it('should process all valid metrics correctly', () => {
      const result = (service as any).processAllMetrics(mockMetricsData);

      expect(result).toHaveLength(4); // 2 CPU CP + 1 Memory CP + 1 System Uptime
      expect(result[0]).toEqual({
        Name: 'CPU Usage of CP',
        Timestamp: 'Saturday, 1 January 2022 at 1:30 pm',
        Usage: '50.500',
      });
      expect(result[1]).toEqual({
        Name: 'CPU Usage of CP',
        Timestamp: 'Saturday, 1 January 2022 at 2:30 pm',
        Usage: '60.200',
      });
    });

    it('should handle null/undefined metrics gracefully', () => {
      const nullMetricsData = {
        cpuUsageCP: null,
        memoryUsageCP: undefined,
        cpuUsageWorker: null,
        memoryUsageWorker: undefined,
        systemUpTime: null,
      };

      const result = (service as any).processAllMetrics(nullMetricsData);

      expect(result).toEqual([]);
    });

    it('should handle metrics with missing values', () => {
      const incompleteMetricsData = {
        cpuUsageCP: { data: { result: [{}] } },
        memoryUsageCP: { data: { result: [] } },
        cpuUsageWorker: { data: {} },
        memoryUsageWorker: {},
        systemUpTime: null,
      };

      const result = (service as any).processAllMetrics(incompleteMetricsData);

      expect(result).toEqual([]);
    });

    it('should handle values with null/undefined entries', () => {
      const metricsWithNullValues = {
        cpuUsageCP: {
          data: {
            result: [
              {
                values: [
                  ['1641024000', null],
                  ['1641027600', undefined],
                  ['1641031200', '50.5'],
                ],
              },
            ],
          },
        },
        memoryUsageCP: null,
        cpuUsageWorker: null,
        memoryUsageWorker: null,
        systemUpTime: null,
      };

      const result = (service as any).processAllMetrics(metricsWithNullValues);

      expect(result).toHaveLength(3);
      expect(result[0].Usage).toBe('0.000');
      expect(result[1].Usage).toBe('0.000');
      expect(result[2].Usage).toBe('50.500');
    });
  });

  describe('processBuildDetails', () => {
    it('should process both CP and worker build details', () => {
      const buildDetailsData = {
        cpBuildDetails: {
          data: {
            result: [
              {
                metric: {
                  pod: 'cp-pod-1',
                  label_build_version: 'v1.0.0',
                },
                values: [['1641024000', '1']],
              },
            ],
          },
        },
        workerBuildDetails: {
          data: {
            result: [
              {
                metric: {
                  job: 'worker-job-1',
                  label_build_version: 'v1.1.0',
                  platform: 'linux',
                  worker_id: 'worker-1',
                },
                values: [['1641024000', '1']],
              },
            ],
          },
        },
      };

      const result = (service as any).processBuildDetails(buildDetailsData);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        Pod: 'cp-pod-1',
        'Build Version': 'v1.0.0',
        Timestamp: 'Saturday, 1 January 2022 at 1:30 pm',
      });
      expect(result[1]).toEqual({
        Pod: 'worker-job-1',
        'Build Version': 'v1.1.0',
        Platform: 'linux',
        'Worker Id': 'worker-1',
        Timestamp: 'Saturday, 1 January 2022 at 1:30 pm',
      });
    });

    it('should handle null/undefined build details', () => {
      const buildDetailsData = {
        cpBuildDetails: null,
        workerBuildDetails: undefined,
      };

      const result = (service as any).processBuildDetails(buildDetailsData);

      expect(result).toEqual([]);
    });

    it('should handle partial build details', () => {
      const buildDetailsData = {
        cpBuildDetails: {
          data: {
            result: [
              {
                metric: {
                  pod: 'cp-pod-1',
                  label_build_version: 'v1.0.0',
                },
                values: [['1641024000', '1']],
              },
            ],
          },
        },
        workerBuildDetails: null,
      };

      const result = (service as any).processBuildDetails(buildDetailsData);

      expect(result).toHaveLength(1);
      expect(result[0].Pod).toBe('cp-pod-1');
    });

    it('should handle empty result arrays', () => {
      const buildDetailsData = {
        cpBuildDetails: {
          data: {
            result: [],
          },
        },
        workerBuildDetails: {
          data: {
            result: [],
          },
        },
      };

      const result = (service as any).processBuildDetails(buildDetailsData);

      expect(result).toEqual([]);
    });
  });

  describe('buildQueries', () => {
    it('should return base queries when no worker IDs provided', () => {
      const result = (service as any).buildQueries([]);

      expect(result).toEqual(Object.values(PROMETHEUS_QUERIES));
      expect(mockCreateWorkerQueriesForMultipleWorkers).not.toHaveBeenCalled();
    });

    it('should modify queries containing $worker when worker IDs provided', () => {
      const workerIds = ['worker-1', 'worker-2'];
      const modifiedQuery = 'modified_worker_query';

      mockCreateWorkerQueriesForMultipleWorkers.mockReturnValue(modifiedQuery);

      const result = (service as any).buildQueries(workerIds);

      expect(result).toHaveLength(8);

      // Check that queries with $worker are modified
      const workerQueries = result.filter((q) => q.query === modifiedQuery);
      expect(workerQueries.length).toBeGreaterThan(0);

      // Check that queries without $worker remain unchanged
      const unchangedQueries = result.filter((q) => q.query !== modifiedQuery);
      expect(unchangedQueries.length).toBeGreaterThan(0);
    });
  });

  describe('extractSuccessfulResults', () => {
    it('should extract successful results and log warnings for failures', () => {
      const results = [
        { status: 'fulfilled', value: { data: 'success1' } },
        { status: 'rejected', reason: { message: 'Failed query' } },
        { status: 'fulfilled', value: { data: 'success2' } },
      ];

      const extracted = (service as any).extractSuccessfulResults(results);

      expect(extracted).toHaveLength(3);
      expect(extracted[0]).toEqual({ data: 'success1' });
      expect(extracted[1]).toBeNull();
      expect(extracted[2]).toEqual({ data: 'success2' });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch'),
      );
    });

    it('should handle all successful results', () => {
      const results = [
        { status: 'fulfilled', value: { data: 'success1' } },
        { status: 'fulfilled', value: { data: 'success2' } },
      ];

      const extracted = (service as any).extractSuccessfulResults(results);

      expect(extracted).toHaveLength(2);
      expect(extracted[0]).toEqual({ data: 'success1' });
      expect(extracted[1]).toEqual({ data: 'success2' });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle all failed results', () => {
      const results = [
        { status: 'rejected', reason: { message: 'Error 1' } },
        { status: 'rejected', reason: { message: 'Error 2' } },
      ];

      const extracted = (service as any).extractSuccessfulResults(results);

      expect(extracted).toHaveLength(2);
      expect(extracted[0]).toBeNull();
      expect(extracted[1]).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });
  });
});
