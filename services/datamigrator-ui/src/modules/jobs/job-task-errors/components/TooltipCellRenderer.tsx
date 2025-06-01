import { Box } from "@components/container";
import { Text, Tooltip } from "@netapp/bxp-design-system-react";

const TooltipCellRenderer = ({ value }: { value: string }) => {
  if (!value) {
    return <Box>-</Box>;
  }

  return (
    <Box className="overflow-hidden">
      <Text className="pr-1 overflow-hidden text-ellipsis whitespace-nowrap">{value}</Text>
      <Tooltip>
        <Box className="break-words whitespace-pre-wrap">{value}</Box>
      </Tooltip>
    </Box>
  );
};

export default TooltipCellRenderer;
