import { Box } from "@components/container/index";
import { Button } from "@netapp/bxp-design-system-react";
import { ActionButtonsPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButtons.types";
import { JOB_ACTION_STATUS_ENUM } from "@/types/app.type";
import { useJobRunStatus } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/useJobStatus";
import { memo } from "react";

const ActionButtons = ({
  selectedRowIds,
  showResumeButton = false,
  rows = [],
}: ActionButtonsPropsType) => {
  const createModalContent = () => (
    <Box className="flex flex-col gap-10 text-gray-700 font-light">
      Are you sure you want to Stop the running Job?
      <Box>
        Once stopped, it cannot be resumed and will need to be restarted.
      </Box>
    </Box>
  );

  const createModalFooter = (status: JOB_ACTION_STATUS_ENUM) => (
    <>
      <Button color="secondary" onClick={() => dispatch(setModalClose())}>
        Cancel
      </Button>
      <Button onClick={() => submitAction(status)}>Stop</Button>
    </>
  );

  const {
    loadingState,
    isButtonDisabled,
    isUpdating,
    handleUpdateStatus,
    submitAction,
    dispatch,
    setModalClose,
  } = useJobRunStatus(
    rows,
    selectedRowIds,
    createModalContent,
    createModalFooter
  );

  return (
    <Box className="flex justify-end gap-3">
      {showResumeButton && (
        <Button
          disabled={
            isButtonDisabled.RUNNING ||
            loadingState[JOB_ACTION_STATUS_ENUM.PAUSE] ||
            loadingState[JOB_ACTION_STATUS_ENUM.STOP]
          }
          onClick={() => handleUpdateStatus(JOB_ACTION_STATUS_ENUM.RESUME)}
          className="w-[152px]"
          isSubmitting={loadingState[JOB_ACTION_STATUS_ENUM.RESUME]}
        >
          Resume
        </Button>
      )}
      <Button
        disabled={
          isButtonDisabled.PAUSED ||
          loadingState[JOB_ACTION_STATUS_ENUM.STOP] ||
          loadingState[JOB_ACTION_STATUS_ENUM.RESUME]
        }
        onClick={() => handleUpdateStatus(JOB_ACTION_STATUS_ENUM.PAUSE)}
        className="w-[152px]"
        isSubmitting={loadingState[JOB_ACTION_STATUS_ENUM.PAUSE]}
      >
        Pause
      </Button>
      <Button
        disabled={
          isButtonDisabled.STOPPED ||
          loadingState[JOB_ACTION_STATUS_ENUM.PAUSE] ||
          loadingState[JOB_ACTION_STATUS_ENUM.RESUME]
        }
        onClick={() => handleUpdateStatus(JOB_ACTION_STATUS_ENUM.STOP)}
        className="w-[152px]"
        isSubmitting={loadingState[JOB_ACTION_STATUS_ENUM.STOP]}
      >
        Stop
      </Button>
    </Box>
  );
};

export default memo(ActionButtons);
