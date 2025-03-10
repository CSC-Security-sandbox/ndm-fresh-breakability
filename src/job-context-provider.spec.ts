import { JobContextProvider } from './job-context-provider';
import { JobContext } from './types/job-context';
import { JobConfig } from './types/job-config';
import { JobStatus, JobType } from './types/enums';
import { FileServerDetails } from './types/file-server';
import { NFS } from './types/protocols';
import { JobState } from './types/job-state';

class MockJobContext extends JobContext {
    constructor(jobRunId: string, jobConfig: JobConfig, jobRunStatus: string, jobState: JobState) {
      super(jobRunId, jobConfig, jobRunStatus, jobState);
    }

    async init(): Promise<void> {
      // do nothing
    }

    async close(): Promise<void> {
      // do nothing
    }

    async cleanup(): Promise<void> {
      // do nothing
    }
}

class MockJobContextProvider implements JobContextProvider {
  private contexts: Map<string, JobContext> = new Map();
  async buildContext(
    jobRunId: string,
    jobConfig: JobConfig,
    jobRunStatus: string,  
    jobState: JobState,  
  ): Promise<JobContext> {
    const context: JobContext = new MockJobContext(jobRunId,
      jobConfig,
      jobRunStatus,
      jobState
    );

    this.contexts.set(jobRunId, context);
    return context;
  }

  async getJobContext(jobRunId: string): Promise<JobContext | null> {
    return this.contexts.get(jobRunId) || null;
  }
}

describe('JobContextProvider', () => {
  let provider: JobContextProvider;

  beforeEach(() => {
    provider = new MockJobContextProvider();
  });

  it('should build and retrieve job context', async () => {
    const jobRunId = 'test-run-id';
    const jobStatus = 'running';
    const jobState: any = {
      workers: ['1'],
      status: JobStatus.Running,
      tasks_completed: 1,
      tasks_total: 2,
      workers_agreed: []
    }
    const jobConfig = new JobConfig(
        jobRunId    ,
        JobType.DISCOVERY,
        new FileServerDetails(
          'localhost',
          [new NFS('root')],
          'pathId',
          'path',
        ),
        '/source',
      );

    const context = await provider.buildContext(jobRunId, jobConfig, jobStatus, jobState);
    expect(context).toEqual({
      jobRunId,
      jobConfig,
      jobRunStatus: jobStatus,
      stats: new Map(),
      jobState: jobState,
    });

    const retrievedContext = await provider.getJobContext(jobRunId);
    expect(retrievedContext).toEqual(context);
  });

  it('should return null for non-existing job context', async () => {
    const jobRunId = 'non-existing-id';
    const context = await provider.getJobContext(jobRunId);
    expect(context).toBeNull();
  });
});
