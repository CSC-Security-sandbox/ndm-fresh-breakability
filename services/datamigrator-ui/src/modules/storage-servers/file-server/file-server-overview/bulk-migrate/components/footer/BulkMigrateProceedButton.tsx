import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BULK_MIGRATE_STEPS_IDS } from "@/modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";

const BulkMigrateProceedButton = () => {
  const { mappingStepForm, selectedReviewIds, isFormSubmitting } =
    useContext(BulkMigrateContext);
  const { currentStepIndex, goToNextStep } = useWizard();
  const { handleSubmit, optionForm, sourceFileServerDetails } =
    useContext(BulkMigrateContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Get zone query params for Dell Isilon - to preserve when navigating back
  const zoneNameParam = searchParams.get('zone');
  const zoneFileServerId = searchParams.get('fileServerId');

  const onSuccessfulSubmit = () => {
    // Build query string to preserve zone params for Dell Isilon
    const queryString = zoneFileServerId && zoneNameParam 
      ? `?zone=${encodeURIComponent(zoneNameParam)}&fileServerId=${zoneFileServerId}`
      : '';
    navigate(`/file-server/${sourceFileServerDetails.id}${queryString}`);
  };

  const handleNextOrSubmit = () => {
    if (currentStepIndex === BULK_MIGRATE_STEPS_IDS.review) {
      handleSubmit(onSuccessfulSubmit);
      return;
    }
    goToNextStep();
  };

  // On Mapping step: Proceed enabled when at least one mapping added
  const hasAtLeastOneMapping = () =>
    (mappingStepForm?.values?.migrationDetailsTableConfigurationValue?.length ?? 0) >= 1;

  const isMappingStepFormInValid = () => {
    if (currentStepIndex === BULK_MIGRATE_STEPS_IDS.mapping) {
      return !hasAtLeastOneMapping();
    }
    return !mappingStepForm?.isValid;
  };

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
      data-testid="btn-bulk-migrate-proceed"
      onClick={handleNextOrSubmit}
      style={{ width: 152 }}
      disabled={Boolean(isSubmitDisabled())}
      isSubmitting={isFormSubmitting}
      data-testid="btn-bulk-migrate-proceed"
    >
      {currentStepIndex === BULK_MIGRATE_STEPS_IDS.review
        ? "Submit"
        : "Proceed"}
    </Button>
  );
};

export default BulkMigrateProceedButton;
