import React from "react";
import Box from "@/components/container/Box";
import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import { Show } from "@components/show/Show";

interface TooltipRendererProps {
  cellValue: string;
  cellComponent: React.ReactNode;
  showTooltip?: boolean;
}

const TooltipRenderer = ({ cellValue, cellComponent, showTooltip = true }: TooltipRendererProps) => {
  console.log({ cellValue, cellComponent, showTooltip })
  return (
    <Box className="Table-module_cell-value__ss5_Y">
      {cellComponent}
      <Show.When isTrue={showTooltip}>
        <Tooltip>
          <Box className="flex">
            <Text>{cellValue}</Text>
          </Box>
        </Tooltip>
      </Show.When>
    </Box>
  );
}

export default TooltipRenderer;