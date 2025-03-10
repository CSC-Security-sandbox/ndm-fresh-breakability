import BulkDiscover from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/BulkDiscover";
import { Box } from "@components/container";

const BulkDiscoveryPage = () => {
  return (
    <Box className="overflow-y-scroll">
      <BulkDiscover />
    </Box>
  );
};

export default BulkDiscoveryPage;
