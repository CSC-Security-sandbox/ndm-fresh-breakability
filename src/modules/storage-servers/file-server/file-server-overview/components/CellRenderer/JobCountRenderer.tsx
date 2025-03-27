import React from "react";
import {
  JOB_STATUS_TYPE_ENUM,
  VolumeType,
  BlueXpTableRowType,
} from "@/types/app.type";
import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import StatusWithCount from "./StatusWithCount";
import { toTitleCase } from "@/utils/common.utils";

interface JobsCountRendererProps {
  row: BlueXpTableRowType<VolumeType, VolumeType>["row"];
  jobType: string;
  renderCount: (
    statusCounts: Record<string, number>,
    jobDetails: any
  ) => React.ReactNode;
}

const JobsCountRenderer: React.FC<JobsCountRendererProps> = ({
  row,
  jobType,
  renderCount,
}) => {
  const jobDetails = row?.jobConfig?.find(
    (jobs) => jobs?.jobType?.toUpperCase() === jobType
  );

  if (!jobDetails) {
    return "-";
  }

  const statusCounts = {
    [JOB_STATUS_TYPE_ENUM.READY]: 0,
    [JOB_STATUS_TYPE_ENUM.PENDING]: 0,
    [JOB_STATUS_TYPE_ENUM.RUNNING]: 0,
    [JOB_STATUS_TYPE_ENUM.PAUSED]: 0,
    [JOB_STATUS_TYPE_ENUM.STOPPED]: 0,
    [JOB_STATUS_TYPE_ENUM.COMPLETED]: 0,
    [JOB_STATUS_TYPE_ENUM.FAILED]: 0,
    [JOB_STATUS_TYPE_ENUM.ERRORED]: 0,
    [JOB_STATUS_TYPE_ENUM.BLOCKED]: 0,
    [JOB_STATUS_TYPE_ENUM.REJECTED]: 0,
    [JOB_STATUS_TYPE_ENUM.APPROVED]: 0,
  };

  row.jobConfig.forEach((config) => {
    config.jobRunDetails.forEach((jobDetail) => {
      if (
        Object.prototype.hasOwnProperty.call(statusCounts, jobDetail.status) && jobType === config?.jobType
      ) {
        statusCounts[jobDetail.status as keyof typeof statusCounts]++;
      }
    });
  });

  return (
    <>
      {renderCount(statusCounts, jobDetails.jobRunDetails.length)}

      <Tooltip placement="center">
        <Text>
          Total {jobType.toLowerCase().replace("_", " ")} jobs:{" "}
          {jobDetails.jobRunDetails.length}
        </Text>
        {Object.entries(statusCounts).map(([status, count]) => (
          <StatusWithCount
            key={status}
            count={count}
            title={toTitleCase(status.replace(/_/g, " "))}
          />
        ))}
      </Tooltip>
    </>
  );
};

export default JobsCountRenderer;
