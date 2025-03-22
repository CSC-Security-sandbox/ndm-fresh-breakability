import { useGetAllWorkersQuery } from "@api/workersApi";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { useGetFileServerWorkersQuery } from "@api/jobsApi";
import { useParams } from "react-router-dom";

const useFetchWorkers = () => {
  const { selectedProjectId } = useSelectedProjectId();
  const { jobRunId } = useParams();

  const {
    data: allWorkers,
    error: getAllWorkersError,
    isLoading: isGetAllWorkersLoading,
    isFetching: isFetchingAllWorkers,
    refetch: refetchAllWorkers,
  } = useGetAllWorkersQuery(
    { projectId: selectedProjectId },
    { skip: !selectedProjectId }
  );

  const {
    data: fileServerWorkers,
    error: getFileServerWorkersError,
    isLoading: isGetFileServerWorkersLoading,
  } = useGetFileServerWorkersQuery({ jobRunId }, { skip: !jobRunId });

  return {
    workers: jobRunId ? fileServerWorkers : allWorkers,
    error: jobRunId ? getFileServerWorkersError : getAllWorkersError,
    isLoading: jobRunId
      ? isGetFileServerWorkersLoading
      : isGetAllWorkersLoading,
    isFetching: isFetchingAllWorkers,
    refetch: refetchAllWorkers,
  };
};

export default useFetchWorkers;
