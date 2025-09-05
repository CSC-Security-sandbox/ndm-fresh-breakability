import { PreCheckStatus } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.types";
import { ValidateConnectionStatus } from "@/types/app.type";

export const getPreCheckStatus = (data: any): PreCheckStatus => {
  if (data?.status !== ValidateConnectionStatus.COMPLETED) {
    return { success: [], failed: [], errors: [], warnings: [] };
  }

  return data?.completed.reduce(
    (acc: PreCheckStatus, completedItem: any) => {
      processCompletedItem(completedItem, acc);
      return acc;
    },
    { success: [], failed: [], errors: [], warnings: [] }
  );
};

export const getPrecheckErrors = (data: any): PreCheckStatus => {
  if (data?.status === ValidateConnectionStatus.FAILED || data?.status === ValidateConnectionStatus.TIMED_OUT || data?.status === ValidateConnectionStatus.TERMINATED) {
    return {
      success: [],
      failed: [],
      errors: [
        {
          sourcePathId: data?.workflow?.sourcePathId,
          destinationPathId: data?.workflow?.destinationPathIds?.[0] ?? "",
          errors: data?.workflow?.errors || []
        }
      ],
      warnings: [],
    };
  }

  return { success: [], failed: [], errors: [], warnings: [] };
}
const processCompletedItem = (completedItem: any, acc: PreCheckStatus) => {
  const allDestinationsSuccess = completedItem?.destination.every(
    (destinationItem: any) => destinationItem?.status === "success"
  );

  if (completedItem?.status === "success" && allDestinationsSuccess) {
    acc?.success.push(completedItem?.sourcePathId);
    getAllWarnings(completedItem, acc);
  } else {
    getAllErrors(completedItem, acc);
    getAllWarnings(completedItem, acc);
  }
};

const getAllErrors = (completedItem, acc) => {
  const destinationErrors = flattenErrors(completedItem?.destination);

  acc?.errors.push({
    sourcePathId: completedItem?.sourcePathId,
    destinationPathId: completedItem?.destination[0].destinationPathId,
    errors: [...(completedItem?.errors || []), ...(destinationErrors || [])],
  });
};

const getAllWarnings = (completedItem, acc) => {
  const destinationWarnings = flattenWarnings(completedItem?.destination);
  acc?.warnings.push({
    sourcePathId: completedItem?.sourcePathId,
    destinationPathId: completedItem?.destination[0].destinationPathId,
    warnings: [
      ...(completedItem?.warnings || []),
      ...(destinationWarnings || []),
    ],
  });
};

const flattenErrors = (items: any[]): any[] => {
  return items?.flatMap((item: any) => item?.errors || []);
};

const flattenWarnings = (items: any[]): any[] => {
  return items?.flatMap((item: any) => item?.warnings || []);
};

const getTruncatedPath = (path: string) =>
  path.length > 40 ? `${path.slice(0, 37)}...` : path;

export const getDestinationPaths = (errorData, destinationPathId) => {
  const destination = errorData.find(({ destination }) =>
    destination?.pathId.includes(destinationPathId)
  )?.destination;

  if (!destination) {
    return {
      truncateDestinationPath: "",
      destinationPath: "",
      destination: "",
    };
  }

  return {
    truncateDestinationPath: getTruncatedPath(destination.path),
    destinationPath: destination.path,
    destination: destination.server,
  };
};

export const getSourcePaths = (errorData, sourcePathId) => {
  const source = errorData.find(
    ({ source }) => source?.sourcePathId === sourcePathId
  )?.source;

  return {
    truncateSourcePath: getTruncatedPath(source.path) || "",
    sourcePath: source.path || "",
  };
};
