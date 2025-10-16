import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { NotifyConfigActivity } from './notify-config.activity';

// Mock axios
jest.mock('axios');
const mockAxios = axios as jest.Mocked<typeof axios>;

describe('NotifyConfigActivity', () => {
  let activity: NotifyConfigActivity;
  let configService: jest.Mocked<ConfigService>;
  let mockLogger: jest.Mocked<Logger>;

  const mockConfigUrl = 'https://config-service.example.com';

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'support-bundle.api.configUrl') return mockConfigUrl;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotifyConfigActivity,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    activity = module.get<NotifyConfigActivity>(NotifyConfigActivity);
    configService = module.get(ConfigService);

    // Mock logger
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as any;
    (activity as any).logger = mockLogger;

    // Reset axios mocks only, not all mocks
    mockAxios.post.mockClear();
  });

  describe('Constructor', () => {
    it('should initialize with valid configuration', () => {
      expect(activity).toBeDefined();
      expect(configService.get).toHaveBeenCalledWith(
        'support-bundle.api.configUrl',
      );
      expect((activity as any).configBaseUrl).toBe(mockConfigUrl);
    });

    it('should throw error when configUrl is missing', () => {
      configService.get.mockReturnValue(undefined);

      expect(() => {
        new NotifyConfigActivity(configService);
      }).toThrow('Config URL for support-bundle.api.configUrl is not defined');
    });

    it('should throw error when configUrl is empty string', () => {
      configService.get.mockReturnValue('');

      expect(() => {
        new NotifyConfigActivity(configService);
      }).toThrow('Config URL for support-bundle.api.configUrl is not defined');
    });

    it('should throw error when configUrl is null', () => {
      configService.get.mockReturnValue(null);

      expect(() => {
        new NotifyConfigActivity(configService);
      }).toThrow('Config URL for support-bundle.api.configUrl is not defined');
    });
  });

  describe('notifyWorkflowCompletion', () => {
    const mockTraceId = 'trace-123';
    const mockStatus = 'COMPLETED';
    const mockErrorMessage = null;

    beforeEach(() => {
      mockAxios.post.mockClear();
    });

    it('should successfully send notification with completed status', async () => {
      const mockResponse = { data: { success: true } };
      mockAxios.post.mockResolvedValue(mockResponse);

      await activity.notifyWorkflowCompletion({
        traceId: mockTraceId,
        status: mockStatus,
        errorMessage: mockErrorMessage,
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        `${mockConfigUrl}/support-bundle/workflow-status-update`,
        {
          traceId: mockTraceId,
          status: mockStatus,
          errorMessage: mockErrorMessage,
        },
        {
          headers: {
            trackId: mockTraceId
          }
        }
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${mockTraceId}] Notification sent to Config Service for workflow completion`,
      );
    });

    it('should successfully send notification with failed status and error message', async () => {
      const failedStatus = 'FAILED';
      const errorMessage = 'Workflow execution failed';
      const mockResponse = { data: { success: true } };
      mockAxios.post.mockResolvedValue(mockResponse);

      await activity.notifyWorkflowCompletion({
        traceId: mockTraceId,
        status: failedStatus,
        errorMessage: errorMessage,
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        `${mockConfigUrl}/support-bundle/workflow-status-update`,
        {
          traceId: mockTraceId,
          status: failedStatus,
          errorMessage: errorMessage,
        },
        {
          headers: {
            trackId: mockTraceId
          }
        }
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${mockTraceId}] Notification sent to Config Service for workflow completion`,
      );
    });

    it('should handle network errors gracefully', async () => {
      const networkError = new Error('Network Error');
      networkError.message = 'Request failed with status code 500';
      mockAxios.post.mockRejectedValue(networkError);

      await expect(
        activity.notifyWorkflowCompletion({
          traceId: mockTraceId,
          status: mockStatus,
          errorMessage: mockErrorMessage,
        }),
      ).rejects.toThrow('Request failed with status code 500');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `[${mockTraceId}] Failed to notify Config Service: Request failed with status code 500`,
      );
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.message = 'timeout of 5000ms exceeded';
      mockAxios.post.mockRejectedValue(timeoutError);

      await expect(
        activity.notifyWorkflowCompletion({
          traceId: mockTraceId,
          status: mockStatus,
          errorMessage: mockErrorMessage,
        }),
      ).rejects.toThrow('timeout of 5000ms exceeded');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `[${mockTraceId}] Failed to notify Config Service: timeout of 5000ms exceeded`,
      );
    });

    it('should handle axios error with response', async () => {
      const axiosError = new Error('Request failed with status code 404');
      (axiosError as any).response = {
        status: 404,
        data: { error: 'Endpoint not found' },
      };
      mockAxios.post.mockRejectedValue(axiosError);

      await expect(
        activity.notifyWorkflowCompletion({
          traceId: mockTraceId,
          status: mockStatus,
          errorMessage: mockErrorMessage,
        }),
      ).rejects.toThrow('Request failed with status code 404');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `[${mockTraceId}] Failed to notify Config Service: Request failed with status code 404`,
      );
    });

    it('should handle different status values', async () => {
      const statusValues = [
        'PENDING',
        'IN_PROGRESS',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
      ];
      const mockResponse = { data: { success: true } };
      mockAxios.post.mockResolvedValue(mockResponse);

      for (const status of statusValues) {
        await activity.notifyWorkflowCompletion({
          traceId: mockTraceId,
          status: status,
          errorMessage: mockErrorMessage,
        });

        expect(mockAxios.post).toHaveBeenCalledWith(
          `${mockConfigUrl}/support-bundle/workflow-status-update`,
          {
            traceId: mockTraceId,
            status: status,
            errorMessage: mockErrorMessage,
          },
          {
            headers: {
              trackId: mockTraceId
            }
          }
        );
      }

      expect(mockAxios.post).toHaveBeenCalledTimes(statusValues.length);
    });

    it('should handle undefined errorMessage', async () => {
      const mockResponse = { data: { success: true } };
      mockAxios.post.mockResolvedValue(mockResponse);

      await activity.notifyWorkflowCompletion({
        traceId: mockTraceId,
        status: mockStatus,
        errorMessage: undefined,
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        `${mockConfigUrl}/support-bundle/workflow-status-update`,
        {
          traceId: mockTraceId,
          status: mockStatus,
          errorMessage: undefined,
        },
        {
          headers: {
            trackId: mockTraceId
          }
        }
      );
    });

    it('should handle empty string traceId', async () => {
      const mockResponse = { data: { success: true } };
      mockAxios.post.mockResolvedValue(mockResponse);

      await activity.notifyWorkflowCompletion({
        traceId: '',
        status: mockStatus,
        errorMessage: mockErrorMessage,
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        `${mockConfigUrl}/support-bundle/workflow-status-update`,
        {
          traceId: '',
          status: mockStatus,
          errorMessage: mockErrorMessage,
        },
        {
          headers: {
            trackId: ''
          }
        }
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        '[] Notification sent to Config Service for workflow completion',
      );
    });

    it('should handle special characters in traceId', async () => {
      const specialTraceId = 'trace-123@test#special$chars';
      const mockResponse = { data: { success: true } };
      mockAxios.post.mockResolvedValue(mockResponse);

      await activity.notifyWorkflowCompletion({
        traceId: specialTraceId,
        status: mockStatus,
        errorMessage: mockErrorMessage,
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        `${mockConfigUrl}/support-bundle/workflow-status-update`,
        {
          traceId: specialTraceId,
          status: mockStatus,
          errorMessage: mockErrorMessage,
        },
        {
          headers: {
            trackId: specialTraceId
          }
        }
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        `[${specialTraceId}] Notification sent to Config Service for workflow completion`,
      );
    });

    it('should handle long error messages', async () => {
      const longErrorMessage = 'A'.repeat(1000); // 1000 character error message
      const mockResponse = { data: { success: true } };
      mockAxios.post.mockResolvedValue(mockResponse);

      await activity.notifyWorkflowCompletion({
        traceId: mockTraceId,
        status: 'FAILED',
        errorMessage: longErrorMessage,
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        `${mockConfigUrl}/support-bundle/workflow-status-update`,
        {
          traceId: mockTraceId,
          status: 'FAILED',
          errorMessage: longErrorMessage,
        },
        {
          headers: {
            trackId: mockTraceId
          }
        }
      );
    });

    it('should handle connection refused error', async () => {
      const connectionError = new Error('connect ECONNREFUSED 127.0.0.1:3000');
      mockAxios.post.mockRejectedValue(connectionError);

      await expect(
        activity.notifyWorkflowCompletion({
          traceId: mockTraceId,
          status: mockStatus,
          errorMessage: mockErrorMessage,
        }),
      ).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:3000');

      expect(mockLogger.error).toHaveBeenCalledWith(
        `[${mockTraceId}] Failed to notify Config Service: connect ECONNREFUSED 127.0.0.1:3000`,
      );
    });

    it('should call axios.post with correct URL construction', async () => {
      const customConfigUrl = 'https://custom-config.example.com:8080/api/v1';
      configService.get.mockReturnValue(customConfigUrl);

      // Create new instance with custom URL
      const customActivity = new NotifyConfigActivity(configService);
      (customActivity as any).logger = mockLogger;

      const mockResponse = { data: { success: true } };
      mockAxios.post.mockResolvedValue(mockResponse);

      await customActivity.notifyWorkflowCompletion({
        traceId: mockTraceId,
        status: mockStatus,
        errorMessage: mockErrorMessage,
      });

      expect(mockAxios.post).toHaveBeenCalledWith(
        `${customConfigUrl}/support-bundle/workflow-status-update`,
        {
          traceId: mockTraceId,
          status: mockStatus,
          errorMessage: mockErrorMessage,
        },
        {
          headers: {
            trackId: mockTraceId
          }
        }
      );
    });

    it('should handle axios error without message property', async () => {
      const errorWithoutMessage = { response: { status: 500 } };
      mockAxios.post.mockRejectedValue(errorWithoutMessage);

      await expect(
        activity.notifyWorkflowCompletion({
          traceId: mockTraceId,
          status: mockStatus,
          errorMessage: mockErrorMessage,
        }),
      ).rejects.toEqual(errorWithoutMessage);

      expect(mockLogger.error).toHaveBeenCalledWith(
        `[${mockTraceId}] Failed to notify Config Service: undefined`,
      );
    });
  });

  describe('Integration scenarios', () => {
    it('should maintain consistent behavior across multiple notifications', async () => {
      const mockResponse = { data: { success: true } };
      mockAxios.post.mockResolvedValue(mockResponse);

      const notifications = [
        { traceId: 'trace-1', status: 'PENDING', errorMessage: null },
        { traceId: 'trace-2', status: 'IN_PROGRESS', errorMessage: null },
        {
          traceId: 'trace-3',
          status: 'FAILED',
          errorMessage: 'Error occurred',
        },
        { traceId: 'trace-4', status: 'COMPLETED', errorMessage: null },
      ];

      for (const notification of notifications) {
        await activity.notifyWorkflowCompletion(notification);
      }

      expect(mockAxios.post).toHaveBeenCalledTimes(notifications.length);
      expect(mockLogger.log).toHaveBeenCalledTimes(notifications.length);

      notifications.forEach((notification, index) => {
        expect(mockAxios.post).toHaveBeenNthCalledWith(
          index + 1,
          `${mockConfigUrl}/support-bundle/workflow-status-update`,
          notification,
          {
            headers: {
              trackId: notification.traceId
            }
          }
        );
      });
    });

    it('should handle mixed success and failure scenarios', async () => {
      const scenarios = [
        { shouldSucceed: true, traceId: 'success-1' },
        { shouldSucceed: false, traceId: 'failure-1' },
        { shouldSucceed: true, traceId: 'success-2' },
        { shouldSucceed: false, traceId: 'failure-2' },
      ];

      for (const scenario of scenarios) {
        if (scenario.shouldSucceed) {
          mockAxios.post.mockResolvedValueOnce({ data: { success: true } });
          await activity.notifyWorkflowCompletion({
            traceId: scenario.traceId,
            status: 'COMPLETED',
            errorMessage: null,
          });
        } else {
          mockAxios.post.mockRejectedValueOnce(new Error('Network error'));
          await expect(
            activity.notifyWorkflowCompletion({
              traceId: scenario.traceId,
              status: 'FAILED',
              errorMessage: 'Test error',
            }),
          ).rejects.toThrow('Network error');
        }
      }

      expect(mockAxios.post).toHaveBeenCalledTimes(scenarios.length);
    });
  });
});
