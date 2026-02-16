import { BlueXpTableRowType } from "@/types/app.type";
import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import TruncatedPathCell from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/TruncatedPathCell";

const SourcePathCellRenderer = ({
  row,
}: BlueXpTableRowType<
  MigrationDetailsTableConfigurationType,
  MigrationDetailsTableConfigurationType
>) => {
  const value = row?.sourcePath?.sourcePathName ?? "";
  return <TruncatedPathCell value={value} />;
};

export default SourcePathCellRenderer;
