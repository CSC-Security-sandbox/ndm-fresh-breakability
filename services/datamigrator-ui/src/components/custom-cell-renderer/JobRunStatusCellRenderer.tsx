import { Box } from "@/components/container/index";
import { JOB_STATUS_TYPE_ENUM, TASK_STATUS_TYPE_ENUM } from "@/types/app.type";

const getStyleForStatus = (
  status: JOB_STATUS_TYPE_ENUM | TASK_STATUS_TYPE_ENUM
) => {
  switch (status) {
    case JOB_STATUS_TYPE_ENUM.RUNNING:
    case TASK_STATUS_TYPE_ENUM.RUNNING:
      return "bg-blue-500";

    case JOB_STATUS_TYPE_ENUM.STOPPED:
    case JOB_STATUS_TYPE_ENUM.ERRORED:
    case JOB_STATUS_TYPE_ENUM.FAILED:
    case TASK_STATUS_TYPE_ENUM.ERRORED:
    case JOB_STATUS_TYPE_ENUM.REJECTED:
      return "bg-red-500";

    case JOB_STATUS_TYPE_ENUM.PAUSED:
    case JOB_STATUS_TYPE_ENUM.PAUSING:
    case JOB_STATUS_TYPE_ENUM.PENDING:
    case TASK_STATUS_TYPE_ENUM.PENDING:
      return "bg-yellow-500";

    case JOB_STATUS_TYPE_ENUM.BLOCKED:
      return "bg-gray-900";

    case JOB_STATUS_TYPE_ENUM.COMPLETED:
    case JOB_STATUS_TYPE_ENUM.READY:
    case TASK_STATUS_TYPE_ENUM.COMPLETED:
    case JOB_STATUS_TYPE_ENUM.APPROVED:
    default:
      return "bg-notification-success";
  }
};

const JobRunStatusCellRenderer = ({
  status,
}: {
  status: JOB_STATUS_TYPE_ENUM | TASK_STATUS_TYPE_ENUM;
}) => {
  const style = getStyleForStatus(status);
  return (
    <Box data-testid="job-run-status" className="flex gap-2 items-center">
      <span className={`w-3 h-3 rounded-full inline-block ${style}`}></span>
      <Box className="capitalize">{status.toLowerCase()}</Box>
    </Box>
  );
};

export default JobRunStatusCellRenderer;
