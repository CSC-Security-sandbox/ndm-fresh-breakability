import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { BULK_MIGRATE_STEPS_IDS } from "@/modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";

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
    if (currentStepIndex === BULK_MIGRATE_STEPS_IDS.review) {
      handleSubmit(onSuccessfulSubmit);
      return;
    }
    goToNextStep();
  };

  // Validation methods
  const isMappingStepFormInValid = () => !mappingStepForm?.isValid;

  const isIncrementalSyncScheduleInValid = () => {
    if (currentStepIndex !== BULK_MIGRATE_STEPS_IDS.options) return false;

    const isCronExpressionSelected =
      optionForm.formState.incremental_sync_schedule === "cron_expression";

    if (!isCronExpressionSelected) return false;

    const cronExpressionValue =
      optionForm.formState.incremental_sync_schedule_cron_expression;
    const cronExpressionError =
      optionForm.formState.incremental_sync_schedule_cron_expression_error;

    return !cronExpressionValue || cronExpressionError;
  };

  const isSelectedReviewIdsEmpty = () =>
    currentStepIndex === BULK_MIGRATE_STEPS_IDS.review &&
    selectedReviewIds?.length === 0;

  const isOptionFormInValid = () => !optionForm?.isValid;

  const isSubmitDisabled = () => {
    return (
      isMappingStepFormInValid() ||
      isIncrementalSyncScheduleInValid() ||
      isSelectedReviewIdsEmpty() ||
      isOptionFormInValid()
    );
  };

  return (
    <Button
      onClick={handleNextOrSubmit}
      style={{ width: 152 }}
      disabled={Boolean(isSubmitDisabled())}
      isSubmitting={isFormSubmitting}
    >
      {currentStepIndex === BULK_MIGRATE_STEPS_IDS.review
        ? "Submit"
        : "Proceed"}
    </Button>
  );
};

export default BulkMigrateProceedButton;
