import {
  ExternalLink,
  FormFieldUploadFile,
} from "@netapp/bxp-design-system-react";
import { Box } from "@/components/container";
import { BlueXpFormType } from "@/types/app.type";
import {
  BulkManualUploadModalContentPropsType,
  UploadedFilePropsType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";
import UploadFileDetails from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/components/UploadFileDetails";
import { handleDownloadTemplate } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";

export const BulkManualUploadModalContent = (
  form: BlueXpFormType<BulkManualUploadModalContentPropsType>,
  exportPathSourceData: UploadedFilePropsType,
  downloadTemplate: () => void
) => {
  const hasError = form?.formErrors?.["exportPathSource.fileName"];

  return (
    <>
      <FormFieldUploadFile
        form={form}
        name="exportPathSource"
        placeholder="Export Paths File"
        accept=".csv"
        errorMessage={hasError}
        showError={hasError}
      />

      <Box
        className={`text-sm font-extralight flex gap-2 items-center ${
          hasError ? "pt-2" : ""
        }`}
      >
        Only CSV format supported.
        <ExternalLink
          variant="text"
          className="cursor-pointer"
          onClick={() =>
            handleDownloadTemplate(
              downloadTemplate,
              "export_paths_source_template.csv"
            )
          }
        >
          Download Template
        </ExternalLink>
      </Box>

      <UploadFileDetails exportPathSourceData={exportPathSourceData} />
    </>
  );
};
