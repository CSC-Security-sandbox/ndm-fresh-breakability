import { BlueXpTableRowType, FILE_SERVER_STATUS_ENUM } from "@/types/app.type";
import { getFileServerStatusFormat } from "@/utils/common.utils";
import { Box } from "@components/container/index";
import { Popover } from "@netapp/bxp-design-system-react";

const FileServerStatusCellRenderer = ({
  row,
}: BlueXpTableRowType<any, any>) => {
  const statusStyleMap: Record<FILE_SERVER_STATUS_ENUM, string> = {
    [FILE_SERVER_STATUS_ENUM.ACTIVE]: "bg-chart-5",
    [FILE_SERVER_STATUS_ENUM.IN_PROGRESS]: "bg-icon-primary",
    [FILE_SERVER_STATUS_ENUM.DRAFT]: "bg-chart-6",
    [FILE_SERVER_STATUS_ENUM.ERRORED]: "bg-error",
  };

  const statusStyle =
    statusStyleMap[row?.status as FILE_SERVER_STATUS_ENUM] || ""; // Type assertion

  if (row?.status === "ERRORED") {
    return (
      <Box className="flex items-center justify-between gap-2 w-full">
        <Box className="flex items-center gap-2">
          <span
            className={`w-3 h-3 rounded-full inline-block ${statusStyle}`}
          ></span>
          <Box>{getFileServerStatusFormat(row?.status)}</Box>
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
      <Box>{getFileServerStatusFormat(row?.status)}</Box>
    </Box>
  );
};

export default FileServerStatusCellRenderer;
