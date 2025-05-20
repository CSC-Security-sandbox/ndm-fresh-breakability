import { BlueXpTableRowType } from "@/types/app.type";
import React from "react";
import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { Tooltip } from "@netapp/bxp-design-system-react";

const SourcePathCellRenderer = ({
  row,
}: BlueXpTableRowType<
  MigrationDetailsTableConfigurationType,
  MigrationDetailsTableConfigurationType
>) => {
  return (
    <>
      {row?.sourcePath?.sourcePathName}
      <Tooltip nowrap>{row?.sourcePath?.sourcePathName}</Tooltip>
    </>
  );
};

export default SourcePathCellRenderer;
