
import { executeChild } from '@temporalio/workflow';
import { ValidateConnectionsWorkflow } from './validate-connection.workflow';


jest.mock('@temporalio/workflow', () => ({
  executeChild: jest.fn(),
  proxyActivities: jest.fn(() => ({
    listPath: jest.fn().mockResolvedValue('mocked result'),
  })),
  ChildWorkflowCancellationType: {
    WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED',
  },
  ParentClosePolicy: {
    TERMINATE: 'TERMINATE',
  },
}));

describe('ValidateConnectionsWorkflow', () => {
  it('should execute child workflows for each workerId and return aggregated results', async () => {
    const mockExecuteChild = jest.fn().mockResolvedValue(['response1', 'response2']);
    (executeChild as jest.Mock) = mockExecuteChild;

    const traceId = 'test-trace-id';
    const payload = {
      workerIds: ['worker1', 'worker2'],
      fileServer: 'testFileServer',
    };
    const options = {
      someOption: 'value',
    };

    const result = await ValidateConnectionsWorkflow({ traceId, payload, options });

    expect(mockExecuteChild).toHaveBeenCalledTimes(payload.workerIds.length);
    expect(result).toEqual(['response1', 'response2', 'response1', 'response2']);
  });

  it('should handle empty workerIds gracefully', async () => {
    const traceId = 'test-trace-id';
    const payload = {
      workerIds: [],
      fileServer: 'testFileServer',
    };
    const options = {
      someOption: 'value',
    };

    const result = await ValidateConnectionsWorkflow({ traceId, payload, options });

    expect(result).toEqual([]);
  });
});
