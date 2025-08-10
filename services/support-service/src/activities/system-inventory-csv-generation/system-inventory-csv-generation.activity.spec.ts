import { Test, TestingModule } from '@nestjs/testing';
import { SystemInventoryCsvGenerationActivity } from './system-inventory-csv-generation.activity';
import { PrometheusClientService } from 'src/prometheus/prometheus-client.service';
import { SystemInventoryProcessorService } from './system-inventory-processor.service';
import { ZipHandlerService } from 'src/services/zip-handler.service';
import { PrometheusResponse } from './system-inventory-csv-generation.interface';
import SYS_INV_SPECS_QUERIES from './system-inventory.constants';

describe('SystemInventoryCsvGenerationActivity', () => {
  let activity: SystemInventoryCsvGenerationActivity;
  let prometheusClient: jest.Mocked<PrometheusClientService>;
  let processorService: jest.Mocked<SystemInventoryProcessorService>;
  let zipHandler: jest.Mocked<ZipHandlerService>;
  let loggerSpy: jest.SpyInstance;

  beforeEach(async () => {
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
        SystemInventoryCsvGenerationActivity,
        {
          provide: PrometheusClientService,
          useValue: mockPrometheusClient,
        },
        {
          provide: SystemInventoryProcessorService,
          useValue: mockProcessorService,
        },
        {
          provide: ZipHandlerService,
          useValue: mockZipHandler,
        },
      ],
    }).compile();

    activity = module.get<SystemInventoryCsvGenerationActivity>(
      SystemInventoryCsvGenerationActivity,
    );
    prometheusClient = module.get(PrometheusClientService);
    processorService = module.get(SystemInventoryProcessorService);
    zipHandler = module.get(ZipHandlerService);

    loggerSpy = jest.spyOn(activity['logger'], 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateSystemInventoryCsv', () => {
    const traceId = 'trace-123';
    const payload = {
      startDate: '2025-08-01T00:00:00Z',
      endDate: '2025-08-01T23:59:59Z',
      zipLocation: '/tmp/test.zip',
      otherMetrics: ['System Inventory Data'],
    };

    it('should successfully generate CSV files for all metrics with data', async () => {
      // Arrange
      const mockPrometheusResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [{ metric: {}, values: [[1234567890, '60']] }],
        },
      };
      const mockProcessedResults = {
        NETWORK_CONFIG: {
          data: [{ instance: 'node1', value: 'eth0' }],
          csvContent: 'Instance,Interface\nnode1,eth0\n',
        },
        DISK_USAGE: {
          data: [{ instance: 'node1', value: '85' }],
          csvContent: 'Instance,Usage%\nnode1,85\n',
        },
        RUNNING_PROCESSES: {
          data: [{ instance: 'node1', value: '100' }],
          csvContent: 'Instance,Processes\nnode1,100\n',
        },
        SYSTEM_SPECS: {
          data: [{ instance: 'node1', value: '8' }],
          csvContent: 'Instance,Specs\nnode1,8\n',
        },
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        mockProcessedResults,
      );
      zipHandler.addCsvToZip.mockResolvedValue(undefined);

      // Act
      const result = await activity.generateSystemInventoryCsv({
        traceId,
        payload,
      });

      // Assert
      expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(
        Object.keys(SYS_INV_SPECS_QUERIES).length,
      );
      expect(processorService.processBatchMetrics).toHaveBeenCalledTimes(1);
      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(4);
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockProcessedResults.NETWORK_CONFIG.csvContent,
        expect.stringContaining('system-inventory-network-config'),
        payload.zipLocation,
        'System Inventory',
      );
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockProcessedResults.DISK_USAGE.csvContent,
        expect.stringContaining('system-inventory-disk-usage'),
        payload.zipLocation,
        'System Inventory',
      );
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockProcessedResults.RUNNING_PROCESSES.csvContent,
        expect.stringContaining('system-inventory-running-processes'),
        payload.zipLocation,
        'System Inventory',
      );
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockProcessedResults.SYSTEM_SPECS.csvContent,
        expect.stringContaining('system-inventory-system-metrics'),
        payload.zipLocation,
        'System Inventory',
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `[${traceId}] Starting System Inventory CSV generation`,
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `[${traceId}] System Inventory CSV generation completed successfully`,
      );
      expect(result).toBe(
        'System Inventory CSV generation completed successfully',
      );
    });

    it('should handle partial success when some metrics fail', async () => {
      // Arrange
      const mockSuccessResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [{ metric: {}, values: [[1234567890, '60']] }],
        },
      };
      const mockError = new Error('Prometheus connection failed');

      prometheusClient.callPrometheusApi
        .mockResolvedValueOnce(mockSuccessResponse) // First metric succeeds
        .mockRejectedValueOnce(mockError) // Second metric fails
        .mockResolvedValueOnce(mockSuccessResponse) // Third metric succeeds
        .mockRejectedValueOnce(mockError) // Fourth metric fails
        .mockResolvedValueOnce(mockSuccessResponse) // Fifth metric succeeds
        .mockRejectedValueOnce(mockError); // Sixth metric fails

      const mockProcessedResults = {
        NETWORK_CONFIG: {
          data: [{ instance: 'node1', value: 'eth0' }],
          csvContent: 'Instance,Interface\nnode1,eth0\n',
        },
      };

      processorService.processBatchMetrics.mockResolvedValue(
        mockProcessedResults,
      );
      const warnSpy = jest
        .spyOn(activity['logger'], 'warn')
        .mockImplementation();

      // Act
      const result = await activity.generateSystemInventoryCsv({
        traceId,
        payload,
      });

      // Assert
      expect(warnSpy).toHaveBeenCalledTimes(3);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch'),
      );
      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(1);
      expect(result).toBe(
        'System Inventory CSV generation completed successfully',
      );
    });

    it('should not create CSV files when no data is available', async () => {
      // Arrange
      const mockPrometheusResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [],
        },
      };
      const mockProcessedResults = {
        NETWORK_CONFIG: { data: [], csvContent: '' },
        DISK_USAGE: { data: [], csvContent: '' },
        RUNNING_PROCESSES: { data: [], csvContent: '' },
        SYSTEM_SPECS: { data: [], csvContent: '' },
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        mockProcessedResults,
      );

      // Act
      const result = await activity.generateSystemInventoryCsv({
        traceId,
        payload,
      });

      // Assert
      expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();
      expect(result).toBe(
        'System Inventory CSV generation completed successfully',
      );
    });

    it('should only create CSV files for metrics with data', async () => {
      // Arrange
      const mockPrometheusResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [{ metric: {}, values: [[1234567890, '60']] }],
        },
      };
      const mockProcessedResults = {
        NETWORK_CONFIG: {
          data: [{ instance: 'node1', value: 'eth0' }],
          csvContent: 'Instance,Interface\nnode1,eth0\n',
        },
        DISK_USAGE: { data: [], csvContent: '' }, // No data
        RUNNING_PROCESSES: {
          data: [{ instance: 'node1', value: '100' }],
          csvContent: 'Instance,Processes\nnode1,100\n',
        },
        SYSTEM_SPECS: { data: [], csvContent: '' }, // No data
      };

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        mockProcessedResults,
      );

      // Act
      await activity.generateSystemInventoryCsv({ traceId, payload });

      // Assert
      expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(2);
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockProcessedResults.NETWORK_CONFIG.csvContent,
        expect.stringContaining('system-inventory-network-config'),
        payload.zipLocation,
        'System Inventory',
      );
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockProcessedResults.RUNNING_PROCESSES.csvContent,
        expect.stringContaining('system-inventory-running-processes'),
        payload.zipLocation,
        'System Inventory',
      );
    });

    it('should generate unique filenames with timestamps', async () => {
      // Arrange
      const mockPrometheusResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [{ metric: {}, values: [[1234567890, '60']] }],
        },
      };
      const mockProcessedResults = {
        NETWORK_CONFIG: {
          data: [{ instance: 'node1', value: 'eth0' }],
          csvContent: 'Instance,Interface\nnode1,eth0\n',
        },
      };

      const mockTimestamp = 1691539200000;
      jest.spyOn(Date, 'now').mockReturnValue(mockTimestamp);

      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue(
        mockProcessedResults,
      );

      // Act
      await activity.generateSystemInventoryCsv({ traceId, payload });

      // Assert
      expect(zipHandler.addCsvToZip).toHaveBeenCalledWith(
        mockProcessedResults.NETWORK_CONFIG.csvContent,
        `system-inventory-network-config-${mockTimestamp}.csv`,
        payload.zipLocation,
        'System Inventory',
      );
    });

    it('should call Prometheus API with correct parameters', async () => {
      // Arrange
      const mockPrometheusResponse: PrometheusResponse = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [],
        },
      };
      prometheusClient.callPrometheusApi.mockResolvedValue(
        mockPrometheusResponse,
      );
      processorService.processBatchMetrics.mockResolvedValue({});

      // Act
      await activity.generateSystemInventoryCsv({ traceId, payload });

      // Assert
      const queries = Object.entries(SYS_INV_SPECS_QUERIES);
      expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(
        queries.length,
      );

      queries.forEach(([metric, queryConfig], index) => {
        expect(prometheusClient.callPrometheusApi).toHaveBeenNthCalledWith(
          index + 1,
          queryConfig.query,
          payload.startDate,
          payload.endDate,
          queryConfig.step,
        );
      });
    });

    describe('otherMetrics validation', () => {
      const basePayload = {
        startDate: '2025-08-01T00:00:00Z',
        endDate: '2025-08-01T23:59:59Z',
        zipLocation: '/tmp/test.zip',
      };

      it('should skip processing when System Inventory Data is not in otherMetrics array', async () => {
        const payloadWithoutSystemInventory = {
          ...basePayload,
          otherMetrics: ['Other Metric', 'Another Metric'], // Doesn't include 'System Inventory Data'
        };

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithoutSystemInventory,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory Data CSV generation skipped - not requested',
        );
      });

      it('should skip processing when otherMetrics is empty array', async () => {
        const payloadWithEmptyArray = {
          ...basePayload,
          otherMetrics: [], // Empty array
        };

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithEmptyArray,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory Data CSV generation skipped - not requested',
        );
      });

      it('should skip processing when otherMetrics is undefined', async () => {
        const payloadWithUndefinedOtherMetrics = {
          ...basePayload,
          otherMetrics: undefined, // Undefined
        };

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithUndefinedOtherMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory Data CSV generation skipped - not requested',
        );
      });

      it('should skip processing when otherMetrics property is missing', async () => {
        const payloadWithoutOtherMetrics = {
          startDate: '2025-08-01T00:00:00Z',
          endDate: '2025-08-01T23:59:59Z',
          zipLocation: '/tmp/test.zip',
          // No otherMetrics property
        };

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithoutOtherMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory Data CSV generation skipped - not requested',
        );
      });

      it('should process when System Inventory Data is included in otherMetrics array', async () => {
        const payloadWithSystemInventory = {
          ...basePayload,
          otherMetrics: [
            'Other Metric',
            'System Inventory Data',
            'Another Metric',
          ], // Includes 'System Inventory Data'
        };

        const mockPrometheusResponse: PrometheusResponse = {
          status: 'success',
          data: {
            resultType: 'matrix',
            result: [{ metric: {}, values: [[1234567890, '60']] }],
          },
        };
        const mockProcessedResults = {
          NETWORK_CONFIG: {
            data: [{ instance: 'node1', value: 'eth0' }],
            csvContent: 'Instance,Interface\nnode1,eth0\n',
          },
        };

        prometheusClient.callPrometheusApi.mockResolvedValue(
          mockPrometheusResponse,
        );
        processorService.processBatchMetrics.mockResolvedValue(
          mockProcessedResults,
        );
        zipHandler.addCsvToZip.mockResolvedValue(undefined);

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithSystemInventory,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] Starting System Inventory CSV generation`,
        );
        expect(loggerSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('skipping'),
        );

        expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(
          Object.keys(SYS_INV_SPECS_QUERIES).length,
        );
        expect(processorService.processBatchMetrics).toHaveBeenCalledTimes(1);
        expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(1);

        expect(result).toBe(
          'System Inventory CSV generation completed successfully',
        );
      });

      it('should be case sensitive when checking for System Inventory Data', async () => {
        const payloadWithWrongCase = {
          ...basePayload,
          otherMetrics: [
            'system inventory data',
            'SYSTEM INVENTORY DATA',
            'System inventory data',
          ], // Wrong cases
        };

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithWrongCase,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory Data CSV generation skipped - not requested',
        );
      });

      it('should skip when otherMetrics is null', async () => {
        const payloadWithNullOtherMetrics = {
          ...basePayload,
          otherMetrics: null, // Null
        };

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithNullOtherMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory Data CSV generation skipped - not requested',
        );
      });

      it('should process when otherMetrics is a string containing System Inventory Data', async () => {
        const payloadWithStringOtherMetrics = {
          ...basePayload,
          otherMetrics: 'System Inventory Data', // String - should work since strings have includes method
        };

        const mockPrometheusResponse: PrometheusResponse = {
          status: 'success',
          data: {
            resultType: 'matrix',
            result: [{ metric: {}, values: [[1234567890, '60']] }],
          },
        };
        const mockProcessedResults = {
          NETWORK_CONFIG: {
            data: [{ instance: 'node1', value: 'eth0' }],
            csvContent: 'Instance,Interface\nnode1,eth0\n',
          },
        };

        prometheusClient.callPrometheusApi.mockResolvedValue(
          mockPrometheusResponse,
        );
        processorService.processBatchMetrics.mockResolvedValue(
          mockProcessedResults,
        );
        zipHandler.addCsvToZip.mockResolvedValue(undefined);

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithStringOtherMetrics,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] Starting System Inventory CSV generation`,
        );

        expect(prometheusClient.callPrometheusApi).toHaveBeenCalled();
        expect(processorService.processBatchMetrics).toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory CSV generation completed successfully',
        );
      });

      it('should skip when otherMetrics string does not contain System Inventory Data', async () => {
        const payloadWithWrongString = {
          ...basePayload,
          otherMetrics: 'Other Metrics Only', // String without 'System Inventory Data'
        };

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithWrongString,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory Data CSV generation skipped - not requested',
        );
      });

      it('should skip when otherMetrics is a partial match string', async () => {
        const payloadWithPartialMatch = {
          ...basePayload,
          otherMetrics: 'System Inventory', // Partial match - should not work
        };

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithPartialMatch,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory Data CSV generation skipped - not requested',
        );
      });

      it('should handle payload being null when checking otherMetrics', async () => {
        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: null,
        });

        expect(loggerSpy).toHaveBeenCalledWith(
          `[${traceId}] System Inventory Data not requested in otherMetrics, skipping`,
        );

        expect(prometheusClient.callPrometheusApi).not.toHaveBeenCalled();
        expect(processorService.processBatchMetrics).not.toHaveBeenCalled();
        expect(zipHandler.addCsvToZip).not.toHaveBeenCalled();

        expect(result).toBe(
          'System Inventory Data CSV generation skipped - not requested',
        );
      });

      it('should proceed when otherMetrics contains only System Inventory Data', async () => {
        const payloadWithOnlySystemInventory = {
          ...basePayload,
          otherMetrics: ['System Inventory Data'], // Only System Inventory Data
        };

        const mockPrometheusResponse: PrometheusResponse = {
          status: 'success',
          data: {
            resultType: 'matrix',
            result: [{ metric: {}, values: [[1234567890, '60']] }],
          },
        };
        const mockProcessedResults = {
          NETWORK_CONFIG: {
            data: [{ instance: 'node1', value: 'eth0' }],
            csvContent: 'Instance,Interface\nnode1,eth0\n',
          },
        };

        prometheusClient.callPrometheusApi.mockResolvedValue(
          mockPrometheusResponse,
        );
        processorService.processBatchMetrics.mockResolvedValue(
          mockProcessedResults,
        );
        zipHandler.addCsvToZip.mockResolvedValue(undefined);

        const result = await activity.generateSystemInventoryCsv({
          traceId,
          payload: payloadWithOnlySystemInventory,
        });

        expect(loggerSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('skipping'),
        );

        expect(prometheusClient.callPrometheusApi).toHaveBeenCalledTimes(
          Object.keys(SYS_INV_SPECS_QUERIES).length,
        );
        expect(processorService.processBatchMetrics).toHaveBeenCalledTimes(1);
        expect(zipHandler.addCsvToZip).toHaveBeenCalledTimes(1);

        expect(result).toBe(
          'System Inventory CSV generation completed successfully',
        );
      });
    });
  });

  describe('extractSuccessfulResults', () => {
    it('should extract successful results and log warnings for failures', () => {
      // Arrange
      const successfulResult = {
        status: 'fulfilled',
        value: { metric: 'CPU_CORES', response: { data: 'test' } },
      };
      const failedResult = {
        status: 'rejected',
        reason: new Error('Test error'),
      };
      const results = [successfulResult, failedResult];
      const warnSpy = jest
        .spyOn(activity['logger'], 'warn')
        .mockImplementation();

      // Act
      const extracted = activity['extractSuccessfulResults'](results);

      // Assert
      expect(extracted).toHaveLength(2);
      expect(extracted[0]).toBe(successfulResult.value);
      expect(extracted[1]).toBe(null);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch'),
      );
    });
  });
});
