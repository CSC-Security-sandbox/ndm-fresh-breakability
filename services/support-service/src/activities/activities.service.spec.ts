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

jest.mock('./error-csv-generation/project-jobconfig-mapping.activity', () => ({
  ProjectJobConfigMappingActivity: jest.fn().mockImplementation(() => ({
    getJobConfigIdsByProjectIds: jest.fn(),
  })),
}));

jest.mock('./config-data-csv-generation/config-data-csv-generation.activity', () => ({
  ConfigurationDataCsvGenerationActivity: jest.fn().mockImplementation(() => ({
    generateConfigurationDataCsv: jest.fn(),
    generateConfigurationJobCsv: jest.fn(),
  })),
}));

import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { NotifyConfigActivity } from './notify-config/notify-config.activity';
import { ErrorCsvGenerationActivity } from './error-csv-generation/error-csv-generation.activity';
import { ProjectJobConfigMappingActivity } from './error-csv-generation/project-jobconfig-mapping.activity';
import { ConfigurationDataCsvGenerationActivity } from './config-data-csv-generation/config-data-csv-generation.activity';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let logGeneratorActivity: any;
  let notifyConfigActivity: any;
  let errorCsvGenerationActivity: any;
  let projectJobConfigMappingActivity: any;
  let configurationDataCsvGenerationActivity: any;

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

    projectJobConfigMappingActivity = {
      getJobConfigIdsByProjectIds: jest.fn(),
    };

    configurationDataCsvGenerationActivity = {
      generateConfigurationDataCsv: jest.fn(),
      generateConfigurationJobCsv: jest.fn(),
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
          provide: ProjectJobConfigMappingActivity,
          useValue: projectJobConfigMappingActivity,
        },
        {
          provide: ConfigurationDataCsvGenerationActivity,
          useValue: configurationDataCsvGenerationActivity,
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

  describe('fetchAndZipLogs', () => {
    it('should successfully fetch and zip logs', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockParams = { logLevel: 'INFO', dateRange: '7d' };
      const expectedResult = 'logs-zip-file-path.zip';
      logGeneratorActivity.fetchAndZipLogs.mockResolvedValue(expectedResult);

      // Act
      const result = await service.fetchAndZipLogs({
        traceId,
        payload: mockParams,
      });

      // Assert
      expect(result).toBe(expectedResult);
      expect(logGeneratorActivity.fetchAndZipLogs).toHaveBeenCalledTimes(1);
      expect(logGeneratorActivity.fetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload: mockParams });
    });

    it('should handle errors when fetching and zipping logs', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockParams = { logLevel: 'ERROR', dateRange: '1d' };
      const mockError = new Error('Failed to fetch logs');
      logGeneratorActivity.fetchAndZipLogs.mockRejectedValue(mockError);

      // Act & Assert
      await expect(service.fetchAndZipLogs({ traceId, payload: mockParams })).rejects.toThrow('Failed to fetch logs');
      expect(logGeneratorActivity.fetchAndZipLogs).toHaveBeenCalledWith({ traceId, payload: mockParams });
    });
  });

  describe('generateErrorCsv', () => {
    it('should successfully generate error CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockPayload = { errorFilters: ['critical'], outputPath: '/tmp/errors.csv' };
      const mockProjectIds = ['project1', 'project2'];
      const expectedResult = {
        success: true,
        message: 'CSV generation completed',
        filesCreated: 2,
      };
      errorCsvGenerationActivity.generateErrorCsv.mockResolvedValue(expectedResult);

      // Act
      const result = await service.generateErrorCsv({
        traceId,
        payload: mockPayload,
        projectIds: mockProjectIds,
      });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(errorCsvGenerationActivity.generateErrorCsv).toHaveBeenCalledTimes(1);
      expect(errorCsvGenerationActivity.generateErrorCsv).toHaveBeenCalledWith({ 
        traceId, 
        payload: mockPayload, 
        projectIds: mockProjectIds
      });
    });

    it('should handle errors when generating error CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockPayload = { errorFilters: ['warning'], outputPath: '/tmp/warnings.csv' };
      const mockProjectIds = ['project3'];
      const mockError = new Error('Error CSV generation failed');
      errorCsvGenerationActivity.generateErrorCsv.mockRejectedValue(mockError);

      // Act & Assert
      await expect(service.generateErrorCsv({ 
        traceId, 
        payload: mockPayload, 
        projectIds: mockProjectIds
      })).rejects.toThrow('Error CSV generation failed');
      expect(errorCsvGenerationActivity.generateErrorCsv).toHaveBeenCalledWith({ 
        traceId, 
        payload: mockPayload, 
        projectIds: mockProjectIds
      });
    });
  });

  describe('notifyWorkflowCompletion', () => {
    it('should successfully notify workflow completion', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const status = 'completed';
      const errorMessage = null;
      notifyConfigActivity.notifyWorkflowCompletion.mockResolvedValue(undefined);

      // Act
      const result = await service.notifyWorkflowCompletion({
        traceId,
        status,
        errorMessage,
      });

      // Assert
      expect(result).toBeUndefined();
      expect(notifyConfigActivity.notifyWorkflowCompletion).toHaveBeenCalledTimes(1);
      expect(notifyConfigActivity.notifyWorkflowCompletion).toHaveBeenCalledWith({ 
        traceId, 
        status, 
        errorMessage
      });
    });

    it('should handle errors when notifying workflow completion', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const status = 'failed';
      const errorMessage = 'Workflow failed';
      const mockError = new Error('Notification failed');
      notifyConfigActivity.notifyWorkflowCompletion.mockRejectedValue(mockError);

      // Act & Assert
      await expect(service.notifyWorkflowCompletion({ 
        traceId, 
        status, 
        errorMessage
      })).rejects.toThrow('Notification failed');
      expect(notifyConfigActivity.notifyWorkflowCompletion).toHaveBeenCalledWith({ 
        traceId, 
        status, 
        errorMessage
      });
    });
  });

  describe('getJobConfigIdsByProjectIds', () => {
    it('should successfully get job config IDs by project IDs', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockParams = { projectIds: ['project1', 'project2'] };
      const expectedResult = [
        { projectId: 'project1', jobConfigIds: ['config1', 'config2'] },
        { projectId: 'project2', jobConfigIds: ['config3'] }
      ];
      projectJobConfigMappingActivity.getJobConfigIdsByProjectIds.mockResolvedValue(expectedResult);

      // Act
      const result = await service.getJobConfigIdsByProjectIds({
        traceId,
        payload: mockParams,
      });

      // Assert
      expect(result).toEqual(expectedResult);
      expect(projectJobConfigMappingActivity.getJobConfigIdsByProjectIds).toHaveBeenCalledTimes(1);
      expect(projectJobConfigMappingActivity.getJobConfigIdsByProjectIds).toHaveBeenCalledWith({ traceId, payload: mockParams });
    });

    it('should handle errors when getting job config IDs', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockParams = { projectIds: ['invalid-project'] };
      const mockError = new Error('Failed to fetch job config IDs');
      projectJobConfigMappingActivity.getJobConfigIdsByProjectIds.mockRejectedValue(mockError);

      // Act & Assert
      await expect(service.getJobConfigIdsByProjectIds({ traceId, payload: mockParams })).rejects.toThrow('Failed to fetch job config IDs');
      expect(projectJobConfigMappingActivity.getJobConfigIdsByProjectIds).toHaveBeenCalledWith({ traceId, payload: mockParams });
    });
  });

  describe('generateConfigurationDataCsv', () => {
    it('should successfully generate configuration data CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockParams = { configType: 'data', outputPath: '/tmp/config-data.csv' };
      const expectedResult = 'Configuration data CSV generation completed successfully';
      configurationDataCsvGenerationActivity.generateConfigurationDataCsv.mockResolvedValue(expectedResult);

      // Act
      const result = await service.generateConfigurationDataCsv({
        traceId,
        payload: mockParams,
      });

      // Assert
      expect(result).toBe(expectedResult);
      expect(configurationDataCsvGenerationActivity.generateConfigurationDataCsv).toHaveBeenCalledTimes(1);
      expect(configurationDataCsvGenerationActivity.generateConfigurationDataCsv).toHaveBeenCalledWith({ traceId, payload: mockParams });
    });

    it('should handle errors when generating configuration data CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockParams = { configType: 'invalid', outputPath: '/tmp/invalid.csv' };
      const mockError = new Error('Configuration data CSV generation failed');
      configurationDataCsvGenerationActivity.generateConfigurationDataCsv.mockRejectedValue(mockError);

      // Act & Assert
      await expect(service.generateConfigurationDataCsv({ traceId, payload: mockParams })).rejects.toThrow('Configuration data CSV generation failed');
      expect(configurationDataCsvGenerationActivity.generateConfigurationDataCsv).toHaveBeenCalledWith({ traceId, payload: mockParams });
    });
  });

  describe('generateConfigurationJobCsv', () => {
    it('should successfully generate configuration job CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockParams = { jobType: 'backup', outputPath: '/tmp/config-jobs.csv' };
      const expectedResult = 'Configuration job CSV generation completed successfully';
      configurationDataCsvGenerationActivity.generateConfigurationJobCsv.mockResolvedValue(expectedResult);

      // Act
      const result = await service.generateConfigurationJobCsv({
        traceId,
        payload: mockParams,
      });

      // Assert
      expect(result).toBe(expectedResult);
      expect(configurationDataCsvGenerationActivity.generateConfigurationJobCsv).toHaveBeenCalledTimes(1);
      expect(configurationDataCsvGenerationActivity.generateConfigurationJobCsv).toHaveBeenCalledWith({ traceId, payload: mockParams });
    });

    it('should handle errors when generating configuration job CSV', async () => {
      // Arrange
      const traceId = 'test-trace-id';
      const mockParams = { jobType: 'invalid', outputPath: '/tmp/invalid-jobs.csv' };
      const mockError = new Error('Configuration job CSV generation failed');
      configurationDataCsvGenerationActivity.generateConfigurationJobCsv.mockRejectedValue(mockError);

      // Act & Assert
      await expect(service.generateConfigurationJobCsv({ traceId, payload: mockParams })).rejects.toThrow('Configuration job CSV generation failed');
      expect(configurationDataCsvGenerationActivity.generateConfigurationJobCsv).toHaveBeenCalledWith({ traceId, payload: mockParams });
    });
  });
});
