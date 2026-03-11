import { JobRunStatus } from 'src/constants/enums';
import { JobRunEntity } from 'src/entities/jobrun.entity';

export interface SignalJobRunsInput {
  jobRuns: JobRunEntity[];
  signalStatus: JobRunStatus;
  progressingStatus: JobRunStatus;
}
