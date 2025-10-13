import { useMemo } from "react";
import { JobRunApiType } from "@/types/app.type";

/**
 * Returns the latest job run object and its ID from a jobRuns array.
 * @param jobRuns Array of job run objects
 */
export const useLatestJobRun = (jobRuns?: JobRunApiType[] | null) =>
  useMemo(() => {
    if (!jobRuns || jobRuns.length === 0) {
      return { latestJobRun: undefined, latestJobRunId: undefined };
    }
    const sortedJobRuns = jobRuns.slice().sort((a, b) => {
      const dateA = new Date(a.startTime).getTime();
      const dateB = new Date(b.startTime).getTime();
      return dateB - dateA;
    });
    const latestJobRun = sortedJobRuns[0];
    return {
      latestJobRun,
      latestJobRunId: latestJobRun?.jobRunId,
    };
  }, [jobRuns]);