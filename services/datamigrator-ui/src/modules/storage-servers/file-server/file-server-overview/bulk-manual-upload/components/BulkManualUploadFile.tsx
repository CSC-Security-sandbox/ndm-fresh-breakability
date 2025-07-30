import { Button, ExternalLink, Text } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { BulkManualUploadPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";
import { Show } from "@components/show/Show";
import { DownloadMonochromeIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { BulkManualUpload } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/BulkManualUpload";
import { FILE_SERVER_STATUS_ENUM } from "@/types/app.type";

const BulkManualUploadFile = ({
  fileServerDetails,
  allExportPaths,
  handleReportDownload,
}: BulkManualUploadPropsType) => {
  const { openUploadModal } = BulkManualUpload(fileServerDetails);
  const hasExportPaths = allExportPaths.length > 0;
  const isRefreshAvailable = fileServerDetails?.isRefreshAvailable;
  const isDraftStatus =
    fileServerDetails?.status === FILE_SERVER_STATUS_ENUM.DRAFT;

  return (
    <Box className="flex justify-end">
      <Show>
        <Show.When isTrue={hasExportPaths}>
          <Box className="flex gap-5 items-center">
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
              disabled={isDraftStatus}
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
