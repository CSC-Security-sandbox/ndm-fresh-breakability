import { useGetAllWorkersQuery } from "@api/workersApi";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { useParams } from "react-router-dom";

const useFetchWorkers = () => {
  const { selectedProjectId } = useSelectedProjectId();
  const { jobRunId } = useParams<{ jobRunId?: string }>();

  const getParams = () => {
    let url = `?projectId=${selectedProjectId}`;
    if (jobRunId) {
      url += `&jobRunId=${jobRunId}`;
    }
    return url;
  };

  const {
    data: workers,
    error,
    isLoading,
    isFetching,
    refetch: refetchAllWorkers,
  } = useGetAllWorkersQuery(getParams(), {
    skip: !selectedProjectId,
    pollingInterval: Number(
      window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
    ),
    skipPollingIfUnfocused: true,
  });

  return {
    workers,
    error,
    isLoading,
    isFetching,
    refetch: refetchAllWorkers,
  };
};

export default useFetchWorkers;
