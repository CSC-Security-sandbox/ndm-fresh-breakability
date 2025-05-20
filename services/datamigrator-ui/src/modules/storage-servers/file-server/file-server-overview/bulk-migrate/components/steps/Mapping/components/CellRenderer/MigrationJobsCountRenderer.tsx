import {
  JOBS_TYPE,
  BlueXpTableRowType,
  JOB_STATUS_TYPE_ENUM,
} from "@/types/app.type";
import { Text } from "@netapp/bxp-design-system-react";
import JobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/JobCountRenderer";
import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";

const MigrationJobsCountRenderer = ({
  row,
}: BlueXpTableRowType<
  MigrationDetailsTableConfigurationType,
  MigrationDetailsTableConfigurationType
>) => (
  <JobsCountRenderer
    row={row?.sourcePath?.volume}
    jobType={JOBS_TYPE.MIGRATE}
    renderCount={(statusCounts, jobRunDetailsLength) => (
      <Text>
        {`${statusCounts[JOB_STATUS_TYPE_ENUM.RUNNING]}/${
          statusCounts[JOB_STATUS_TYPE_ENUM.COMPLETED]
        }/${jobRunDetailsLength}`}
      </Text>
    )}
  />
);

export default MigrationJobsCountRenderer;
