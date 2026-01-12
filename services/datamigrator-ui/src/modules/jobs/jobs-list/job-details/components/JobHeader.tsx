import StatusCellRenderer from "@components/custom-cell-renderer/StatusCellRenderer";
import JobInfoCard from "@modules/jobs/jobs-list/job-details/components/JobInfoCard";
import JobInfoReverseCard from "@modules/jobs/jobs-list/job-details/components/JobInfoReverseCard";
import { Card, CardContentLoading } from "@netapp/bxp-design-system-react";
import Divider from "@mui/material/Divider";
import { Box } from "@components/container/index";
import {
  JOBS_TYPE,
  JOB_CONFIG_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  JobHeaderPropType,
} from "@/types/app.type";
import TimeElapsedRenderer from "@components/custom-cell-renderer/TimeElapsedRenderer";
import {
  getJobStatusFormat,
  getJobType,
  getJobTypeTextForHeader,
} from "@/utils/common.utils";

interface JobHeaderProps extends JobHeaderPropType {
  inventoryStats?: {
    totalUniqueFiles: number;
    totalUniqueDirectories: number;
    totalSize: string;
    lastUpdatedAt: Date;
  };
}

const JobHeader = ({ jobConfigDetails, inventoryStats }: JobHeaderProps) => {
  if (!jobConfigDetails) {
    return (
      <Card className="flex gap-16 p-10">
        <CardContentLoading />
      </Card>
    );
  }

  const currentJobType = jobConfigDetails?.jobType;

  const jobRunLatest =
    currentJobType === JOBS_TYPE.DISCOVERY
      ? [...(jobConfigDetails?.jobRuns ?? [])]
          ?.sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime))
          ?.find((row) => row.status === JOB_STATUS_TYPE_ENUM.COMPLETED)
      : jobConfigDetails?.aggregateData;
  const timeElapsed = jobRunLatest?.timeElapsed || 0;

  if(currentJobType === JOBS_TYPE.MIGRATE){
    return (
      <Card className="flex gap-16 p-10">
          <JobInfoCard
            label={getJobType(jobConfigDetails.jobType)}
            value={
              <StatusCellRenderer
                status={getJobStatusFormat(jobConfigDetails.status)}
                active={jobConfigDetails.status === JOB_CONFIG_STATUS_ENUM.ACTIVE}
              />
            }
          />
          <Divider orientation="vertical" flexItem />
          <JobInfoReverseCard
            label="Total Files"
            value={inventoryStats?.totalUniqueFiles || "--"}
          />
          <Divider orientation="vertical" flexItem />
          <JobInfoReverseCard
            label="Total Directories"
            value={inventoryStats?.totalUniqueDirectories || "--"}
          />

          <Divider orientation="vertical" flexItem />
          <JobInfoReverseCard
            label="Total Size"
            value={inventoryStats?.totalSize || "--"}
            // valueType="gb"
          />
        </Card>
    )
  }
  else{
    return (
      <Card className="flex gap-16 p-10">
        <JobInfoCard
          label={getJobType(jobConfigDetails.jobType)}
          value={
            <StatusCellRenderer
              status={getJobStatusFormat(jobConfigDetails.status)}
              active={jobConfigDetails.status === JOB_CONFIG_STATUS_ENUM.ACTIVE}
            />
          }
        />
        <Divider orientation="vertical" flexItem />
        <JobInfoReverseCard
          label="Files"
          value={jobRunLatest?.scannedFilesCount || "--"}
        />
        <Divider orientation="vertical" flexItem />
        <JobInfoReverseCard
          label="Directories"
          value={jobRunLatest?.scannedDirectoriesCount || "--"}
        />

        <Divider orientation="vertical" flexItem />
        <JobInfoReverseCard
          label="Time Elapsed"
          value={<TimeElapsedRenderer value={timeElapsed} />}
        />
        <Divider orientation="vertical" flexItem />
        <JobInfoReverseCard
          label={getJobTypeTextForHeader(jobConfigDetails.jobType)}
          value={jobRunLatest?.totalScannedSize || "--"}
          // valueType="gb"
        />
      </Card>
    );
  }
};

export default JobHeader;
