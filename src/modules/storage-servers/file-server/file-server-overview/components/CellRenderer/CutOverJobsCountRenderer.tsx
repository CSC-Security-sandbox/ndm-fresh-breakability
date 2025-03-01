import { BlueXpTableRowType } from "@/types/app.type";
import { JOBS_TYPE, VolumeType, JOB_STATUS_TYPE_ENUM } from "@/types/app.type";
import { Text } from "@netapp/bxp-design-system-react";
import JobsCountRenderer from "./JobCountRenderer";

const CutOverJobsCountRenderer = ({
  row,
}: BlueXpTableRowType<VolumeType, VolumeType>) => (
  <JobsCountRenderer
    row={row}
    jobType={JOBS_TYPE.CUT_OVER}
    renderCount={(statusCounts, jobRunDetailsLength) => (
      <Text>
        {`${
          statusCounts[JOB_STATUS_TYPE_ENUM.COMPLETED]
        }/${jobRunDetailsLength}`}
      </Text>
    )}
  />
);

export default CutOverJobsCountRenderer;
