import BulkCutOver from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/BulkCutOver";
import { Box } from "@components/container/index";

const BulkCutOverPage = () => {
  return (
    <Box className="py-5">
      <Box className="ml-8 font-semibold text-lg">Bulk Cutover</Box>
      <BulkCutOver />
    </Box>
  );
};

export default BulkCutOverPage;
