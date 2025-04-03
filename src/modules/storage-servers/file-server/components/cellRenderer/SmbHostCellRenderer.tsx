import { BlueXpTableRowType } from "@/types/app.type";
import CellValueWithTooltip from "@/utils/CellValueWithTooltip";

const SmbHostCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const smbFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );

  const cellComponent = () => smbFileServer?.host || "-"

  return (
    <CellValueWithTooltip cellValue={smbFileServer?.host || "-"} cellComponent={cellComponent()} showTooltip={smbFileServer?.host ? true : false} />
  );
};

export default SmbHostCellRenderer;
