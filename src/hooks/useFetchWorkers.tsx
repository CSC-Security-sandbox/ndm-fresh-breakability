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
  } = useGetAllWorkersQuery(getParams(), { skip: !selectedProjectId });

  return {
    workers,
    error,
    isLoading,
    isFetching,
    refetch: refetchAllWorkers,
  };
};

export default useFetchWorkers;
