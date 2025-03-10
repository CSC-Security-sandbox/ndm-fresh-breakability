import {
  DataItem,
  StatusType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButtons.types";
import { JOB_STATUS_TYPE_ENUM } from "@/types/app.type";
import { STATUS_TYPE } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButton.constant";

export const hasUniqueStatus = (
  data: DataItem[]
): Record<StatusType, boolean> => {
  const statuses: Record<StatusType, any> = STATUS_TYPE;

  const uniqueStatuses = new Set(data.map((item) => item.status));

  if (uniqueStatuses.size === 1) {
    const uniqueStatus = Array.from(uniqueStatuses)[0];
    if (uniqueStatus === JOB_STATUS_TYPE_ENUM.STOPPED) {
      // Disable all buttons if the status is STOPPED
      return STATUS_TYPE;
    } else if (uniqueStatus in statuses) {
      // Enable only the button corresponding to the unique status
      Object.keys(statuses).forEach((status) => {
        statuses[status as StatusType] = status === uniqueStatus;
      });
    }
  }
  return statuses;
};
