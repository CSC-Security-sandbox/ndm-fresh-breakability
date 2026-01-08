import { BlueXpFormType } from "@/types/app.type";
import { bulkDiscoveryFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";

export const generateBulkDiscoveryPayload = (
  bulkDiscoveryForm: BlueXpFormType<bulkDiscoveryFormType>,
  sourcePathIds: string[]
) => {
    const { excludeFilePatterns, firstRunAt, scheduleTime, protocol, shouldScanADS } =
    bulkDiscoveryForm.formState;

    const isSMB = protocol?.value === "SMB";

  return {
    excludeFilePatterns: excludeFilePatterns.replaceAll("\n", ","),
    firstRunAt:
      scheduleTime === "schedule_date"
        ? firstRunAt?.toISOString()
        : undefined,
    sourcePathIds,
    preserveAccessTime: true,
    ...(isSMB && { shouldScanADS: shouldScanADS === "yes" }),
  };
};

export const generateTimeOptions = () => {
  const options = [];

  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute++) {
      const formattedHour = String(hour).padStart(2, "0");
      const formattedMinute = String(minute).padStart(2, "0");
      options.push(`${formattedHour}:${formattedMinute}`);
    }
  }

  return options;
};

export const calculateLastScanned = (timestamp: string) => {
  const now: any = new Date();
  const scannedDate: any = new Date(timestamp);

  const diffInMs = now - scannedDate;

  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  const isSameDay =
    now.getDate() === scannedDate.getDate() &&
    now.getMonth() === scannedDate.getMonth() &&
    now.getFullYear() === scannedDate.getFullYear();

  if (isSameDay) {
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInMinutes = Math.floor(
      (diffInMs % (1000 * 60 * 60)) / (1000 * 60)
    );
    const diffInSeconds = Math.floor((diffInMs % (1000 * 60)) / 1000);

    if (diffInHours === 0) {
      return `Refreshed ${diffInMinutes} minutes, and ${diffInSeconds} seconds ago`;
    }
    return `Refreshed ${diffInHours} hours, ${diffInMinutes} minutes, ago`;
  } else if (diffInDays === 1) {
    return "Refreshed 1 day ago";
  } else if (diffInDays > 1) {
    return `Refreshed ${diffInDays} days ago`;
  } else {
    return "";
  }
};
