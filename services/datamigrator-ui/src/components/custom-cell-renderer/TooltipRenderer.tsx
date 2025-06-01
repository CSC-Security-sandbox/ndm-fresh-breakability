import React from "react";
import Box from "@/components/container/Box";
import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import { Show } from "@components/show/Show";
import { TooltipRendererProps } from "@/types/app.type";

const TooltipRenderer = ({
  tooltipContent,
  children,
  show = true,
}: TooltipRendererProps) => {
  return (
    <Box className="overflow-hidden">
      {children}
      <Show.When isTrue={show}>
        <Tooltip>
          <Box
            className="break-words whitespace-pre-wrap"
            data-testid="tooltip-box"
          >
            <Text>{tooltipContent}</Text>
          </Box>
        </Tooltip>
      </Show.When>
    </Box>
  );
};

export default TooltipRenderer;
