import { BlueXpTableRowType } from "@/types/app.type";
import CellValueWithTooltip from "@/utils/CellValueWithTooltip";

const SmbUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const smbFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );

  const cellComponent = () => smbFileServer?.userName || "-";

  return (
    <CellValueWithTooltip cellValue={smbFileServer?.userName || "-"} cellComponent={cellComponent()} showTooltip={smbFileServer?.userName ? true : false} />
  );
};

export default SmbUserNameCellRenderer;
