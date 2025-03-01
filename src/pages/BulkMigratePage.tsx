import BulkMigrate from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/BulkMigrate";
import { Box } from "@components/container/index";

const BulkMigratePage = () => {
  return (
    <Box className="p-8">
      <BulkMigrate />
    </Box>
  );
};

export default BulkMigratePage;
