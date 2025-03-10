import { JobContext } from './types/job-context';
import { JobConfig } from './types/job-config';
import { JobState } from './types/job-state';
import { SpeedTestJobContext } from './types/speed-test-job-context';
import { SpeedTestJobConfig } from './types/speed-test-job-config';


export interface JobContextProvider {
  buildContext(
    jobRunId: string,
    jobConfig: JobConfig,
    jobStatus: string,
    JobState: JobState,
  ): Promise<JobContext>;
  
  buildContext(
    jobRunId: string,
    jobConfig: SpeedTestJobConfig,
    jobStatus: string,
    JobState: JobState,
  ): Promise<SpeedTestJobContext>;

  getJobContext(jobRunId: string): Promise<SpeedTestJobContext | null>;

  getJobContext(jobRunId: string): Promise<JobContext | null>;
}
