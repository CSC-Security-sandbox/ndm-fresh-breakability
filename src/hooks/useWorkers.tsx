"use client";
import { useLazyGetAllWorkersQuery } from "@api/workersApi";
import { useEffect, useState } from "react";
import useSelectedProjectId from "./useSelectedProjectId";

const useWorkers = () => {
  const { selectedProjectId } = useSelectedProjectId();
  const [workers, setWorkers] = useState([]);
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
