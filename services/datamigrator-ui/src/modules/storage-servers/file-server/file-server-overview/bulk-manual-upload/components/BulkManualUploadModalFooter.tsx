import { Button } from "@netapp/bxp-design-system-react";
import { BlueXpFormType } from "@/types/app.type";
import { BulkManualUploadModalContentPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";

export const BulkManualUploadModalFooter = (
  form: BlueXpFormType<BulkManualUploadModalContentPropsType>,
  isLoading: boolean,
  onSubmit: () => Promise<void>,
  resetStateAndCloseModal: () => void
) => {
  return (
    <>
      <Button color="secondary" onClick={resetStateAndCloseModal}>
        Cancel
      </Button>
      <Button
        disabled={!form?.formState?.exportPathSource || !form?.isValid}
        onClick={onSubmit}
        isSubmitting={isLoading}
      >
        Submit
      </Button>
    </>
  );
};
