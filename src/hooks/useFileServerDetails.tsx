import { useGetFileServerByIdQuery } from "@api/configApi";
import { useEffect, useState } from "react";
import {
  ConfigListTypeApiType,
  VolumeType,
  WorkerApiType,
} from "@/types/app.type";
import { useParams } from "react-router-dom";

const useFileServerDetails = () => {
  const { fileServerId } = useParams<{ fileServerId: string }>();
  const { data: _fileServerDetails, isFetching } = useGetFileServerByIdQuery(
    { fileServerId },
    {
      pollingInterval: Number(
        window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
      ),
      skipPollingIfUnfocused: true,
    }
  );
  const [allExportPaths, setAllExportPaths] = useState<VolumeType[]>([]);
  const [allWorkersList, setAllWorkersList] = useState<WorkerApiType[]>([]);
  const [fileServerDetails, setFileServerDetails] =
    useState<ConfigListTypeApiType>({} as ConfigListTypeApiType);

  const getFileServerDetails = () => {
    if (_fileServerDetails !== undefined) {
      try {
        const exportPaths = _fileServerDetails.fileServers.flatMap(
          (fileServer) =>
            fileServer.volumes.map((volume) => ({
              ...volume,
              protocol: fileServer.protocol,
            }))
        );

        const workers = _fileServerDetails.fileServers.flatMap((fileServer) =>
          fileServer.workers.map((worker) => ({
            ...worker,
            protocol: fileServer.protocol,
          }))
        );

        setFileServerDetails(_fileServerDetails);
        setAllWorkersList(workers);
        setAllExportPaths(exportPaths);
      } catch (error) {
        console.error("Error fetching file server details:", error);
      }
    }
  };

  useEffect(() => {
    getFileServerDetails();
  }, [_fileServerDetails]);

  return {
    fileServerDetails,
    allExportPaths,
    allWorkersList,
    isFetching,
  };
};

export default useFileServerDetails;
