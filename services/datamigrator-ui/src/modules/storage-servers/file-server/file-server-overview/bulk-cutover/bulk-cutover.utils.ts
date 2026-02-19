import {
  BlueXpTableStateType,
  GetAllCutOverPathsApiType,
} from "@/types/app.type";
import { CreateBulkCutOverApiPayloadType } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/bulk-cutover.interface";

export const createBulkCutOverPayload = (
  cutOverSelectedIds: string[],
  selectPathTableState: BlueXpTableStateType<GetAllCutOverPathsApiType>
): CreateBulkCutOverApiPayloadType => {
  const { rows } = selectPathTableState;

  //FILTER ROWS WHICH ARE SELECTED BY USER IN TABLE (Step 1)
  const selectedPathsForCutOver = rows.filter((path) => {
    return cutOverSelectedIds.includes(String(path?.id));
  });

  //PREPARE BODY FOR API CALL
  const cutoverConfig = selectedPathsForCutOver.map((path) => {
    return {
      sourcePathId: path?.sourcePath?.id,
      destinationPathId: [path?.destinationPath?.id],
      sourceDirectoryPath: path?.sourceDirectoryPath,
      destinationDirectoryPath: path?.destinationDirectoryPath,
    };
  });
  return { cutoverConfig };
};
