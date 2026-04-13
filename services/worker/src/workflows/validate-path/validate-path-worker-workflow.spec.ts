import { ValidatePathWorkerWorkflow } from './validate-path-worker-workflow';

const mockValidatePath = jest.fn();

// Use an arrow wrapper so mockValidatePath is accessed lazily (when called),
// not immediately when the hoisted jest.mock factory executes.
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => ({
    validatePath: (...args: any[]) => mockValidatePath(...args),
  })),
}));

const makeArgs = (paths: { pathId: string; path: string }[], traceId = 'trace-123') => ({
  traceId,
  paths,
  fileServer: {
    host: 'nas.example.com',
    username: 'admin',
    password: 'secret',
    type: 'NFS',
    protocolVersion: '3',
  },
});

const successResult = (path: string, pathId: string, traceId = 'trace-123') => ({
  result: {
    traceId,
    status: 'success',
    workerId: 'worker-1',
    path,
    pathId,
    message: `Paths validated successfully by worker worker-1`,
  },
});

describe('ValidatePathWorkerWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Basic correctness ──────────────────────────────────────────────────────

  it('should return empty validationResult and correct traceId for an empty paths array', async () => {
    const args = makeArgs([]);
    const result = await ValidatePathWorkerWorkflow(args);
    expect(result).toEqual({ validationResult: [], traceId: 'trace-123' });
    expect(mockValidatePath).not.toHaveBeenCalled();
  });

  it('should validate a single path and return success', async () => {
    mockValidatePath.mockResolvedValue(successResult('/vol/data', 'path-1').result);
    const args = makeArgs([{ pathId: 'path-1', path: '/vol/data' }]);

    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult).toHaveLength(1);
    expect(result.validationResult[0].result.status).toBe('success');
    expect(result.validationResult[0].result.path).toBe('/vol/data');
    expect(result.traceId).toBe('trace-123');
  });

  it('should pass correct parameters to validatePath activity', async () => {
    mockValidatePath.mockResolvedValue(successResult('/vol/data', 'path-1').result);
    const args = makeArgs([{ pathId: 'path-1', path: '/vol/data' }]);

    await ValidatePathWorkerWorkflow(args);

    expect(mockValidatePath).toHaveBeenCalledWith({
      path: '/vol/data',
      host: 'nas.example.com',
      username: 'admin',
      password: 'secret',
      protocol: 'NFS',
      uploadId: 'trace-123',
      protocolVersion: '3',
      pathId: 'path-1',
    });
  });

  it('should return validationResult with error entry when validatePath throws', async () => {
    mockValidatePath.mockRejectedValue(new Error('mount failed'));
    const args = makeArgs([{ pathId: 'path-1', path: '/vol/bad' }]);

    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult).toHaveLength(1);
    const entry = result.validationResult[0];
    expect(entry.status).toBe('error');
    expect(entry.path).toBe('/vol/bad');
    expect(entry.pathId).toBe('path-1');
    expect(entry.message).toContain('mount failed');
  });

  it('should use args.traceId (not args.uploadId) in error entries', async () => {
    mockValidatePath.mockRejectedValue(new Error('timeout'));
    const args = makeArgs([{ pathId: 'path-1', path: '/vol/bad' }], 'my-trace-id');

    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult[0].traceId).toBe('my-trace-id');
  });

  it('should not include workerId in error entries (this is undefined in workflow functions)', async () => {
    mockValidatePath.mockRejectedValue(new Error('timeout'));
    const args = makeArgs([{ pathId: 'path-1', path: '/vol/bad' }]);

    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult[0]).not.toHaveProperty('workerId');
  });

  it('should sanitize commas and newlines in error messages', async () => {
    mockValidatePath.mockRejectedValue(new Error('error,with,commas\nand newlines'));
    const args = makeArgs([{ pathId: 'path-1', path: '/vol/bad' }]);

    const result = await ValidatePathWorkerWorkflow(args);

    const message: string = result.validationResult[0].message;
    expect(message).not.toContain(',');
    expect(message).not.toContain('\n');
    expect(message).toContain('error|with|commas');
    expect(message).toContain('and newlines');
  });

  // ─── Mixed success / failure ─────────────────────────────────────────────────

  it('should handle a mix of successful and failed paths', async () => {
    mockValidatePath
      .mockResolvedValueOnce(successResult('/vol/ok', 'path-1').result)
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockResolvedValueOnce(successResult('/vol/ok2', 'path-3').result);

    const args = makeArgs([
      { pathId: 'path-1', path: '/vol/ok' },
      { pathId: 'path-2', path: '/vol/bad' },
      { pathId: 'path-3', path: '/vol/ok2' },
    ]);

    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult).toHaveLength(3);
    expect(result.validationResult[0].result.status).toBe('success');
    expect(result.validationResult[1].status).toBe('error');
    expect(result.validationResult[2].result.status).toBe('success');
  });

  // ─── Concurrency / batching ───────────────────────────────────────────────────

  it('should validate exactly 10 paths in a single batch', async () => {
    mockValidatePath.mockResolvedValue(successResult('/vol/x', 'id').result);
    const paths = Array.from({ length: 10 }, (_, i) => ({
      pathId: `path-${i}`,
      path: `/vol/${i}`,
    }));
    const args = makeArgs(paths);

    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult).toHaveLength(10);
    expect(mockValidatePath).toHaveBeenCalledTimes(10);
  });

  it('should process 11 paths in 2 batches (10 + 1)', async () => {
    mockValidatePath.mockResolvedValue(successResult('/vol/x', 'id').result);
    const paths = Array.from({ length: 11 }, (_, i) => ({
      pathId: `path-${i}`,
      path: `/vol/${i}`,
    }));
    const args = makeArgs(paths);

    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult).toHaveLength(11);
    expect(mockValidatePath).toHaveBeenCalledTimes(11);
  });

  it('should process 100 paths across 10 batches of 10', async () => {
    mockValidatePath.mockResolvedValue(successResult('/vol/x', 'id').result);
    const paths = Array.from({ length: 100 }, (_, i) => ({
      pathId: `path-${i}`,
      path: `/vol/${i}`,
    }));
    const args = makeArgs(paths);

    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult).toHaveLength(100);
    expect(mockValidatePath).toHaveBeenCalledTimes(100);
  });

  it('should preserve path order in results across multiple batches', async () => {
    const paths = Array.from({ length: 25 }, (_, i) => ({
      pathId: `path-${i}`,
      path: `/vol/${i}`,
    }));

    mockValidatePath.mockImplementation(({ path }) =>
      Promise.resolve({ status: 'success', path, pathId: path }),
    );

    const args = makeArgs(paths);
    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult).toHaveLength(25);
    result.validationResult.forEach((entry, idx) => {
      expect(entry.result.path).toBe(`/vol/${idx}`);
    });
  });

  it('should continue processing remaining batches even if one batch has failures', async () => {
    // First batch (paths 0-9): all fail
    // Second batch (paths 10-19): all succeed
    mockValidatePath.mockImplementation(({ path }) => {
      const idx = parseInt(path.replace('/vol/', ''));
      if (idx < 10) return Promise.reject(new Error('batch 1 failure'));
      return Promise.resolve({ status: 'success', path, pathId: `path-${idx}` });
    });

    const paths = Array.from({ length: 20 }, (_, i) => ({
      pathId: `path-${i}`,
      path: `/vol/${i}`,
    }));
    const args = makeArgs(paths);

    const result = await ValidatePathWorkerWorkflow(args);

    expect(result.validationResult).toHaveLength(20);
    const errors = result.validationResult.filter((e) => e.status === 'error');
    const successes = result.validationResult.filter((e) => e.result?.status === 'success');
    expect(errors).toHaveLength(10);
    expect(successes).toHaveLength(10);
  });

  it('should run paths within the same batch concurrently', async () => {
    const callOrder: number[] = [];
    const resolveOrder: number[] = [];

    // Stagger resolution: path-0 resolves last, path-9 resolves first
    mockValidatePath.mockImplementation(({ pathId }) => {
      const idx = parseInt(pathId.replace('path-', ''));
      callOrder.push(idx);
      return new Promise((resolve) =>
        setTimeout(() => {
          resolveOrder.push(idx);
          resolve({ status: 'success', pathId });
        }, (10 - idx) * 10), // path-0 = 100ms delay, path-9 = 10ms delay
      );
    });

    const paths = Array.from({ length: 10 }, (_, i) => ({
      pathId: `path-${i}`,
      path: `/vol/${i}`,
    }));
    const args = makeArgs(paths);

    await ValidatePathWorkerWorkflow(args);

    // All 10 should have been called before any resolved (concurrent dispatch)
    expect(callOrder).toHaveLength(10);
    // path-9 (10ms) should resolve before path-0 (100ms), confirming concurrent execution
    expect(resolveOrder[0]).toBe(9);
    expect(resolveOrder[9]).toBe(0);
  });
});
