import { Box } from "@/components/container";
import { BlueXpTableRowType } from "@/types/app.type";
import { memo } from "react";

const PathsInfoCellRenderer = ({ row }: BlueXpTableRowType<any, string>) => {
  if (row?.isDisabled) {
    return "Disabled";
  }
  return <Box>{row?.isValid ? "Valid" : "Invalid"}</Box>;
};

export default memo(PathsInfoCellRenderer);
