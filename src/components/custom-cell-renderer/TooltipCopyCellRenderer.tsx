import React, { useState, useEffect } from "react";
import Box from "@/components/container/Box";
import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import { CopyIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { copyToClipboard } from "@/utils/copyToClipboard";

const TooltipCopyCellRenderer = (value: string) => {
  const [ textCopied, setTextCopied ] = useState<boolean>(false);

  useEffect(() => {
    if(textCopied) {
      setTextCopied(false);
    }
  }, [textCopied]);

  const copyText = () => {
    copyToClipboard(value);
    setTextCopied(true);
  }

  return (
    <Box className="Table-module_cell-value__ss5_Y">
      {value}
      {!textCopied &&
        <Tooltip placement="center">
          <Text className="flex">
            {value}
            <CopyIcon onClick={copyText}/>
          </Text>
        </Tooltip>
      }
    </Box>
  );
}

export default TooltipCopyCellRenderer;