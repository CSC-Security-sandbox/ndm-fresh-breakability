import { BulkCutOverContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/context/BulkCutOverContextProvider";
import { Box } from "@components/container/index";
import { notify } from "@components/notification/NotificationWrapper";
import { useUpdateJobRunStatusMutation } from "@api/jobsApi";
import { JOB_ACTION_STATUS_ENUM } from "@/types/app.type";
import { Button } from "@netapp/bxp-design-system-react";
import { useContext } from "react";

const ActionButtons = () => {
  const { reviewStepSelectedIds } = useContext(BulkCutOverContext);

  const [updateStatus, { isLoading: isUpdating }] =
    useUpdateJobRunStatusMutation();

  const handleUpdateStatus = async (status: JOB_ACTION_STATUS_ENUM) => {
    try {
      await updateStatus({ ids: reviewStepSelectedIds, status }).unwrap();
      notify.success("Successfully updated the status of Job.");
    } catch (error) {
      notify.error("Failed to update Job Status.");
      console.error(error);
    }
  };

  return (
    <Box className="flex justify-end gap-3">
      <Button
        disabled={reviewStepSelectedIds?.length === 0}
        onClick={() => handleUpdateStatus(JOB_ACTION_STATUS_ENUM.PAUSE)}
        style={{ width: 152 }}
        isSubmitting={isUpdating}
      >
        Pause
      </Button>
      <Button
        disabled={reviewStepSelectedIds?.length === 0}
        onClick={() => handleUpdateStatus(JOB_ACTION_STATUS_ENUM.STOP)}
        style={{ width: 152 }}
        isSubmitting={isUpdating}
      >
        Stop
      </Button>
    </Box>
  );
};

export default ActionButtons;
