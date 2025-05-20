import { ListPathWorkerWorkflow } from './list-path-worker.workflow';

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => ({
    listPath: jest.fn().mockResolvedValue('mocked result'),
  })),
}));

describe('ListPathWorkerWorkflow', () => {
  it('should process all protocols and return results', async () => {
    const args = {
      traceId: 'test-trace-id',
      fileServer: {
        hostname: 'test-hostname',
        protocols: [{ type: 'http' }, { type: 'ftp' }],
      },
    };

    const result = await ListPathWorkerWorkflow(args);

    expect(result).toEqual(['mocked result', 'mocked result']);
  });
});
