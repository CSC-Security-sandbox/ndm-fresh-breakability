import { BlueXpTableRowType } from "@/types/app.type";
import { toTitleCase } from "@/utils/common.utils";
import { Box } from "@components/container/index";
import { Popover } from "@netapp/bxp-design-system-react";
type FileServerStatus = "ACTIVE" | "DRAFT" | "ERRORED";

const FileServerStatusCellRenderer = ({
  row,
}: BlueXpTableRowType<any, any>) => {
  const statusStyleMap: Record<FileServerStatus, string> = {
    ACTIVE: "bg-chart-5",
    DRAFT: "bg-chart-6",
    ERRORED: "bg-error",
  };

  const statusStyle = statusStyleMap[row?.status as FileServerStatus] || ""; // Type assertion

  if (row?.status === "ERRORED") {
    return (
      <Box className="flex items-center justify-between gap-2 w-full">
        <Box className="flex items-center gap-2">
          <span
            className={`w-3 h-3 rounded-full inline-block ${statusStyle}`}
          ></span>
          <Box>{toTitleCase(row?.status)}</Box>
        </Box>
        <Popover>{row?.errorMessage}</Popover>
      </Box>
    );
  }

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
