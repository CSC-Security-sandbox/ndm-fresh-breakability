"use client";
import { useLazyGetFileServerByIdQuery } from "@api/configApi";
import { useCallback, useEffect, useState } from "react";
import {
  ConfigListTypeApiType,
  VolumeType,
  WorkerApiType,
} from "@/types/app.type";
import { useParams } from "react-router-dom";

const useFileServerDetails = () => {
  const { fileServerId } = useParams<{ fileServerId: string }>();
  const [getFileServerByIdApi] = useLazyGetFileServerByIdQuery({
    pollingInterval: Number(import.meta.env.VITE_TIME_INTERVAL),
    skipPollingIfUnfocused: true,
  });
  const [allExportPaths, setAllExportPaths] = useState<VolumeType[]>([]);
  const [allWorkersList, setAllWorkersList] = useState<WorkerApiType[]>([]);
  const [fileServerDetails, setFileServerDetails] =
    useState<ConfigListTypeApiType>({} as ConfigListTypeApiType);

  const getFileServerDetails = useCallback(async () => {
    try {
      const _fileServerDetails: ConfigListTypeApiType =
        await getFileServerByIdApi({
          fileServerId,
        }).unwrap();

      const exportPaths = _fileServerDetails.fileServers.flatMap((fileServer) =>
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
      return _fileServerDetails;
    } catch (error) {
      console.error("Error fetching file server details:", error);
    }
  }, [fileServerId, getFileServerByIdApi]);

  useEffect(() => {
    getFileServerDetails();
  }, [getFileServerDetails]);

  return {
    fileServerDetails,
    getFileServerDetails,
    allExportPaths,
    allWorkersList,
  };
};

export default useFileServerDetails;
