import { SpeedTestJobContext } from './types/speed-test-job-context';
import { SpeedTestJobConfig } from './types/speed-test-job-config';
import { JobState } from './types/job-state';

export interface SpeedTestJobContextProvider {
  buildContext(
    jobRunId: string,
    jobConfig: SpeedTestJobConfig,
    jobStatus: string,
    JobState: JobState,
  ): Promise<SpeedTestJobContext>;

  getJobContext(jobRunId: string): Promise<SpeedTestJobContext | null>;
}
