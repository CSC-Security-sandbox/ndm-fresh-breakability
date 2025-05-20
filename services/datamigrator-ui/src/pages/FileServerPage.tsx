import FileServer from "@modules/storage-servers/file-server/FileServer";
import { Box } from "@components/container";

const FileServerPage = () => {
  return (
    <Box className="p-8">
      <FileServer />
    </Box>
  );
};

export default FileServerPage;
