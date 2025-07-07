import { Box } from "@/components/container";
import { BlueXpTableRowType } from "@/types/app.type";
import { memo } from "react";
import { VALIDATION_STATUS } from "@modules/storage-servers/file-server/components/steps/Credentials/export-path-source.constants";
import { Popover } from "@netapp/bxp-design-system-react";

const PathsInfoCellRenderer = ({ row }: BlueXpTableRowType<any, string>) => {
  return (
    <>
      <Box className="mr-2">
        {row?.isValid ? VALIDATION_STATUS.VALID : VALIDATION_STATUS.INVALID}
      </Box>
      {!row?.isValid && <Popover>{row?.validationResult}</Popover>}
    </>
  );
};

export default memo(PathsInfoCellRenderer);
