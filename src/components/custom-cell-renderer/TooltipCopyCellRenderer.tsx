import React, { useState, useEffect } from "react";
import Box from "@/components/container/Box";
import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import { CopyIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { copyToClipboard } from "@/utils/copyToClipboard";
import { Show } from "../show/Show";

const TooltipCopyCellRenderer = ( value: string ) => {
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
    copyToClipboard(value);
    setTextCopied(true);
  }

  return (
    <Box className="Table-module_cell-value__ss5_Y">
      {value}
      <Show>
        <Show.When isTrue={showTooltip}>
          <Tooltip placement="center">
            <Text className="flex">
              {textCopied ?
                "Copied!" :
                <>
                  {value}
                  <CopyIcon onClick={copyText}/>
                </>
              }
            </Text>
          </Tooltip>
        </Show.When>
      </Show>
    </Box>
  );
}

export default TooltipCopyCellRenderer;