import { ValidateWorkerConnectionWorkflow } from './validate-worker-connection.workflow';

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => ({
    validate: jest.fn().mockResolvedValue('mocked validation result'),
  })),
}));

describe('ValidateWorkerConnectionWorkflow', () => {
  it('should validate all protocols and return results', async () => {
    const args = {
      traceId: 'test-trace-id',
      fileServer: {
        hostname: 'test-hostname',
        protocols: [{ type: 'SMB' }, { type: 'NFS' }],
      },
    };

    const result = await ValidateWorkerConnectionWorkflow(args);

    expect(result).toEqual(['mocked validation result', 'mocked validation result']);
  });
});
