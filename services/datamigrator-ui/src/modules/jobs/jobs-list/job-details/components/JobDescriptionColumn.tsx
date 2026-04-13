import { Box } from "@components/container/index";
import { JobDescriptionColumnPropType } from "@/types/app.type";
import { Text } from "@netapp/bxp-design-system-react";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";

const JobDescriptionColumn = ({
  name,
  value,
  truncate,
}: JobDescriptionColumnPropType) => (
  <Box className="flex flex-col gap-0 min-w-0">
    <Text bold>{name}</Text>
    {truncate && typeof value === "string" ? (
      <TooltipRenderer tooltipContent={value} show={!!value}>
        <Text className="overflow-hidden text-ellipsis whitespace-nowrap">
          {value}
        </Text>
      </TooltipRenderer>
    ) : (
      <Text>{value}</Text>
    )}
  </Box>
);

export default JobDescriptionColumn;
