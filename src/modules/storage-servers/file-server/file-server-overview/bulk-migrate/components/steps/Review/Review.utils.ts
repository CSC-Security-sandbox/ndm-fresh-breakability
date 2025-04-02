import {
  PreCheckStatus,
  StatusType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Review/Review.types";

export const getPreCheckStatus = (data: any): PreCheckStatus => {
  if (data?.status !== "COMPLETED") {
    return { success: [], failed: [], errors: [] };
  }

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
    acc?.failed.push(completedItem?.sourcePathId);
    acc?.errors.push({
      sourcePathId: completedItem?.sourcePathId,
      errors: [...(completedItem?.errors || []), ...(destinationErrors || [])],
    });
  };

  const flattenErrors = (items: any[]): any[] => {
    return items?.flatMap((item: any) => item?.errors || []);
  };

  return data?.completed.reduce(
    (acc: PreCheckStatus, completedItem: any) => {
      processCompletedItem(completedItem, acc);
      return acc;
    },
    { success: [], failed: [], errors: [] }
  );
};

export const getSourcePaths = (sourcePathId: string, errorData: StatusType[]) =>
  errorData
    ?.filter((ele: any) => ele?.source?.sourcePathId === sourcePathId)
    .map((ele: any) => {
      const path = ele?.source?.path;
      return {
        truncatePath: path.length > 40 ? `${path.slice(0, 37)}...` : path,
        path,
      };
    });
