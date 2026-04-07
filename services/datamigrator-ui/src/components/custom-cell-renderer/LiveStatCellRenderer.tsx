import { JOB_STATUS_TYPE_ENUM, JobRunApiType, JOBS_TYPE } from "@/types/app.type";
import { useGetJobRunLiveStatsQuery } from "@api/jobsApi";
import { useEffect, useRef } from "react";

const LIVE_STATS_POLL_INTERVAL_MS = 5000;

const ACTIVE_JOB_STATUSES = new Set([
  JOB_STATUS_TYPE_ENUM.RUNNING,
  JOB_STATUS_TYPE_ENUM.PAUSING,
  JOB_STATUS_TYPE_ENUM.STOPPING,
]);

interface LiveStatCellProps {
  row: JobRunApiType;
}

function useLiveStats(row: JobRunApiType) {
  const isActive = ACTIVE_JOB_STATUSES.has(row.status);
  const prevIsActiveRef = useRef(isActive);

  const { data: liveStats, refetch } = useGetJobRunLiveStatsQuery(row.jobRunId, {
    pollingInterval: isActive ? LIVE_STATS_POLL_INTERVAL_MS : 0,
    skip: !row.jobRunId || (!isActive && !prevIsActiveRef.current),
  });

  useEffect(() => {
    if (prevIsActiveRef.current === true && !isActive && row.jobRunId) {
      refetch();
    }
    prevIsActiveRef.current = isActive;
  }, [isActive, row.jobRunId, refetch]);

  return liveStats;
}

export const LiveFilesCell = ({ row }: LiveStatCellProps) => {
  const liveStats = useLiveStats(row);

  if (liveStats?.fileCount && liveStats.fileCount !== "0") {
    return <span>{liveStats.fileCount}</span>;
  }
  return <span>{row.scannedFilesCount ?? "--"}</span>;
};

export const LiveSizeCell = ({ row }: LiveStatCellProps) => {
  const liveStats = useLiveStats(row);

  // live stats API returns the same field name totalMigratedSize for all job types 
  // For a Discovery job, the Redis totalSize counter holds the scanned size — it's just exposed under the totalMigratedSize field name
  if (liveStats?.totalMigratedSize && liveStats.totalMigratedSize !== "0 B") {
    return <span>{liveStats.totalMigratedSize}</span>;
  }

  const sizeValue =
    row.jobType === JOBS_TYPE.DISCOVERY
      ? row.totalScannedSize
      : row.totalMigratedSize;

  return <span>{sizeValue ?? "--"}</span>;
};

export const LiveDirCell = ({ row }: LiveStatCellProps) => {
  const liveStats = useLiveStats(row);

  if (liveStats?.dirCount && liveStats.dirCount !== "0") {
    return <span>{liveStats.dirCount}</span>;
  }
  return <span>{row.scannedDirectoriesCount ?? "--"}</span>;
};
