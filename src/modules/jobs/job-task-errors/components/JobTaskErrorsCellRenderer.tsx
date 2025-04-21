import { Tooltip } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { BlueXpTableRowType, JobErrorType } from "@/types/app.type";

const JobTaskErrorsCellRenderer = ({
  value,
}: BlueXpTableRowType<JobErrorType, string>) => {
  return (
    <>
      <Box>{value?.length > 30 ? `${value.substring(0, 30)}...` : value}</Box>
      <Tooltip>{value}</Tooltip>
    </>
  );
};

export default JobTaskErrorsCellRenderer;
