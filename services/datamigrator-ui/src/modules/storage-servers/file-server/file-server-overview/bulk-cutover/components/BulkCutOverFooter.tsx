import { Box } from "@components/container/index";
import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useContext } from "react";
import { BulkCutOverContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/context/BulkCutOverContextProvider";

const BulkCutOverFooter = () => {
  const {
    BulkCutOverForm,
    jobRunList,
    cutOverSelectedIds,
    handleCreateJobCutOverApi,
    isSubmittingBulkCutover,
  } = useContext(BulkCutOverContext);

  const { isReviewConformed, isSelectPathConformed } =
    BulkCutOverForm.formState;

  const navigate = useNavigate();
  const { fileServerId } = useParams<{ fileServerId: string }>();
  const [searchParams] = useSearchParams();
  const { currentStepIndex, gotoPreviousStep, goToNextStep } = useWizard();

  // Get zone query params for Dell Isilon - to preserve when navigating back
  const zoneNameParam = searchParams.get('zone');
  const zoneFileServerId = searchParams.get('fileServerId');

  const handleCancel = () => {
    // Build query string to preserve zone params for Dell Isilon
    const queryString = zoneFileServerId && zoneNameParam 
      ? `?zone=${encodeURIComponent(zoneNameParam)}&fileServerId=${zoneFileServerId}`
      : '';
    navigate(`/file-server/${fileServerId}${queryString}`);
  };

  const handleProceed = () => {
    if (currentStepIndex === 0) {
      goToNextStep();
    } else {
      // SAVE API CALL HERE
      handleCreateJobCutOverApi();
    }
  };

  function isProceedValid(): boolean {
    if (currentStepIndex === 0) {
      return cutOverSelectedIds.length === 0 || !isSelectPathConformed;
    } else if (currentStepIndex === 1) {
      if (jobRunList.length === 0) {
        return false;
      } else {
        return !isReviewConformed;
      }
    }
    return true;
  }

  return (
    <Box className="py-4 flex justify-center">
      <Box className="flex justify-end gap-4">
        <Button
          color="secondary"
          onClick={gotoPreviousStep}
          disabled={currentStepIndex === 0 || isSubmittingBulkCutover}
          style={{ width: 152 }}
        >
          Back
        </Button>
        <Button
          color="secondary"
          onClick={handleCancel}
          style={{ width: 152 }}
          disabled={isSubmittingBulkCutover}
        >
          Cancel
        </Button>
        <Button
          onClick={handleProceed}
          style={{ width: 152 }}
          disabled={isProceedValid()}
          isSubmitting={isSubmittingBulkCutover}
        >
          {currentStepIndex === 0 ? "Proceed" : "Submit"}
        </Button>
      </Box>
    </Box>
  );
};

export default BulkCutOverFooter;
