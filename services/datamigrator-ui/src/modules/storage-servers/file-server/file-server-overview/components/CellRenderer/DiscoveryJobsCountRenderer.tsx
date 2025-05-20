import React from "react";
import {
  JOBS_TYPE,
  VolumeType,
  BlueXpTableRowType,
  JOB_STATUS_TYPE_ENUM,
} from "@/types/app.type";
import { Text } from "@netapp/bxp-design-system-react";
import JobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/JobCountRenderer";

const DiscoveryJobsCountRenderer = ({
  row,
}: BlueXpTableRowType<VolumeType, VolumeType>) => (
  <JobsCountRenderer
    row={row}
    jobType={JOBS_TYPE.DISCOVERY}
    renderCount={(statusCounts, jobRunDetailsLength) => (
      <Text>
        {`${statusCounts[JOB_STATUS_TYPE_ENUM.RUNNING]}/${
          statusCounts[JOB_STATUS_TYPE_ENUM.COMPLETED]
        }/${jobRunDetailsLength}`}
      </Text>
    )}
  />
);

export default DiscoveryJobsCountRenderer;
