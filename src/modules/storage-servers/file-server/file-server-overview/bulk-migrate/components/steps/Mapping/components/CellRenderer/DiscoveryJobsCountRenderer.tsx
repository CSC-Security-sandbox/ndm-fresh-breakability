import React from "react";
import {
  JOBS_TYPE,
  VolumeType,
  BlueXpTableRowType,
  JOB_STATUS_TYPE_ENUM,
} from "@/types/app.type";
import { Text } from "@netapp/bxp-design-system-react";
import JobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/JobCountRenderer";
import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";

const DiscoveryJobsCountRenderer = ({
  row,
}: BlueXpTableRowType<
  MigrationDetailsTableConfigurationType,
  MigrationDetailsTableConfigurationType
>) => {
  return (
    <JobsCountRenderer
      row={row?.sourcePath?.volume}
      jobType={JOBS_TYPE.DISCOVERY}
      renderCount={(statusCounts, jobRunDetailsLength) => {
        if (!statusCounts || !jobRunDetailsLength) {
          return <Text>0/0/0</Text>;
        }

        return (
          <Text>
            {`${statusCounts[JOB_STATUS_TYPE_ENUM.RUNNING] || 0}/${
              statusCounts[JOB_STATUS_TYPE_ENUM.COMPLETED] || 0
            }/${jobRunDetailsLength}`}
          </Text>
        );
      }}
    />
  );
};

export default DiscoveryJobsCountRenderer;
