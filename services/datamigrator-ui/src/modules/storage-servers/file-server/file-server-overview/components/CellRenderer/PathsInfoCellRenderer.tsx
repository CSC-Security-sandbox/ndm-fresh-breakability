import { Box } from "@/components/container";
import { BlueXpTableRowType } from "@/types/app.type";
import { memo } from "react";
import { VALIDATION_STATUS } from "@modules/storage-servers/file-server/components/steps/Credentials/export-path-source.constants";

const PathsInfoCellRenderer = ({ row }: BlueXpTableRowType<any, string>) => {
  return (
    <>{row?.isValid ? VALIDATION_STATUS.VALID : VALIDATION_STATUS.INVALID}</>
  );
};

export default memo(PathsInfoCellRenderer);
