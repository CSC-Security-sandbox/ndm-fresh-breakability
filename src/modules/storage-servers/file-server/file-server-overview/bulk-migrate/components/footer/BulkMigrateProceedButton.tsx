import React, { useContext } from "react";
import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { useNavigate } from "react-router-dom";

const BulkMigrateProceedButton = () => {
  const { mappingStepForm, selectedReviewIds, isFormSubmitting } =
    useContext(BulkMigrateContext);
  const { currentStepIndex, goToNextStep } = useWizard();
  const { handleSubmit, optionForm, sourceFileServerDetails } =
    useContext(BulkMigrateContext);
  const navigate = useNavigate();
  const onSuccessfulSubmit = () =>
    navigate(`/config/file-server/${sourceFileServerDetails.id}`);

  const handleNextOrSubmit = () => {
    if (currentStepIndex == 2) {
      handleSubmit(onSuccessfulSubmit);
      return;
    }
    goToNextStep();
  };

  return (
    <Button
      onClick={handleNextOrSubmit}
      style={{ width: 152 }}
      disabled={
        !mappingStepForm?.isValid ||
        (currentStepIndex == 1 &&
          !optionForm.formState.incremental_sync_schedule_cron_expression) ||
        (currentStepIndex == 2 && selectedReviewIds.length === 0) ||
        !optionForm.isValid
      }
      isSubmitting={isFormSubmitting}
    >
      {currentStepIndex == 2 ? "Submit" : "Proceed"}
    </Button>
  );
};

export default BulkMigrateProceedButton;
