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

    if (uniqueStatus === JOB_STATUS_TYPE_ENUM.STOPPED) {
      return statuses; // All buttons disabled
    }

    if (uniqueStatus === JOB_STATUS_TYPE_ENUM.READY) {
      statuses.STOPPED = false;
      return statuses; // All buttons disabled except STOPPED
    }

    if (uniqueStatus in statuses) {
      return Object.fromEntries(
        Object.keys(statuses).map((status) => [status, status === uniqueStatus])
      ) as Record<StatusType, boolean>;
    }
  }

  // Disable all buttons for multiple statuses
  return Object.fromEntries(
    Object.keys(statuses).map((status) => [status, true])
  ) as Record<StatusType, boolean>;
};
