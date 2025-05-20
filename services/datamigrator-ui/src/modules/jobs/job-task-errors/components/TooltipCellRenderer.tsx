import { Box } from "@components/container";
import { Text, Tooltip } from "@netapp/bxp-design-system-react";

const TooltipCellRenderer = ({ value }: { value: string }) => {
  if (!value) {
    return <Box>-</Box>;
  }

  return (
    <Box className="Table-module_cell-value__ss5_Y">
      <Text className="pr-1">{value}</Text>
      <Tooltip>
        <Box className="break-words whitespace-pre-wrap">{value}</Box>
      </Tooltip>
    </Box>
  );
};

export default TooltipCellRenderer;
