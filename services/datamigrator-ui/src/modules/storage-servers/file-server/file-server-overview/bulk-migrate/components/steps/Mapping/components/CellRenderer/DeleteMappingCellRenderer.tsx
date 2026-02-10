import { Box } from "@components/container/index";
import { Button } from "@netapp/bxp-design-system-react";
import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { BlueXpTableRowType } from "@/types/app.type";
import { useContext } from "react";

const DeleteMappingCellRenderer = ({
  row,
}: BlueXpTableRowType<
  MigrationDetailsTableConfigurationType,
  MigrationDetailsTableConfigurationType
>) => {
  const { editMapping, deleteMapping } = useContext(BulkMigrateContext);

  return (
    <Box className="flex items-center gap-2">
      <Button
        color="primary"
        onClick={() => row && editMapping(row)}
        aria-label="Edit mapping"
      >
        Edit
      </Button>
      <Button
        color="primary"
        onClick={() => deleteMapping(row?.id)}
        aria-label="Delete mapping"
      >
        Delete
      </Button>
    </Box>
  );
};

export default DeleteMappingCellRenderer;
