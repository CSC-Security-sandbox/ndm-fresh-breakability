import { Button } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { handleDownloadTemplate } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import useBulkManualUpload from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/useBulkManualUpload";
import { BulkManualUploadPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";

const BulkManualUploadFile = ({
  fileServerDetails,
  allExportPaths,
}: BulkManualUploadPropsType) => {
  const { openUploadModal, downloadTemplate, buttonName } = useBulkManualUpload(
    fileServerDetails,
    allExportPaths
  );

  return (
    <Box className="flex gap-2 justify-end">
      <Button onClick={openUploadModal}>{buttonName}</Button>
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
