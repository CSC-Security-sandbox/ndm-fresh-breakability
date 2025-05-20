import { PreCheckStatus } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.types";

export const getPreCheckStatus = (data: any): PreCheckStatus => {
  if (data?.status !== "COMPLETED") {
    return { success: [], failed: [], errors: [] };
  }

  return data?.completed.reduce(
    (acc: PreCheckStatus, completedItem: any) => {
      processCompletedItem(completedItem, acc);
      return acc;
    },
    { success: [], failed: [], errors: [] }
  );
};

const processCompletedItem = (completedItem: any, acc: PreCheckStatus) => {
  const allDestinationsSuccess = completedItem?.destination.every(
    (destinationItem: any) => destinationItem?.status === "success"
  );

  if (completedItem?.status === "success" && allDestinationsSuccess) {
    acc?.success.push(completedItem?.sourcePathId);
  } else {
    getAllErrors(completedItem, acc);
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

const flattenErrors = (items: any[]): any[] => {
  return items?.flatMap((item: any) => item?.errors || []);
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
