import { FileServerDetails } from './file-server';
import { JobConfig } from './job-config';
import { NFS } from './protocols';

describe('JobConfig Class', () => {
  it('should create and serialize JobConfig', () => {
    const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const fs2 = new FileServerDetails('', [ new NFS('') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
    const serialized = jobConfig.serialize();
    const newJobConfig = new JobConfig('', '', fs2, '');
    newJobConfig.deserialize(serialized);
    expect(newJobConfig.jobId).toBe('job1');
  });

  it('should serialize and deserialize JobConfig with shouldScanADS option', () => {
    const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const fs2 = new FileServerDetails('', [ new NFS('') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    
    const options = {
      preserveAccessTime: true,
      shouldScanADS: true,
      excludeOlderThan: '2025-01-01',
      excludeFilePattern: '*.tmp',
    };
    
    const jobConfig = new JobConfig(
      'job1',
      'DISCOVER',
      sourceFileServer,
      '/source',
      undefined,
      undefined,
      ['worker1'],
      options
    );
    
    const serialized = jobConfig.serialize();
    const newJobConfig = new JobConfig('', '', fs2, '');
    newJobConfig.deserialize(serialized);
    
    expect(newJobConfig.jobId).toBe('job1');
    expect(newJobConfig.jobType).toBe('DISCOVER');
    expect(newJobConfig.options).toBeDefined();
    expect(newJobConfig.options?.shouldScanADS).toBe(true);
    expect(newJobConfig.options?.preserveAccessTime).toBe(true);
  });

  it('should handle shouldScanADS as false in options', () => {
    const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const fs2 = new FileServerDetails('', [ new NFS('') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    
    const options = {
      preserveAccessTime: false,
      shouldScanADS: false,
    };
    
    const jobConfig = new JobConfig(
      'job2',
      'DISCOVER',
      sourceFileServer,
      '/source',
      undefined,
      undefined,
      [],
      options
    );
    
    const serialized = jobConfig.serialize();
    const newJobConfig = new JobConfig('', '', fs2, '');
    newJobConfig.deserialize(serialized);
    
    expect(newJobConfig.options?.shouldScanADS).toBe(false);
  });

  it('should handle options without shouldScanADS (undefined)', () => {
    const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const fs2 = new FileServerDetails('', [ new NFS('') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    
    const options = {
      preserveAccessTime: true,
      // shouldScanADS not specified
    };
    
    const jobConfig = new JobConfig(
      'job3',
      'DISCOVER',
      sourceFileServer,
      '/source',
      undefined,
      undefined,
      [],
      options
    );
    
    const serialized = jobConfig.serialize();
    const newJobConfig = new JobConfig('', '', fs2, '');
    newJobConfig.deserialize(serialized);
    
    expect(newJobConfig.options?.shouldScanADS).toBeUndefined();
    expect(newJobConfig.options?.preserveAccessTime).toBe(true);
  });

  it('should serialize and deserialize JobConfig with jobRunId for retry runs', () => {
    const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const fs2 = new FileServerDetails('', [ new NFS('') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    
    const jobConfig = new JobConfig(
      'job1',
      'MIGRATE',
      sourceFileServer,
      '/source',
      undefined,
      undefined,
      ['worker1'],
      {},
      false,
      'parent-job-run-123'  // jobRunId for retry
    );
    
    const serialized = jobConfig.serialize();
    const newJobConfig = new JobConfig('', '', fs2, '');
    newJobConfig.deserialize(serialized);
    
    expect(newJobConfig.jobId).toBe('job1');
    expect(newJobConfig.jobType).toBe('MIGRATE');
    expect(newJobConfig.jobRunId).toBe('parent-job-run-123');
  });

  it('should handle jobRunId as undefined for non-retry runs', () => {
    const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const fs2 = new FileServerDetails('', [ new NFS('') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    
    const jobConfig = new JobConfig(
      'job2',
      'MIGRATE',
      sourceFileServer,
      '/source',
      undefined,
      undefined,
      ['worker1'],
      {},
      false
      // jobRunId not provided
    );
    
    const serialized = jobConfig.serialize();
    const newJobConfig = new JobConfig('', '', fs2, '');
    newJobConfig.deserialize(serialized);
    
    expect(newJobConfig.jobRunId).toBeUndefined();
  });
});

