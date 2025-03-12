import JobInfoCard from "./JobInfoCard";
import JobInfoReverseCard from "./JobInfoReverseCard";
import { Card, CardContentLoading } from "@netapp/bxp-design-system-react";
import Divider from "@mui/material/Divider";
import { JOBS_TYPE, JobRunHeaderPropType } from "@/types/app.type";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import TimeElapsedRenderer from "@components/custom-cell-renderer/TimeElapsedRenderer";
import {
  calculateTimeDiff,
  getJobType,
  getJobTypeTextForHeader,
} from "@/utils/common.utils";

const JobHeader = ({ jobRunDetails }: JobRunHeaderPropType) => {
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

  return (
    <Card className="flex gap-16 p-10">
      <JobInfoCard
        label={getJobType(jobType)}
        value={<JobRunStatusCellRenderer status={jobRunDetails.status} />}
      />
      <Divider orientation="vertical" flexItem />
      <JobInfoReverseCard label="Files" value={jobStats?.fileCount || "--"} />
      <Divider orientation="vertical" flexItem />
      <JobInfoReverseCard
        label="Directories"
        value={jobStats?.directories || "--"}
      />
      <Divider orientation="vertical" flexItem />
      <JobInfoReverseCard
        label="Time Elapsed"
        value={<TimeElapsedRenderer value={timeElapsed} />}
      />
      <Divider orientation="vertical" flexItem />
      <JobInfoReverseCard
        label={getJobTypeTextForHeader(jobType)}
        value={jobStats?.totalSize || "--"}
        // valueType="gb"
      />
    </Card>
  );
};

export default JobHeader;
