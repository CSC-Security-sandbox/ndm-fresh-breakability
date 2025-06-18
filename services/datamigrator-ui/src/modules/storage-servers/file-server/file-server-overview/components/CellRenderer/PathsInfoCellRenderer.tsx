import { Box } from "@/components/container";
import { BlueXpTableRowType } from "@/types/app.type";
import { memo } from "react";

const PathsInfoCellRenderer = ({ row }: BlueXpTableRowType<any, string>) => {
  return <>{row?.isValid ? "Valid" : "Invalid"}</>;
};

export default memo(PathsInfoCellRenderer);
