import { BlueXpTableRowType } from "@/types/app.type";
import CellValueWithTooltip from "@/utils/CellValueWithTooltip";

const SmbUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const smbFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );

  return (
    <CellValueWithTooltip cellValue={smbFileServer?.userName || "-"} cellComponent={smbFileServer?.userName || "-"} showTooltip={smbFileServer?.userName ? true : false} />
  );
};

export default SmbUserNameCellRenderer;
