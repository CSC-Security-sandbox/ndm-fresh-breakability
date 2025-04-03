import { BlueXpTableRowType } from "@/types/app.type";
import CellValueWithTooltip from "@/utils/CellValueWithTooltip";

const NfsUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const nfsFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer.protocol === "NFS"
  );

  return (
    <CellValueWithTooltip cellValue={nfsFileServer?.userName} cellComponent={nfsFileServer?.userName || "-"}/>
  );
};

export default NfsUserNameCellRenderer;
