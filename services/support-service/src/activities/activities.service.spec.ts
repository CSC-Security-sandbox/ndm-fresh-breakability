/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable prettier/prettier */

import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesService } from './activities.service';

// Mock all activity classes to avoid entity import issues
jest.mock('./log-generator/log-generator.activity', () => ({
  LogGeneratorActivity: jest.fn().mockImplementation(() => ({
    fetchAndZipLogs: jest.fn(),
  })),
}));

jest.mock('./notify-config/notify-config.activity', () => ({
  NotifyConfigActivity: jest.fn().mockImplementation(() => ({
    notifyWorkflowCompletion: jest.fn(),
  })),
}));

jest.mock('./error-csv-generation/error-csv-generation.activity', () => ({
  ErrorCsvGenerationActivity: jest.fn().mockImplementation(() => ({
    generateErrorCsv: jest.fn(),
  })),
}));

jest.mock(
  './config-data-csv-generation/config-data-csv-generation.activity',
  () => ({
    ConfigurationDataCsvGenerationActivity: jest
      .fn()
      .mockImplementation(() => ({
        generateConfigurationDataCsv: jest.fn(),
        generateConfigurationJobCsv: jest.fn(),
      })),
  }),
);

jest.mock(
  './state-data-csv-generation/state-data-csv-generation.activity',
  () => ({
    StateDataCsvGenerationActivity: jest.fn().mockImplementation(() => ({
      generateStateDataCsv: jest.fn(),
    })),
  }),
);

jest.mock(
  './config-data-csv-generation/config-data-csv-generation.activity',
  () => ({
    ConfigurationDataCsvGenerationActivity: jest
      .fn()
      .mockImplementation(() => ({
        generateConfigurationDataCsv: jest.fn(),
        generateConfigurationJobCsv: jest.fn(),
      })),
  }),
);

jest.mock(
  './system-inventory-csv-generation/system-inventory-csv-generation.activity',
  () => ({
    SystemInventoryCsvGenerationActivity: jest.fn().mockImplementation(() => ({
      generateSystemInventoryCsv: jest.fn(),
    })),
  }),
);

import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { NotifyConfigActivity } from './notify-config/notify-config.activity';
import { ErrorCsvGenerationActivity } from './error-csv-generation/error-csv-generation.activity';
import { ConfigurationDataCsvGenerationActivity } from './config-data-csv-generation/config-data-csv-generation.activity';
import { StateDataCsvGenerationActivity } from './state-data-csv-generation/state-data-csv-generation.activity';
import { SystemInventoryCsvGenerationActivity } from './system-inventory-csv-generation/system-inventory-csv-generation.activity';
import { PerformanceMetricsCsvGenerationActivity } from './performance-metrics-csv-generation/performance-metrics-csv-generation.activity';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let logGeneratorActivity: any;
  let notifyConfigActivity: any;
  let errorCsvGenerationActivity: any;
  let configurationDataCsvGenerationActivity: any;
  let stateDataCsvGenerationActivity: any;
  let systemInventoryCsvGenerationActivity: any;
  let performanceMetricsCsvGenerationActivity: any;

  beforeEach(async () => {
    // Create mock instances with proper Jest mock functions
    logGeneratorActivity = {
      fetchAndZipLogs: jest.fn(),
    };

    notifyConfigActivity = {
      notifyWorkflowCompletion: jest.fn(),
    };

    errorCsvGenerationActivity = {
      generateErrorCsv: jest.fn(),
    };

    configurationDataCsvGenerationActivity = {
      generateConfigurationDataCsv: jest.fn(),
      generateConfigurationJobCsv: jest.fn(),
    };

    stateDataCsvGenerationActivity = {
      generateStateDataCsv: jest.fn(),
    };

    systemInventoryCsvGenerationActivity = {
      generateSystemInventoryCsv: jest.fn(),
    performanceMetricsCsvGenerationActivity = {
      generatePerformanceMetricsCsv: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        {
          provide: LogGeneratorActivity,
          useValue: logGeneratorActivity,
        },
        {
          provide: NotifyConfigActivity,
          useValue: notifyConfigActivity,
        },
        {
          provide: ErrorCsvGenerationActivity,
          useValue: errorCsvGenerationActivity,
        },
        {
          provide: ConfigurationDataCsvGenerationActivity,
          useValue: configurationDataCsvGenerationActivity,
        },
        {
          provide: StateDataCsvGenerationActivity,
          useValue: stateDataCsvGenerationActivity,
        },
        {
          provide: SystemInventoryCsvGenerationActivity,
          useValue: systemInventoryCsvGenerationActivity,
          provide: PerformanceMetricsCsvGenerationActivity,
          useValue: performanceMetricsCsvGenerationActivity,
        },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have all required dependencies injected', () => {
    expect(service['logGeneratorActivity']).toBeDefined();
    expect(service['notifyConfigActivity']).toBeDefined();
    expect(service['errorCsvGenerationActivity']).toBeDefined();
  });

  describe('fetchAndZipLogs', () => {
    it('should successfully fetch and zip logs with valid inputs', async () => {
      // Arrange
      const traceId = 'test-trace-id-123';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      const expectedResult = '/test/output/ndm_test-user.zip';
      logGeneratorActivity.fetchAndZipLogs.mockResolvedValue(expectedResult);

      // Act
      const result = await service.fetchAndZipLogs({ traceId, payload });

      // Assert
      expect(result).toBe(expectedResult);
      expect(logGeneratorActivity.fetchAndZipLogs).toHaveBeenCalledTimes(1);
      expect(logGeneratorActivity.fetchAndZipLogs).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });

    it('should handle errors when fetching and zipping logs', async () => {
      // Arrange
      const traceId = 'test-trace-id-error';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      const mockError = new Error('Failed to fetch logs');
      logGeneratorActivity.fetchAndZipLogs.mockRejectedValue(mockError);

      // Act & Assert
      await expect(
        service.fetchAndZipLogs({ traceId, payload }),
      ).rejects.toThrow('Failed to fetch logs');
      expect(logGeneratorActivity.fetchAndZipLogs).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });

    it('should pass through null traceId', async () => {
      // Arrange
      const traceId = null;
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      const expectedResult = '/test/output/ndm_test-user.zip';
      logGeneratorActivity.fetchAndZipLogs.mockResolvedValue(expectedResult);

      // Act
      const result = await service.fetchAndZipLogs({ traceId, payload });

      // Assert
      expect(result).toBe(expectedResult);
      expect(logGeneratorActivity.fetchAndZipLogs).toHaveBeenCalledWith({
        traceId: null,
        payload,
      });
    });

    it('should pass through undefined payload', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const payload = undefined;
      logGeneratorActivity.fetchAndZipLogs.mockRejectedValue(
        new Error('Missing payload'),
      );

      // Act & Assert
      await expect(
        service.fetchAndZipLogs({ traceId, payload }),
      ).rejects.toThrow('Missing payload');
      expect(logGeneratorActivity.fetchAndZipLogs).toHaveBeenCalledWith({
        traceId,
        payload: undefined,
      });
    });

    it('should handle promise rejection with non-Error objects', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      logGeneratorActivity.fetchAndZipLogs.mockRejectedValue('String error');

      // Act & Assert
      await expect(service.fetchAndZipLogs({ traceId, payload })).rejects.toBe(
        'String error',
      );
    });
  });

  describe('generateErrorCsv', () => {
    it('should successfully generate error CSV with valid inputs', async () => {
      // Arrange
      const traceId = 'test-trace-id-csv';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/ndm_test-user.zip',
      };
      const expectedResult = {
        success: true,
        message: 'CSV generation completed',
        filesCreated: 2,
      };
      errorCsvGenerationActivity.generateErrorCsv.mockResolvedValue(
        expectedResult,
      );

      // Act
      const result = await service.generateErrorCsv({ traceId, payload });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(errorCsvGenerationActivity.generateErrorCsv).toHaveBeenCalledTimes(
        1,
      );
      expect(errorCsvGenerationActivity.generateErrorCsv).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });

    it('should handle errors when generating error CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id-csv-error';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/ndm_test-user.zip',
      };
      const mockError = new Error('Error CSV generation failed');
      errorCsvGenerationActivity.generateErrorCsv.mockRejectedValue(mockError);

      // Act & Assert
      await expect(
        service.generateErrorCsv({ traceId, payload }),
      ).rejects.toThrow('Error CSV generation failed');
      expect(errorCsvGenerationActivity.generateErrorCsv).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });

    it('should pass through null traceId for CSV generation', async () => {
      // Arrange
      const traceId = null;
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/ndm_test-user.zip',
      };
      const expectedResult = { success: true };
      errorCsvGenerationActivity.generateErrorCsv.mockResolvedValue(
        expectedResult,
      );

      // Act
      const result = await service.generateErrorCsv({ traceId, payload });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(errorCsvGenerationActivity.generateErrorCsv).toHaveBeenCalledWith({
        traceId: null,
        payload,
      });
    });

    it('should handle undefined payload for CSV generation', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const payload = undefined;
      errorCsvGenerationActivity.generateErrorCsv.mockRejectedValue(
        new Error('Missing payload'),
      );

      // Act & Assert
      await expect(
        service.generateErrorCsv({ traceId, payload }),
      ).rejects.toThrow('Missing payload');
      expect(errorCsvGenerationActivity.generateErrorCsv).toHaveBeenCalledWith({
        traceId,
        payload: undefined,
      });
    });

    it('should handle promise rejection with custom error objects', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/ndm_test-user.zip',
      };
      const customError = { code: 'CSV_ERROR', message: 'Custom CSV error' };
      errorCsvGenerationActivity.generateErrorCsv.mockRejectedValue(
        customError,
      );

      // Act & Assert
      await expect(
        service.generateErrorCsv({ traceId, payload }),
      ).rejects.toEqual(customError);
    });
  });

  describe('generateConfigurationDataCsv', () => {
    it('should successfully generate configuration data CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id-config';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/config_data.zip',
      };
      const expectedResult = { success: true, fileName: 'config_data.csv' };
      configurationDataCsvGenerationActivity.generateConfigurationDataCsv.mockResolvedValue(
        expectedResult,
      );

      // Act
      const result = await service.generateConfigurationDataCsv({
        traceId,
        payload,
      });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationDataCsv,
      ).toHaveBeenCalledTimes(1);
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationDataCsv,
      ).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });

    it('should handle errors when generating configuration data CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id-config';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/config_data.zip',
      };
      const mockError = new Error('Configuration data generation failed');
      configurationDataCsvGenerationActivity.generateConfigurationDataCsv.mockRejectedValue(
        mockError,
      );

      // Act & Assert
      await expect(
        service.generateConfigurationDataCsv({ traceId, payload }),
      ).rejects.toThrow('Configuration data generation failed');
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationDataCsv,
      ).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });
  });

  describe('generateStateDataCsv', () => {
    it('should successfully generate state data CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id-state';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/state_data.zip',
      };
      const expectedResult = { success: true, fileName: 'state_data.csv' };
      stateDataCsvGenerationActivity.generateStateDataCsv.mockResolvedValue(
        expectedResult,
      );

      // Act
      const result = await service.generateStateDataCsv({ traceId, payload });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(
        stateDataCsvGenerationActivity.generateStateDataCsv,
      ).toHaveBeenCalledTimes(1);
      expect(
        stateDataCsvGenerationActivity.generateStateDataCsv,
      ).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });

    it('should handle errors when generating state data CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id-state';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/state_data.zip',
      };
      const mockError = new Error('State data generation failed');
      stateDataCsvGenerationActivity.generateStateDataCsv.mockRejectedValue(
        mockError,
      );

      // Act & Assert
      await expect(
        service.generateStateDataCsv({ traceId, payload }),
      ).rejects.toThrow('State data generation failed');
      expect(
        stateDataCsvGenerationActivity.generateStateDataCsv,
      ).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });
  });

  describe('generateConfigurationJobCsv', () => {
    it('should successfully generate configuration job CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id-job';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/job_config.zip',
      };
      const expectedResult = { success: true, fileName: 'job_config.csv' };
      configurationDataCsvGenerationActivity.generateConfigurationJobCsv.mockResolvedValue(
        expectedResult,
      );

      // Act
      const result = await service.generateConfigurationJobCsv({
        traceId,
        payload,
      });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationJobCsv,
      ).toHaveBeenCalledTimes(1);
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationJobCsv,
      ).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });

    it('should handle errors when generating configuration job CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id-job';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        zipPath: '/test/output/job_config.zip',
      };
      const mockError = new Error('Job configuration generation failed');
      configurationDataCsvGenerationActivity.generateConfigurationJobCsv.mockRejectedValue(
        mockError,
      );

      // Act & Assert
      await expect(
        service.generateConfigurationJobCsv({ traceId, payload }),
      ).rejects.toThrow('Job configuration generation failed');
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationJobCsv,
      ).toHaveBeenCalledWith({
        traceId,
        payload,
      });
    });
  });

  describe('notifyWorkflowCompletion', () => {
    it('should successfully notify workflow completion with success status', async () => {
      // Arrange
      const traceId = 'test-trace-id-notify';
      const status = 'completed';
      const errorMessage = null;
      notifyConfigActivity.notifyWorkflowCompletion.mockResolvedValue(
        undefined,
      );

      // Act
      const result = await service.notifyWorkflowCompletion({
        traceId,
        status,
        errorMessage,
      });

      // Assert
      expect(result).toBeUndefined();
      expect(
        notifyConfigActivity.notifyWorkflowCompletion,
      ).toHaveBeenCalledTimes(1);
      expect(
        notifyConfigActivity.notifyWorkflowCompletion,
      ).toHaveBeenCalledWith({ traceId, status, errorMessage });
    });

    it('should successfully notify workflow completion with failure status', async () => {
      // Arrange
      const traceId = 'test-trace-id-notify-fail';
      const status = 'failed';
      const errorMessage = 'Workflow failed due to invalid input';
      notifyConfigActivity.notifyWorkflowCompletion.mockResolvedValue({
        success: true,
      });

      // Act
      const result = await service.notifyWorkflowCompletion({
        traceId,
        status,
        errorMessage,
      });

      // Assert
      expect(result).toEqual({ success: true });
      expect(
        notifyConfigActivity.notifyWorkflowCompletion,
      ).toHaveBeenCalledWith({ traceId, status, errorMessage });
    });

    it('should handle errors when notifying workflow completion', async () => {
      // Arrange
      const traceId = 'test-trace-id-notify-error';
      const status = 'failed';
      const errorMessage = 'Workflow failed';
      const mockError = new Error('Notification failed');
      notifyConfigActivity.notifyWorkflowCompletion.mockRejectedValue(
        mockError,
      );

      // Act & Assert
      await expect(
        service.notifyWorkflowCompletion({ traceId, status, errorMessage }),
      ).rejects.toThrow('Notification failed');
      expect(
        notifyConfigActivity.notifyWorkflowCompletion,
      ).toHaveBeenCalledWith({ traceId, status, errorMessage });
    });

    it('should pass through null values for notification', async () => {
      // Arrange
      const traceId = null;
      const status = null;
      const errorMessage = null;
      notifyConfigActivity.notifyWorkflowCompletion.mockResolvedValue(
        undefined,
      );

      // Act
      const result = await service.notifyWorkflowCompletion({
        traceId,
        status,
        errorMessage,
      });

      // Assert
      expect(result).toBeUndefined();
      expect(
        notifyConfigActivity.notifyWorkflowCompletion,
      ).toHaveBeenCalledWith({
        traceId: null,
        status: null,
        errorMessage: null,
      });
    });

    it('should handle undefined parameters for notification', async () => {
      // Arrange
      const traceId = undefined;
      const status = undefined;
      const errorMessage = undefined;
      notifyConfigActivity.notifyWorkflowCompletion.mockResolvedValue(
        undefined,
      );

      // Act
      const result = await service.notifyWorkflowCompletion({
        traceId,
        status,
        errorMessage,
      });

      // Assert
      expect(result).toBeUndefined();
      expect(
        notifyConfigActivity.notifyWorkflowCompletion,
      ).toHaveBeenCalledWith({
        traceId: undefined,
        status: undefined,
        errorMessage: undefined,
      });
    });

    it('should handle complex error message objects', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const status = 'failed';
      const errorMessage = {
        error: 'Complex error',
        details: { code: 500, message: 'Internal error' },
      };
      notifyConfigActivity.notifyWorkflowCompletion.mockResolvedValue(
        undefined,
      );

      // Act
      const result = await service.notifyWorkflowCompletion({
        traceId,
        status,
        errorMessage,
      });

      // Assert
      expect(result).toBeUndefined();
      expect(
        notifyConfigActivity.notifyWorkflowCompletion,
      ).toHaveBeenCalledWith({ traceId, status, errorMessage });
    });

    it('should handle promise rejection with network timeout error', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const status = 'completed';
      const errorMessage = null;
      const timeoutError = new Error('Network timeout');
      timeoutError.name = 'TimeoutError';
      notifyConfigActivity.notifyWorkflowCompletion.mockRejectedValue(
        timeoutError,
      );

      // Act & Assert
      await expect(
        service.notifyWorkflowCompletion({ traceId, status, errorMessage }),
      ).rejects.toThrow('Network timeout');
      expect(
        notifyConfigActivity.notifyWorkflowCompletion,
      ).toHaveBeenCalledWith({ traceId, status, errorMessage });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle method calls with missing parameters', async () => {
      // Test fetchAndZipLogs with missing parameters
      logGeneratorActivity.fetchAndZipLogs.mockRejectedValue(
        new Error('Invalid input'),
      );
      await expect(
        service.fetchAndZipLogs({ traceId: undefined, payload: undefined }),
      ).rejects.toThrow('Invalid input');

      // Test generateErrorCsv with missing parameters
      errorCsvGenerationActivity.generateErrorCsv.mockRejectedValue(
        new Error('Invalid input'),
      );
      await expect(
        service.generateErrorCsv({ traceId: undefined, payload: undefined }),
      ).rejects.toThrow('Invalid input');

      // Test notifyWorkflowCompletion with missing parameters
      notifyConfigActivity.notifyWorkflowCompletion.mockRejectedValue(
        new Error('Invalid input'),
      );
      await expect(
        service.notifyWorkflowCompletion({
          traceId: undefined,
          status: undefined,
          errorMessage: undefined,
        }),
      ).rejects.toThrow('Invalid input');
    });

    it('should handle concurrent method calls', async () => {
      // Arrange
      const traceId1 = 'trace-1';
      const traceId2 = 'trace-2';
      const payload1 = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'user1',
      };
      const payload2 = {
        startDate: '2025-08-01',
        endDate: '2025-08-02',
        userId: 'user2',
      };

      logGeneratorActivity.fetchAndZipLogs.mockImplementation(({ traceId }) =>
        Promise.resolve(`/test/output/ndm_${traceId}.zip`),
      );

      // Act
      const [result1, result2] = await Promise.all([
        service.fetchAndZipLogs({ traceId: traceId1, payload: payload1 }),
        service.fetchAndZipLogs({ traceId: traceId2, payload: payload2 }),
      ]);

      // Assert
      expect(result1).toBe('/test/output/ndm_trace-1.zip');
      expect(result2).toBe('/test/output/ndm_trace-2.zip');
      expect(logGeneratorActivity.fetchAndZipLogs).toHaveBeenCalledTimes(2);
    });

    it('should maintain method isolation - errors in one method should not affect others', async () => {
      // Arrange
      logGeneratorActivity.fetchAndZipLogs.mockRejectedValue(
        new Error('Zip failed'),
      );
      errorCsvGenerationActivity.generateErrorCsv.mockResolvedValue({
        success: true,
      });
      notifyConfigActivity.notifyWorkflowCompletion.mockResolvedValue(
        undefined,
      );

      // Act & Assert
      await expect(
        service.fetchAndZipLogs({ traceId: 'test', payload: {} }),
      ).rejects.toThrow('Zip failed');

      const csvResult = await service.generateErrorCsv({
        traceId: 'test',
        payload: {},
      });
      expect(csvResult).toEqual({ success: true });

      const notifyResult = await service.notifyWorkflowCompletion({
        traceId: 'test',
        status: 'completed',
        errorMessage: null,
      });
      expect(notifyResult).toBeUndefined();
    });
  });

  describe('generateSystemInventoryCsv', () => {
    it('should successfully generate system inventory CSV with valid inputs', async () => {
      // Arrange
      const traceId = 'test-trace-id-123';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      const expectedResult = {
        success: true,
        filePath: '/test/output/system-inventory.csv',
      };
      systemInventoryCsvGenerationActivity.generateSystemInventoryCsv.mockResolvedValue(
        expectedResult,
      );

      // Act
      const result = await service.generateSystemInventoryCsv({
        traceId,
        payload,
      });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(
        systemInventoryCsvGenerationActivity.generateSystemInventoryCsv,
      ).toHaveBeenCalledTimes(1);
      expect(
        systemInventoryCsvGenerationActivity.generateSystemInventoryCsv,
      ).toHaveBeenCalledWith({ traceId, payload });
    });

    it('should handle errors when generating system inventory CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id-error';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      const mockError = new Error('Failed to generate system inventory CSV');
      systemInventoryCsvGenerationActivity.generateSystemInventoryCsv.mockRejectedValue(
        mockError,
      );

      // Act & Assert
      await expect(
        service.generateSystemInventoryCsv({ traceId, payload }),
      ).rejects.toThrow('Failed to generate system inventory CSV');
      expect(
        systemInventoryCsvGenerationActivity.generateSystemInventoryCsv,
      ).toHaveBeenCalledWith({ traceId, payload });
    });

    it('should pass through null traceId for system inventory CSV', async () => {
      // Arrange
      const traceId = null;
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      const expectedResult = { success: true };
      systemInventoryCsvGenerationActivity.generateSystemInventoryCsv.mockResolvedValue(
        expectedResult,
      );

      // Act
      const result = await service.generateSystemInventoryCsv({
        traceId,
        payload,
      });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(
        systemInventoryCsvGenerationActivity.generateSystemInventoryCsv,
      ).toHaveBeenCalledWith({ traceId: null, payload });
    });
  });

  describe('generateConfigurationJobCsv', () => {
    it('should successfully generate configuration job CSV with valid inputs', async () => {
      // Arrange
      const traceId = 'test-trace-id-123';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      const expectedResult = {
        success: true,
        filePath: '/test/output/job-config.csv',
      };
      configurationDataCsvGenerationActivity.generateConfigurationJobCsv.mockResolvedValue(
        expectedResult,
      );

      // Act
      const result = await service.generateConfigurationJobCsv({
        traceId,
        payload,
      });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationJobCsv,
      ).toHaveBeenCalledTimes(1);
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationJobCsv,
      ).toHaveBeenCalledWith({ traceId, payload });
    });

    it('should handle errors when generating configuration job CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id-error';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      const mockError = new Error('Failed to generate configuration job CSV');
      configurationDataCsvGenerationActivity.generateConfigurationJobCsv.mockRejectedValue(
        mockError,
      );

      // Act & Assert
      await expect(
        service.generateConfigurationJobCsv({ traceId, payload }),
      ).rejects.toThrow('Failed to generate configuration job CSV');
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationJobCsv,
      ).toHaveBeenCalledWith({ traceId, payload });
    });

    it('should pass through undefined payload for configuration job CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const payload = undefined;
      configurationDataCsvGenerationActivity.generateConfigurationJobCsv.mockRejectedValue(
        new Error('Missing payload'),
      );

      // Act & Assert
      await expect(
        service.generateConfigurationJobCsv({ traceId, payload }),
      ).rejects.toThrow('Missing payload');
      expect(
        configurationDataCsvGenerationActivity.generateConfigurationJobCsv,
      ).toHaveBeenCalledWith({ traceId, payload: undefined });
    });

    it('should handle promise rejection with non-Error objects for configuration job CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const payload = {
        startDate: '2025-07-30',
        endDate: '2025-07-31',
        userId: 'test-user',
      };
      configurationDataCsvGenerationActivity.generateConfigurationJobCsv.mockRejectedValue(
        'String error',
      );

      // Act & Assert
      await expect(
        service.generateConfigurationJobCsv({ traceId, payload }),
      ).rejects.toBe('String error');
    });
  });
});
