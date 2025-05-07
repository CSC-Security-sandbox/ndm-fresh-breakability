import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";

const BulkMigrateProceedButton = () => {
  const { mappingStepForm, selectedReviewIds, isFormSubmitting } =
    useContext(BulkMigrateContext);
  const { currentStepIndex, goToNextStep } = useWizard();
  const { handleSubmit, optionForm, sourceFileServerDetails } =
    useContext(BulkMigrateContext);
  const navigate = useNavigate();
  const onSuccessfulSubmit = () =>
    navigate(`/file-server/${sourceFileServerDetails.id}`);

  const handleNextOrSubmit = () => {
    if (currentStepIndex == 2) {
      handleSubmit(onSuccessfulSubmit);
      return;
    }
    goToNextStep();
  };

  const isMappingStepFormInValid = !mappingStepForm?.isValid;
  const isIncrementalSyncScheduleInValid = currentStepIndex == 1 && (
    !optionForm.formState.incremental_sync_schedule_cron_expression ||
    (optionForm.formState.incremental_sync_schedule_cron_expression_error ? true : false)
  );
  const isSelectedReviewIdsEmpty = currentStepIndex == 2 && selectedReviewIds.length === 0;
  const isOptionFormInValid = !optionForm.isValid;

  return (
    <Button
      onClick={handleNextOrSubmit}
      style={{ width: 152 }}
      disabled={
        isMappingStepFormInValid ||
        isIncrementalSyncScheduleInValid ||
        isSelectedReviewIdsEmpty ||
        isOptionFormInValid
      }
      isSubmitting={isFormSubmitting}
    >
      {currentStepIndex == 2 ? "Submit" : "Proceed"}
    </Button>
  );
};

export default BulkMigrateProceedButton;
