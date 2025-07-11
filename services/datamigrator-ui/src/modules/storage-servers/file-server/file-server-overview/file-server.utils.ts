import { ConfigListTypeApiType } from "@/types/app.type";
import { EXPORT_PATH_SOURCE_ENUM } from "@modules/storage-servers/file-server/components/file-server.constant";

export const hasManualUploadPath = (
  fileServerDetails: ConfigListTypeApiType
) => {
  return fileServerDetails?.fileServers.some(
    (fs) => fs?.exportPathSource === EXPORT_PATH_SOURCE_ENUM.MANUAL_UPLOAD
  );
};

export const getFileServerId = (
  fileServerDetails: ConfigListTypeApiType,
  protocolName: string
) => {
  return fileServerDetails?.fileServers.find(
    (fs) => fs?.protocol === protocolName
  )?.id;
};
