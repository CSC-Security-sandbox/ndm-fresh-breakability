import { Button, ExternalLink, Text } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { BulkManualUploadPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";
import { Show } from "@components/show/Show";
import { DownloadMonochromeIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { BulkManualUpload } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/BulkManualUpload";

const BulkManualUploadFile = ({
  fileServerDetails,
  allExportPaths,
  handleReportDownload,
}: BulkManualUploadPropsType) => {
  const { openUploadModal } = BulkManualUpload(fileServerDetails);
  const hasExportPaths = allExportPaths.length > 0;
  const isRefreshAvailable = fileServerDetails?.isRefreshAvailable;

  return (
    <Box className="flex gap-2 justify-end">
      <Show>
        <Show.When isTrue={hasExportPaths}>
          <Box className="flex gap-2 items-center">
            <DownloadMonochromeIcon onClick={handleReportDownload} />
            <Button disabled={!isRefreshAvailable} onClick={openUploadModal}>
              Re-Upload Export Paths
            </Button>
          </Box>
        </Show.When>

        <Show.Else>
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
        </Show.Else>
      </Show>
    </Box>
  );
};

export default BulkManualUploadFile;
