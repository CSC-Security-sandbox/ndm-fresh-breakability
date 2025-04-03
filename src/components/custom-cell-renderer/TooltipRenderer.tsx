import React, { useState, useEffect } from "react";
import Box from "@/components/container/Box";
import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import TooltipCopyCellRenderer from "./TooltipCopyCellRenderer";
import { CopyIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { copyToClipboard } from "@/utils/copyToClipboard";
import { Show } from "../show/Show";

interface TooltipRendererProps {
  cellValue: string;
  copy?: boolean;
}

const TooltipRenderer = ({ cellValue, copy }: TooltipRendererProps) => {
  const [ textCopied, setTextCopied ] = useState<boolean>(false);
  const [ showTooltip, setShowTooltip ] = useState<boolean>(true);

  useEffect(() => {
    if(textCopied) {
      setTimeout(() => {
        setShowTooltip(false);
      }, 1000);
    }
    if (!showTooltip) {
      setShowTooltip(true);
      setTextCopied(false);
    }
  }, [textCopied, showTooltip]);

  const copyText = () => {
    copyToClipboard(cellValue);
    setTextCopied(true);
  }

  return (
    <Show>
      <Show.When isTrue={showTooltip}>
        <Tooltip placement="center">
          <Text className="flex">
            <Show>
              <Show.When isTrue={textCopied}>
                Copied!
              </Show.When>
              <Show.Else>
                <Box className="flex">
                  {cellValue}
                  <CopyIcon onClick={copyText}/>
                </Box>
              </Show.Else>
            </Show>
          </Text>
        </Tooltip>
      </Show.When>
    </Show>
  );
}

export default TooltipRenderer;