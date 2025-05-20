import JobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/JobCountRenderer";
import {
  BlueXpTableRowType,
  JOB_STATUS_TYPE_ENUM,
  JOBS_TYPE,
} from "@/types/app.type";
import { Text } from "@netapp/bxp-design-system-react";
import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";

const CutoverJobsCountRenderer = ({
  row,
}: BlueXpTableRowType<
  MigrationDetailsTableConfigurationType,
  MigrationDetailsTableConfigurationType
>) => (
  <JobsCountRenderer
    row={row?.sourcePath?.volume}
    jobType={JOBS_TYPE.CUT_OVER}
    renderCount={(statusCounts, jobRunDetailsLength) => (
      <Text>
        {`${statusCounts[JOB_STATUS_TYPE_ENUM.RUNNING]}/${
          statusCounts[JOB_STATUS_TYPE_ENUM.COMPLETED]
        }/${jobRunDetailsLength}`}
      </Text>
    )}
  />
);

export default CutoverJobsCountRenderer;
