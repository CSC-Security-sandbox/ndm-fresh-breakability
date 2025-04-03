import { BlueXpTableRowType } from "@/types/app.type";
import CellValueWithTooltip from "@/utils/CellValueWithTooltip";

const NfsUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const nfsFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer.protocol === "NFS"
  );

  const cellComponent = () => nfsFileServer?.userName || "-";

  return (
    <CellValueWithTooltip cellValue={nfsFileServer?.userName} cellComponent={cellComponent()}/>
  );
};

export default NfsUserNameCellRenderer;
