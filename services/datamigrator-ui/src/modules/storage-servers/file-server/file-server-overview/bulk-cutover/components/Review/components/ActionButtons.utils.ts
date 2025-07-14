import {
  DataItem,
  StatusType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButtons.types";
import { JOB_STATUS_TYPE_ENUM } from "@/types/app.type";
import { STATUS_TYPE } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButton.constant";

export const hasUniqueStatus = (
  data: DataItem[]
): Record<StatusType, boolean> => {
  const statuses: Record<StatusType, boolean> = { ...STATUS_TYPE };
  const uniqueStatuses = Array.from(new Set(data.map((item) => item.status)));

  if (uniqueStatuses.length === 1) {
    const [uniqueStatus] = uniqueStatuses;

    switch (uniqueStatus) {
      case JOB_STATUS_TYPE_ENUM.STOPPED:
        return statuses; // All buttons disabled
      case JOB_STATUS_TYPE_ENUM.READY:
        return { ...statuses, STOPPED: false }; // All buttons disabled except STOPPED
      default:
        if (uniqueStatus in statuses) {
          return Object.fromEntries(
            Object.keys(statuses).map((status) => [status, status === uniqueStatus])
          ) as Record<StatusType, boolean>;
        }
    }
  } else if (uniqueStatuses.length === 2 &&
    uniqueStatuses.includes(JOB_STATUS_TYPE_ENUM.READY) &&
    uniqueStatuses.includes(JOB_STATUS_TYPE_ENUM.RUNNING)
  ) {
      return { ...statuses, STOPPED: false }; // If both READY and RUNNING are present, enable only STOPPED
  }

  // Disable all buttons for multiple statuses
  return Object.fromEntries(
    Object.keys(statuses).map((status) => [status, true])
  ) as Record<StatusType, boolean>;
};
