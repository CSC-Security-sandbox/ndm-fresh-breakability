import { useLazyGetAllWorkersQuery } from "@api/workersApi";
import { useEffect, useState } from "react";
import useSelectedProjectId from "./useSelectedProjectId";
import { WorkerApiType } from "@/types/app.type";

const useWorkers = () => {
  const { selectedProjectId } = useSelectedProjectId();
  const [workers, setWorkers] = useState<WorkerApiType[]>([]);
  const [getAllWorkers, { error, isLoading, isFetching }] = useLazyGetAllWorkersQuery();

  const getWorkers = () => {
    getAllWorkers({ projectId: selectedProjectId }).then((resp) => {
      setWorkers(resp?.data);
    });
  }

  useEffect(() => {
    getWorkers();
  }, [selectedProjectId]);

  return {
    workers,
    error,
    isLoading,
    isFetching,
    refetch: getWorkers,
  };
};

export default useWorkers;
