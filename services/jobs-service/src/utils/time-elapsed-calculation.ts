import { JobRunStatus } from "src/constants/enums";

export const timeElapsed = (jobRun: Record<string, any>) => {
  const jobRunStartTime = jobRun?.startTime ? jobRun?.startTime : jobRun?.starttime;
  const jobRunEndTime = jobRun?.endTime ? jobRun?.endTime : jobRun?.endtime;

  if ((jobRun.subStatus || jobRun.status) === JobRunStatus.Paused) {
    return jobRun.timeElapsed
      ? jobRun?.timeElapsed.getTime() - jobRunStartTime.getTime()
      : Date.now() - jobRunStartTime.getTime();
  } else {
    return jobRunEndTime
      ? jobRunEndTime.getTime() - jobRunStartTime.getTime()
      : Date.now() - jobRunStartTime.getTime();
  }
};