import { useLazyGetAllWorkersQuery } from "@api/workersApi";
import { useEffect, useState } from "react";
import useSelectedProjectId from "./useSelectedProjectId";
import { WorkerApiType } from "@/types/app.type";

const useWorkers = () => {
  const { selectedProjectId } = useSelectedProjectId();
  const [workers, setWorkers] = useState<WorkerApiType[]>([]);
  const [getAllWorkers, { error, isLoading }] = useLazyGetAllWorkersQuery();

  useEffect(() => {
    (async () => {
      getAllWorkers({ projectId: selectedProjectId }).then((resp) => {
        setWorkers(resp?.data);
      });
    })();
  }, [selectedProjectId]);

  return {
    workers,
    error,
    isLoading,
  };
};

export default useWorkers;
