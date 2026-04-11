import JobInfoCard from "@modules/jobs/jobs-list/job-details/components/JobInfoCard";
import JobInfoReverseCard from "@modules/jobs/jobs-list/job-details/components/JobInfoReverseCard";
import { Box } from "@components/container/index";
import { Card, CardContentLoading } from "@netapp/bxp-design-system-react";
import Divider from "@mui/material/Divider";
import { JOB_STATUS_TYPE_ENUM, JOBS_TYPE, JobRunHeaderPropType } from "@/types/app.type";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import TimeElapsedRenderer from "@components/custom-cell-renderer/TimeElapsedRenderer";
import {
  calculateTimeDiff,
  getJobType,
  getJobTypeTextForHeader,
} from "@/utils/common.utils";
import { useGetJobRunLiveStatsQuery } from "@api/jobsApi";
import { useEffect, useRef } from "react";

const LIVE_STATS_POLL_INTERVAL_MS = 5000;

const MIGRATION_BREAKDOWN_LABEL_TOOLTIPS = {
  newlyCopied:
    "Files copied for the first time.",
  recopied:
    "Files whose content or metadata was updated.",
  skipped:
    "Files modified within the job's configured time window (for example, the last few minutes) and therefore skipped.",
  deleted: "Files deleted on the source.",
} as const;

const ACTIVE_JOB_STATUSES = new Set([
  JOB_STATUS_TYPE_ENUM.RUNNING,
  JOB_STATUS_TYPE_ENUM.PAUSING,
  JOB_STATUS_TYPE_ENUM.STOPPING,
]);

const JobHeader = ({ jobRunDetails, jobRunId }: JobRunHeaderPropType) => {
  const isActive = ACTIVE_JOB_STATUSES.has(jobRunDetails?.status);
  const prevIsActiveRef = useRef(isActive);

  const { data: liveStats, refetch } = useGetJobRunLiveStatsQuery(jobRunId, {
    pollingInterval: isActive ? LIVE_STATS_POLL_INTERVAL_MS : 0,
    skip: !jobRunId || (!isActive && !prevIsActiveRef.current),
  });

  useEffect(() => {
    if (prevIsActiveRef.current === true && !isActive && jobRunId) {
      refetch();
    }
    prevIsActiveRef.current = isActive;
  }, [isActive, jobRunId, refetch]);

  if (!jobRunDetails) {
    return (
      <Card className="flex h-full justify-center items-center p-10">
        <CardContentLoading />
      </Card>
    );
  }
  const { jobType } = jobRunDetails.jobConfig;
  const timeElapsed = calculateTimeDiff(
    jobRunDetails.startTime,
    jobRunDetails.endTime
  );

  let jobStats;
  switch (jobType) {
    case JOBS_TYPE.DISCOVERY:
      jobStats = jobRunDetails.discovery;
      break;
    case JOBS_TYPE.MIGRATE:
      jobStats = jobRunDetails.migrate;
      break;
    case JOBS_TYPE.CUT_OVER:
      jobStats = jobRunDetails.cutOver;
      break;
    default:
      jobStats = {
        fileCount: "--",
        totalSize: "--",
        directories: "--",
      };
  }

  const displayFileCount =
    (liveStats?.fileCount && liveStats.fileCount !== '0')
      ? liveStats.fileCount
      : jobStats?.fileCount || "--";

  const displayDirCount =
    (liveStats?.dirCount && liveStats.dirCount !== '0')
      ? liveStats.dirCount
      : jobStats?.directories || "--";

  const displaySize =
    (liveStats?.totalMigratedSize && liveStats.totalMigratedSize !== '0 B')
      ? liveStats.totalMigratedSize
      : jobStats?.totalSize || "--";

  const showMigrationStats =
    (jobType === JOBS_TYPE.MIGRATE || jobType === JOBS_TYPE.CUT_OVER) &&
    jobStats;

    const pickLiveOrJobStat = (
      liveVal: string | undefined,
      jobVal: string | undefined,
    ) => {
      if (liveVal != null && liveVal !== "") {
        return liveVal;
      }
      if (jobVal != null && jobVal !== "") {
        return jobVal;
      }
      return "--";
    };
  
    const displayNewlyCopied = pickLiveOrJobStat(
      liveStats?.newlyCopiedCount,
      jobStats?.newlyCopiedCount,
    );
    const displayRecopied = pickLiveOrJobStat(
      liveStats?.modifiedCount,
      jobStats?.modifiedCount,
    );
    const displaySkipped = pickLiveOrJobStat(
      liveStats?.skippedCount,
      jobStats?.skippedCount,
    );
    const displayDeleted = pickLiveOrJobStat(
      liveStats?.deletedCount,
      jobStats?.deletedCount,
    );

  return (
    <Box className="flex flex-col gap-4">
      <Card className="flex gap-16 p-10 min-h-[170px]">
        <JobInfoCard
          label={getJobType(jobType)}
          value={<JobRunStatusCellRenderer status={jobRunDetails.status} />}
        />
        <Divider orientation="vertical" flexItem />
        <JobInfoReverseCard label={showMigrationStats ? "Files (Newly Copied + Recopied)" : "Files"} value={displayFileCount} />
        <Divider orientation="vertical" flexItem />
        <JobInfoReverseCard
          label="Directories"
          value={displayDirCount}
        />
        <Divider orientation="vertical" flexItem />
        <JobInfoReverseCard
          label="Time Elapsed"
          value={<TimeElapsedRenderer value={timeElapsed} />}
        />
        <Divider orientation="vertical" flexItem />
        <JobInfoReverseCard
          label={getJobTypeTextForHeader(jobType)}
          value={displaySize}
        />
      </Card>
      {showMigrationStats && (
        <Card className="p-10 min-h-[170px]">
          <Box className="text-l font-medium mb-6">Migrated Files Breakdown</Box>
          <Box className="flex gap-16 flex-wrap">
            <JobInfoReverseCard
              label="Newly Copied"
              value={displayNewlyCopied}
              labelTooltip={MIGRATION_BREAKDOWN_LABEL_TOOLTIPS.newlyCopied}
            />
            <Divider orientation="vertical" flexItem />
            <JobInfoReverseCard
              label="Recopied"
              value={displayRecopied}
              labelTooltip={MIGRATION_BREAKDOWN_LABEL_TOOLTIPS.recopied}
            />
            <Divider orientation="vertical" flexItem />
            <JobInfoReverseCard
              label="Skipped"
              value={displaySkipped}
              labelTooltip={MIGRATION_BREAKDOWN_LABEL_TOOLTIPS.skipped}
            />
            <Divider orientation="vertical" flexItem />
            <JobInfoReverseCard
              label="Deleted"
              value={displayDeleted}
              labelTooltip={MIGRATION_BREAKDOWN_LABEL_TOOLTIPS.deleted}
            />
            <Divider orientation="vertical" flexItem />
          </Box>
        </Card>
      )}
    </Box>
  );
};

export default JobHeader;
