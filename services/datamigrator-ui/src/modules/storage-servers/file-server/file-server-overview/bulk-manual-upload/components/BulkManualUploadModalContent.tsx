import { FormFieldUploadFile } from "@netapp/bxp-design-system-react";
import { Box } from "@/components/container";
import { BlueXpFormType } from "@/types/app.type";
import {
  BulkManualUploadModalContentPropsType,
  UploadedFilePropsType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";
import UploadFileDetails from "./UploadFileDetails";

export const BulkManualUploadModalContent = (
  form: BlueXpFormType<BulkManualUploadModalContentPropsType>,
  exportPathSourceData: UploadedFilePropsType
) => {
  return (
    <>
      <FormFieldUploadFile
        form={form}
        name="exportPathSource"
        placeholder="Upload Export Source Paths"
        accept=".csv"
        errorMessage={form?.formErrors?.["exportPathSource.fileName"]}
        showError={form?.formErrors?.["exportPathSource.fileName"]}
      />
      <Box className="text-sm font-extralight">
        Supported formats: CSV (Max size: 2MB)
      </Box>
      <UploadFileDetails exportPathSourceData={exportPathSourceData} />
    </>
  );
};
