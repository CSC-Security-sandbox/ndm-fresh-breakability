import { Box } from "@components/container/index";
import BulkCutOver from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/BulkCutOver";

const BulkCutOverPage = () => {
  return (
    <Box className="p-8">
      <BulkCutOver />
    </Box>
  );
};

export default BulkCutOverPage;
