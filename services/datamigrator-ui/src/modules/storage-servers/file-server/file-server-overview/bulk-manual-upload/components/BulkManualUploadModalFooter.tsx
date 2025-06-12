import { Button } from "@netapp/bxp-design-system-react";
import { BlueXpFormType } from "@/types/app.type";
import {
  BulkManualUploadModalContentPropsType,
  UploadedFilePropsType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";

export const BulkManualUploadModalFooter = (
  form: BlueXpFormType<BulkManualUploadModalContentPropsType>,
  exportPathSourceData: UploadedFilePropsType,
  isLoading: boolean,
  onSubmit: () => Promise<void>,
  handleResetAndClose: () => void
) => {
  return (
    <>
      <Button color="secondary" onClick={handleResetAndClose}>
        Cancel
      </Button>
      <Button
        disabled={!form?.formState?.exportPathSource || !form?.isValid}
        onClick={onSubmit}
        isSubmitting={isLoading}
      >
        {exportPathSourceData?.uploadId ? "Submit" : "Upload"}
      </Button>
    </>
  );
};
