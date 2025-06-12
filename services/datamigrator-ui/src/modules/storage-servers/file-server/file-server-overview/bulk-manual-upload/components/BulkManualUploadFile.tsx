import { Button, ExternalLink, Text } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { BulkManualUploadPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";
import { BulkManualUpload } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/BulkManualUpload";

const BulkManualUploadFile = ({
  fileServerDetails,
  allExportPaths,
}: BulkManualUploadPropsType) => {
  const { openUploadModal } = BulkManualUpload(fileServerDetails);
  const hasExportPaths = allExportPaths.length > 0;
  const isRefreshAvailable = fileServerDetails?.isRefreshAvailable;

  return (
    <Box className="flex gap-2 justify-end">
      {hasExportPaths ? (
        <Button disabled={!isRefreshAvailable} onClick={openUploadModal}>
          Re-Upload Export Paths
        </Button>
      ) : (
        <Box className="flex flex-col gap-2 items-center">
          <ExternalLink
            variant="text"
            className="cursor-pointer"
            onClick={openUploadModal}
          >
            Click here to Upload Export Paths
          </ExternalLink>

          <Box>No path has been uploaded yet.</Box>
        </Box>
      )}
    </Box>
  );
};

export default BulkManualUploadFile;
