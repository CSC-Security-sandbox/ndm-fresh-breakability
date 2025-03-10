import { Box } from "@components/container/index";
import BulkCutOver from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/BulkCutOver";

const BulkCutOverPage = () => {
  return (
    <Box className="py-5">
      <BulkCutOver />
    </Box>
  );
};

export default BulkCutOverPage;
