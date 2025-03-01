import { BlueXpTableRowType } from "@/types/app.type";
import React from "react";
import { Box } from "@components/container/index";
import { toTitleCase } from "@/utils/common.utils";

type FileServerStatus = "ACTIVE" | "DRAFT" | "ERROR";

const FileServerStatusCellRenderer = ({
  row,
}: BlueXpTableRowType<any, any>) => {
  const statusStyleMap: Record<FileServerStatus, string> = {
    ACTIVE: "bg-chart-5",
    DRAFT: "bg-chart-6",
    ERROR: "bg-error",
  };

  const statusStyle = statusStyleMap[row?.status as FileServerStatus] || ""; // Type assertion

  return (
    <Box className="flex gap-2 items-center">
      <span
        className={`w-3 h-3 rounded-full inline-block ${statusStyle}`}
      ></span>
      <Box>{toTitleCase(row?.status)}</Box>
    </Box>
  );
};

export default FileServerStatusCellRenderer;
