import { JobContext } from './types/job-context';
import { JobConfig } from './types/job-config';
import { JobState } from './types/job-state';

export interface JobContextProvider {
  buildContext(
    jobRunId: string,
    jobConfig: JobConfig,
    jobStatus: string,
    JobState: JobState,
  ): Promise<JobContext>;
  

  getJobContext(jobRunId: string): Promise<JobContext | null>;
}
