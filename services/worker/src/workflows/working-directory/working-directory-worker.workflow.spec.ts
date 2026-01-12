const mockListPath = jest.fn();
const mockValidateWorkingDirectory = jest.fn();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn().mockReturnValue({
    listPath: mockListPath,
    validateWorkingDirectory: mockValidateWorkingDirectory,
  }),
}));

jest.mock('src/activities/list-path/list-path.service', () => ({}));
jest.mock('src/activities/working-directory/working-directory.service', () => ({}));

import { ValidateWorkingDirectoryWorkerWorkflow } from './working-directory-worker.workflow';

describe('ValidateWorkingDirectoryWorkerWorkflow', () => {
  const traceId = 'trace-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch paths and set fetchedPath when exportPath is not provided (OtherNAS)', async () => {
    const args: any = {
      traceId,
      payload: {
        serverType: 'OtherNAS',
        listPathPayload: [
          { type: 'nfs', host: 'host1', username: 'user', password: 'pass' }
        ]
      }
    };
    mockListPath.mockResolvedValueOnce({ paths: ['/mnt/data'] });
    mockValidateWorkingDirectory.mockResolvedValueOnce('validated');

    const result = await ValidateWorkingDirectoryWorkerWorkflow(args);

    expect(mockListPath).toHaveBeenCalledWith(traceId, 'nfs', {
      hostname: 'host1',
      username: 'user',
      password: 'pass'
    });
    expect(args.payload.fetchedPath).toBe('/mnt/data');
    expect(args.payload.exportPathWorkingDirectoryProvided).toBe(false);
    expect(mockValidateWorkingDirectory).toHaveBeenCalledWith(traceId, args.payload);
    expect(result).toBe('validated');
  });

  it('should set exportPathPresent when exportPath is provided and present in paths', async () => {
    const args: any = {
      traceId,
      payload: {
        serverType: 'OtherNAS',
        listPathPayload: [
          { type: 'nfs', host: 'host1', username: 'user', password: 'pass' }
        ],
        exportPath: '/mnt/export'
      }
    };
    mockListPath.mockResolvedValueOnce({ paths: ['/mnt/data', '/mnt/export'] });
    mockValidateWorkingDirectory.mockResolvedValueOnce('validated');

    const result = await ValidateWorkingDirectoryWorkerWorkflow(args);

    expect(args.payload.exportPathWorkingDirectoryProvided).toBe(true);
    expect(args.payload.exportPathPresent).toBe(true);
    expect(args.payload.fetchedPath).toBeUndefined();
    expect(mockValidateWorkingDirectory).toHaveBeenCalledWith(traceId, args.payload);
    expect(result).toBe('validated');
  });

  it('should set exportPathPresent to false if exportPath is not present in paths', async () => {
    const args: any = {
      traceId,
      payload: {
        serverType: 'OtherNAS',
        listPathPayload: [
          { type: 'nfs', host: 'host1', username: 'user', password: 'pass' }
        ],
        exportPath: '/mnt/absent'
      }
    };
    mockListPath.mockResolvedValueOnce({ paths: ['/mnt/data', '/mnt/export'] });
    mockValidateWorkingDirectory.mockResolvedValueOnce('validated');

    const result = await ValidateWorkingDirectoryWorkerWorkflow(args);

    expect(args.payload.exportPathWorkingDirectoryProvided).toBe(true);
    expect(args.payload.fetchedPath).toBeUndefined();
    expect(mockValidateWorkingDirectory).toHaveBeenCalledWith(traceId, args.payload);
    expect(result).toBe('validated');
  });

  it('should handle multiple listPathPayload entries (OtherNAS)', async () => {
    const args: any = {
      traceId,
      payload: {
        serverType: 'OtherNAS',
        listPathPayload: [
          { type: 'nfs', host: 'host1', username: 'user', password: 'pass' },
          { type: 'nfs', host: 'host2', username: 'user2', password: 'pass2' }
        ]
      }
    };
    mockListPath
      .mockResolvedValueOnce({ paths: ['/mnt/data1', '/mnt/export1'] })
      .mockResolvedValueOnce({ paths: ['/mnt/data2', '/mnt/export2'] });
    mockValidateWorkingDirectory.mockResolvedValueOnce('validated');

    const result = await ValidateWorkingDirectoryWorkerWorkflow(args);

    expect(args.payload.fetchedPath).toBe('/mnt/data2');
    expect(args.payload.exportPathWorkingDirectoryProvided).toBe(false);
    expect(mockValidateWorkingDirectory).toHaveBeenCalledWith(traceId, args.payload);
    expect(result).toBe('validated');
  });

  it('should use discoveredPaths for storage-aware types (Dell)', async () => {
    const args: any = {
      traceId,
      payload: {
        serverType: 'Dell',
        discoveredPaths: ['/ifs/shardul', '/ifs/testdp'],
        exportsMap: { 'isilon.lab.global': '/ifs/shardul' },
        listPathPayload: [
          { type: 'nfs', host: 'isilon.lab.global', username: 'root', password: '' }
        ]
      }
    };
    mockValidateWorkingDirectory.mockResolvedValueOnce('validated');

    const result = await ValidateWorkingDirectoryWorkerWorkflow(args);

    // Should NOT call listPath for storage-aware types
    expect(mockListPath).not.toHaveBeenCalled();
    // Should use discoveredPaths
    expect(args.payload.paths).toEqual(['/ifs/shardul', '/ifs/testdp']);
    // Should use exportsMap for fetchedPath
    expect(args.payload.fetchedPath).toBe('/ifs/shardul');
    expect(args.payload.isStorageAware).toBe(true);
    expect(mockValidateWorkingDirectory).toHaveBeenCalledWith(traceId, args.payload);
    expect(result).toBe('validated');
  });
});
