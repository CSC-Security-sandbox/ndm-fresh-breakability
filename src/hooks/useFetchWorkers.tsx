import { useLazyGetAllWorkersQuery } from "@api/workersApi";
import { useCallback, useEffect, useState } from "react";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { WorkerApiType } from "@/types/app.type";
import { useLazyGetFileServerWorkersQuery } from "@api/jobsApi";

const useFetchWorkers = (jobRunId: string) => {
  const { selectedProjectId } = useSelectedProjectId();
  const [workers, setWorkers] = useState<WorkerApiType[]>([]);

  //Workers API
  const [getAllWorkers, { error, isLoading: isGetAllWorkersLoading }] =
    useLazyGetAllWorkersQuery();
  const [getFileServerWorkers, { isLoading: isGetFileServerWorkersLoading }] =
    useLazyGetFileServerWorkersQuery();

  const isLoading = jobRunId
    ? isGetFileServerWorkersLoading
    : isGetAllWorkersLoading;

  const getWorkers = useCallback(async () => {
    try {
      const workers = jobRunId
        ? await getFileServerWorkers({ jobRunId })
        : await getAllWorkers({ projectId: selectedProjectId });
      setWorkers(workers?.data);
    } catch (e) {
      console.error(e);
    }
  }, [selectedProjectId, jobRunId, getFileServerWorkers, getAllWorkers]);

  useEffect(() => {
    if (selectedProjectId || jobRunId) {
      getWorkers();
    }
  }, [getWorkers]);

  return {
    workers,
    error,
    isLoading,
  };
};

export default useFetchWorkers;
