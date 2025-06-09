import { Button } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { handleDownloadTemplate } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import { BulkManualUploadPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";
import { BulkManualUpload } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/BulkManualUpload";

const BulkManualUploadFile = ({
  fileServerDetails,
  allExportPaths,
}: BulkManualUploadPropsType) => {
  const { openUploadModal, downloadTemplate, buttonName } = BulkManualUpload(
    fileServerDetails,
    allExportPaths
  );

  return (
    <Box className="flex gap-2 justify-end">
      <Button
        disabled={!fileServerDetails?.isRefreshAvailable}
        onClick={openUploadModal}
      >
        {buttonName}
      </Button>
      <Button
        color="secondary"
        onClick={() =>
          handleDownloadTemplate(
            () => downloadTemplate({}),
            "export_path_source_template.csv"
          )
        }
      >
        Download Template
      </Button>
    </Box>
  );
};

export default BulkManualUploadFile;
