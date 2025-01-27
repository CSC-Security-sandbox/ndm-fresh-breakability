import { JobContext } from './types/job-context';
import { JobConfig } from './types/job-config';

export interface JobContextProvider {
  buildContext(
    jobRunId: string,
    jobConfig: JobConfig,
    jobStatus: string,
  ): Promise<JobContext>;

  getJobContext(jobRunId: string): Promise<JobContext | null>;
}
