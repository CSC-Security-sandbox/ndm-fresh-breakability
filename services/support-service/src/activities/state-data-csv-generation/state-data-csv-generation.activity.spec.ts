import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { StateDataCsvGenerationActivity } from './state-data-csv-generation.activity';
import { PrometheusDataProcessorService } from '../../prometheus/prometheus-data-processor.service';
import { CsvGeneratorService } from '../../services/csv-generator.service';
import { ZipHandlerService } from '../../services/zip-handler.service';
import { PrometheusMetrics } from './state-data-csv-generation.interface';

describe('StateDataCsvGenerationActivity', () => {
  let activity: StateDataCsvGenerationActivity;
  let prometheusDataProcessor: jest.Mocked<PrometheusDataProcessorService>;
  let csvGenerator: jest.Mocked<CsvGeneratorService>;
  let zipHandler: jest.Mocked<ZipHandlerService>;
  let logger: jest.Mocked<Logger>;

  const mockPrometheusMetrics: PrometheusMetrics = {
    servicePods: [
      {
        Namespace: 'datamigrator',
        Pod: 'test-pod-1',
        Status: 'Running',
        Timestamp: '1234567890',
      },
      {
        Namespace: 'datamigrator',
        Pod: 'test-pod-2',
        Status: 'Running',
        Timestamp: '1234567891',
      },
    ],
    allMetrics: [
      {
        Name: 'CPU Usage of CP',
        Timestamp: '1234567890',
        Usage: '25.50',
      },
      {
        Name: 'Memory Usage of CP',
        Timestamp: '1234567890',
        Usage: '45.75',
      },
    ],
    buildDetails: [
      {
        Pod: 'worker-pod-1',
        'Build Version': 'v1.0.0',
        Timestamp: '1234567890',
      },
      {
        Pod: 'worker-pod-2',
        'Build Version': 'v1.0.1',
        Timestamp: '1234567891',
      },
    ],
  };

  beforeEach(async () => {
    const mockPrometheusDataProcessorService = {
      getPrometheusMetrics: jest.fn(),
    };

    const mockCsvGeneratorService = {
      createServicePodsCsvContent: jest.fn(),
      createMetricsCsvContent: jest.fn(),
      createBuildDetailsCsvContent: jest.fn(),
    };

    const mockZipHandlerService = {
      addCsvToZip: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateDataCsvGenerationActivity,
        {
          provide: PrometheusDataProcessorService,
          useValue: mockPrometheusDataProcessorService,
        },
        {
          provide: CsvGeneratorService,
          useValue: mockCsvGeneratorService,
        },
        {
          provide: ZipHandlerService,
          useValue: mockZipHandlerService,
        },
      ],
    }).compile();

    activity = module.get<StateDataCsvGenerationActivity>(
      StateDataCsvGenerationActivity,
    );
    prometheusDataProcessor = module.get(PrometheusDataProcessorService);
    csvGenerator = module.get(CsvGeneratorService);
    zipHandler = module.get(ZipHandlerService);

    // Mock the logger
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as any;

    // Replace the activity's logger with our mock
    (activity as any).logger = logger;

    // Setup default mock implementations
    prometheusDataProcessor.getPrometheusMetrics.mockResolvedValue(
      mockPrometheusMetrics,
    );
    csvGenerator.createServicePodsCsvContent.mockReturnValue(
      'service,pods,csv,content',
    );
    csvGenerator.createMetricsCsvContent.mockReturnValue('metrics,csv,content');
    csvGenerator.createBuildDetailsCsvContent.mockReturnValue(
      'build,details,csv,content',
    );
    zipHandler.addCsvToZip.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateStateDataCsv', () => {
    const traceId = 'test-trace-id';
    const basePayload = {
      startDate: '2023-01-01',
      endDate: '2023-01-31',
      zipLocation: '/path/to/zip',
      otherMetrics: ['State Data'], // Include this to make tests pass the new condition
    };

    // Test cases for otherMetrics condition (new feature)
    describe('otherMetrics condition', () => {
      it('should skip processing when State Data is not in otherMetrics', async () => {
        const payload = {
          ...basePayload,
          otherMetrics: ['Other Metric'], // Does not include 'State Data'
          projectWorkerMap: [{ workerIds: ['worker-1'] }],
        };

        const result = await activity.generateStateDataCsv({
          traceId,
          payload,
        });

        expect(logger.log).toHaveBeenCalledWith(
          '[test-trace-id] Starting State Data CSV generation',
        );
        expect(logger.log).toHaveBeenCalledWith(
          '[test-trace-id] Worker IDs provided: worker-1',
        );
        expect(logger.log).toHaveBeenCalledWith(
          '[test-trace-id] State Data not requested in otherMetrics, skipping',
        );
        expect(result).toBe(
          'State Data CSV generation skipped - not requested',
        );
        expect(
          prometheusDataProcessor.getPrometheusMetrics,
        ).not.toHaveBeenCalled();
      });

      it('should skip processing when otherMetrics is undefined', async () => {
        const payload = {
          ...basePayload,
          otherMetrics: undefined,
          projectWorkerMap: [{ workerIds: ['worker-1'] }],
        };

        const result = await activity.generateStateDataCsv({
          traceId,
          payload,
        });

        expect(logger.log).toHaveBeenCalledWith(
          '[test-trace-id] State Data not requested in otherMetrics, skipping',
        );
        expect(result).toBe(
          'State Data CSV generation skipped - not requested',
        );
        expect(
          prometheusDataProcessor.getPrometheusMetrics,
        ).not.toHaveBeenCalled();
      });

      it('should skip processing when otherMetrics is null', async () => {
        const payload = {
          ...basePayload,
          otherMetrics: null,
          projectWorkerMap: [{ workerIds: ['worker-1'] }],
        };

        const result = await activity.generateStateDataCsv({
          traceId,
          payload,
        });

        expect(logger.log).toHaveBeenCalledWith(
          '[test-trace-id] State Data not requested in otherMetrics, skipping',
        );
        expect(result).toBe(
          'State Data CSV generation skipped - not requested',
        );
        expect(
          prometheusDataProcessor.getPrometheusMetrics,
        ).not.toHaveBeenCalled();
      });

      it('should skip processing when otherMetrics is empty array', async () => {
        const payload = {
          ...basePayload,
          otherMetrics: [],
          projectWorkerMap: [{ workerIds: ['worker-1'] }],
        };

        const result = await activity.generateStateDataCsv({
          traceId,
          payload,
        });

        expect(logger.log).toHaveBeenCalledWith(
          '[test-trace-id] State Data not requested in otherMetrics, skipping',
        );
        expect(result).toBe(
          'State Data CSV generation skipped - not requested',
        );
        expect(
          prometheusDataProcessor.getPrometheusMetrics,
        ).not.toHaveBeenCalled();
      });

      it('should process when State Data is included along with other metrics', async () => {
        const payload = {
          ...basePayload,
          otherMetrics: ['Other Metric', 'State Data', 'Another Metric'],
          projectWorkerMap: [{ workerIds: ['worker-1'] }],
        };

        const result = await activity.generateStateDataCsv({
          traceId,
          payload,
        });

        expect(
          prometheusDataProcessor.getPrometheusMetrics,
        ).toHaveBeenCalledWith('2023-01-01', '2023-01-31', ['worker-1']);
        expect(result).toBe('State Data CSV generation completed successfully');
      });
    });

    // Existing test cases (updated with otherMetrics)
    it('should successfully generate CSV with worker IDs from projectWorkerMap', async () => {
      const payload = {
        ...basePayload,
        projectWorkerMap: [
          { workerIds: ['worker-1', 'worker-2'] },
          { workerIds: ['worker-3'] },
        ],
      };

      const result = await activity.generateStateDataCsv({ traceId, payload });

      expect(logger.log).toHaveBeenCalledWith(
        '[test-trace-id] Starting State Data CSV generation',
      );
      expect(logger.log).toHaveBeenCalledWith(
        '[test-trace-id] Worker IDs provided: worker-1, worker-2, worker-3',
      );
      expect(prometheusDataProcessor.getPrometheusMetrics).toHaveBeenCalledWith(
        '2023-01-01',
        '2023-01-31',
        ['worker-1', 'worker-2', 'worker-3'],
      );
      expect(logger.log).toHaveBeenCalledWith(
        '[test-trace-id] Retrieved metrics data',
        {
          servicePods: 2,
          allMetrics: 2,
          buildDetails: 2,
        },
      );
      expect(result).toBe('State Data CSV generation completed successfully');
    });

    it('should handle empty projectWorkerMap', async () => {
      const payload = {
        ...basePayload,
        projectWorkerMap: [],
      };

      await activity.generateStateDataCsv({ traceId, payload });

      expect(logger.log).toHaveBeenCalledWith(
        '[test-trace-id] Worker IDs provided: None',
      );
      expect(prometheusDataProcessor.getPrometheusMetrics).toHaveBeenCalledWith(
        '2023-01-01',
        '2023-01-31',
        [],
      );
    });

    it('should handle projectWorkerMap with invalid workerIds', async () => {
      const payload = {
        ...basePayload,
        projectWorkerMap: [
          { workerIds: ['worker-1'] },
          { workerIds: 'invalid-not-array' }, // Invalid - not an array
          { workerIds: ['worker-2'] },
          { invalidField: 'no-workerIds' }, // Invalid - no workerIds field
        ],
      };

      await activity.generateStateDataCsv({ traceId, payload });

      expect(logger.log).toHaveBeenCalledWith(
        '[test-trace-id] Worker IDs provided: worker-1, worker-2',
      );
      expect(prometheusDataProcessor.getPrometheusMetrics).toHaveBeenCalledWith(
        '2023-01-01',
        '2023-01-31',
        ['worker-1', 'worker-2'],
      );
    });

    it('should handle missing projectWorkerMap', async () => {
      const payload = {
        ...basePayload,
        projectWorkerMap: undefined,
      };

      await activity.generateStateDataCsv({ traceId, payload });

      expect(logger.log).toHaveBeenCalledWith(
        '[test-trace-id] Worker IDs provided: None',
      );
      expect(prometheusDataProcessor.getPrometheusMetrics).toHaveBeenCalledWith(
        '2023-01-01',
        '2023-01-31',
        [],
      );
    });

    it('should generate all CSV files when data is available', async () => {
      const payload = {
        ...basePayload,
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
      };

      const mockTimestamp = 1234567890000;
      jest.spyOn(Date, 'now').mockReturnValue(mockTimestamp);

      await activity.generateStateDataCsv({ traceId, payload });

      expect(csvGenerator.createServicePodsCsvContent).toHaveBeenCalledWith(
        mockPrometheusMetrics.servicePods,
      );
      expect(csvGenerator.createMetricsCsvContent).toHaveBeenCalledWith(
        mockPrometheusMetrics.allMetrics,
      );
      expect(csvGenerator.createBuildDetailsCsvContent).toHaveBeenCalledWith(
        mockPrometheusMetrics.buildDetails,
      );

      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(3);
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'service,pods,csv,content',
        `service_pods_${mockTimestamp}.csv`,
        '/path/to/zip',
      );
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'metrics,csv,content',
        `metrics_data_${mockTimestamp}.csv`,
        '/path/to/zip',
      );
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'build,details,csv,content',
        `build_details_${mockTimestamp}.csv`,
        '/path/to/zip',
      );

      expect(logger.log).toHaveBeenCalledWith(
        `[${traceId}] Service pods CSV created: service_pods_${mockTimestamp}.csv`,
      );
      expect(logger.log).toHaveBeenCalledWith(
        `[${traceId}] Metrics CSV created: metrics_data_${mockTimestamp}.csv`,
      );
      expect(logger.log).toHaveBeenCalledWith(
        `[${traceId}] Build details CSV created: build_details_${mockTimestamp}.csv`,
      );
    });

    it('should handle empty data arrays gracefully', async () => {
      const emptyMetrics: PrometheusMetrics = {
        servicePods: [],
        allMetrics: [],
        buildDetails: [],
      };

      prometheusDataProcessor.getPrometheusMetrics.mockResolvedValue(
        emptyMetrics,
      );

      const payload = {
        ...basePayload,
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
      };

      await activity.generateStateDataCsv({ traceId, payload });

      expect(csvGenerator.createServicePodsCsvContent).not.toHaveBeenCalled();
      expect(csvGenerator.createMetricsCsvContent).not.toHaveBeenCalled();
      expect(csvGenerator.createBuildDetailsCsvContent).not.toHaveBeenCalled();
      expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

      expect(logger.log).toHaveBeenCalledWith(
        '[test-trace-id] Retrieved metrics data',
        {
          servicePods: 0,
          allMetrics: 0,
          buildDetails: 0,
        },
      );
    });

    it('should handle undefined data arrays gracefully', async () => {
      const undefinedMetrics: PrometheusMetrics = {
        servicePods: undefined as any,
        allMetrics: undefined as any,
        buildDetails: undefined as any,
      };

      prometheusDataProcessor.getPrometheusMetrics.mockResolvedValue(
        undefinedMetrics,
      );

      const payload = {
        ...basePayload,
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
      };

      await activity.generateStateDataCsv({ traceId, payload });

      expect(csvGenerator.createServicePodsCsvContent).not.toHaveBeenCalled();
      expect(csvGenerator.createMetricsCsvContent).not.toHaveBeenCalled();
      expect(csvGenerator.createBuildDetailsCsvContent).not.toHaveBeenCalled();
      expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

      expect(logger.log).toHaveBeenCalledWith(
        '[test-trace-id] Retrieved metrics data',
        {
          servicePods: 0,
          allMetrics: 0,
          buildDetails: 0,
        },
      );
    });

    // Error handling tests (updated for new condition)
    it('should handle prometheus service errors when State Data is requested', async () => {
      const error = new Error('Prometheus connection failed');
      prometheusDataProcessor.getPrometheusMetrics.mockRejectedValue(error);

      const payload = {
        ...basePayload,
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
      };

      await expect(
        activity.generateStateDataCsv({ traceId, payload }),
      ).rejects.toThrow('Prometheus connection failed');

      expect(csvGenerator.createServicePodsCsvContent).not.toHaveBeenCalled();
      expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();
    });

    it('should handle zip handler errors and propagate them', async () => {
      const error = new Error('Zip creation failed');
      zipHandler.addCsvToZip.mockRejectedValue(error);

      const payload = {
        ...basePayload,
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
      };

      await expect(
        activity.generateStateDataCsv({ traceId, payload }),
      ).rejects.toThrow('Zip creation failed');

      expect(csvGenerator.createServicePodsCsvContent).toHaveBeenCalled();
    });

    it('should handle single CSV file generation failure', async () => {
      const error = new Error('CSV generation failed');
      csvGenerator.createServicePodsCsvContent.mockImplementation(() => {
        throw error;
      });

      const payload = {
        ...basePayload,
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
      };

      await expect(
        activity.generateStateDataCsv({ traceId, payload }),
      ).rejects.toThrow('CSV generation failed');
    });

    it('should generate partial CSV files when some data is missing', async () => {
      const partialMetrics: PrometheusMetrics = {
        servicePods: mockPrometheusMetrics.servicePods, // Has data
        allMetrics: [], // Empty array
        buildDetails: undefined as any, // Undefined
      };

      prometheusDataProcessor.getPrometheusMetrics.mockResolvedValue(
        partialMetrics,
      );

      const payload = {
        ...basePayload,
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
      };

      const mockTimestamp = 1234567890000;
      jest.spyOn(Date, 'now').mockReturnValue(mockTimestamp);

      await activity.generateStateDataCsv({ traceId, payload });

      // Only service pods CSV should be created
      expect(csvGenerator.createServicePodsCsvContent).toHaveBeenCalledWith(
        partialMetrics.servicePods,
      );
      expect(csvGenerator.createMetricsCsvContent).not.toHaveBeenCalled();
      expect(csvGenerator.createBuildDetailsCsvContent).not.toHaveBeenCalled();

      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(1);
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        'service,pods,csv,content',
        `service_pods_${mockTimestamp}.csv`,
        '/path/to/zip',
      );
    });

    it('should handle duplicate worker IDs', async () => {
      const payload = {
        ...basePayload,
        projectWorkerMap: [
          { workerIds: ['worker-1', 'worker-2'] },
          { workerIds: ['worker-2', 'worker-3'] }, // worker-2 is duplicate
        ],
      };

      await activity.generateStateDataCsv({ traceId, payload });

      expect(prometheusDataProcessor.getPrometheusMetrics).toHaveBeenCalledWith(
        '2023-01-01',
        '2023-01-31',
        ['worker-1', 'worker-2', 'worker-2', 'worker-3'], // Contains duplicates
      );
    });

    it('should handle very large worker ID arrays', async () => {
      const largeWorkerArray = Array.from(
        { length: 1000 },
        (_, i) => `worker-${i}`,
      );
      const payload = {
        ...basePayload,
        projectWorkerMap: [{ workerIds: largeWorkerArray }],
      };

      await activity.generateStateDataCsv({ traceId, payload });

      expect(prometheusDataProcessor.getPrometheusMetrics).toHaveBeenCalledWith(
        '2023-01-01',
        '2023-01-31',
        largeWorkerArray,
      );
    });
  });

  describe('generateCsvFiles (private method)', () => {
    const traceId = 'test-trace-id';
    const zipLocation = '/path/to/zip';
    const mockTimestamp = 1234567890000;

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(mockTimestamp);
    });

    it('should be called with correct parameters', async () => {
      const payload = {
        startDate: '2023-01-01',
        endDate: '2023-01-31',
        zipLocation,
        otherMetrics: ['State Data'],
        projectWorkerMap: [{ workerIds: ['worker-1'] }],
      };

      // Spy on the private method
      const generateCsvFilesSpy = jest.spyOn(
        activity as any,
        'generateCsvFiles',
      );

      await activity.generateStateDataCsv({ traceId, payload });

      expect(generateCsvFilesSpy).toHaveBeenCalledWith(
        traceId,
        mockPrometheusMetrics,
        zipLocation,
      );
    });
  });

  describe('Edge Cases', () => {
    const traceId = 'test-trace-id';

    it('should handle null payload gracefully', async () => {
      const payload = null;

      const result = await activity.generateStateDataCsv({ traceId, payload });

      expect(result).toBe('State Data CSV generation skipped - not requested');
    });

    it('should handle payload with null projectWorkerMap', async () => {
      const payload = {
        startDate: '2023-01-01',
        endDate: '2023-01-31',
        zipLocation: '/path/to/zip',
        otherMetrics: ['State Data'],
        projectWorkerMap: null,
      };

      await activity.generateStateDataCsv({ traceId, payload });

      expect(logger.log).toHaveBeenCalledWith(
        '[test-trace-id] Worker IDs provided: None',
      );
      expect(prometheusDataProcessor.getPrometheusMetrics).toHaveBeenCalledWith(
        '2023-01-01',
        '2023-01-31',
        [],
      );
    });
  });
});
