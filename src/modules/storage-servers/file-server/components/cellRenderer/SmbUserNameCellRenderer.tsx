import { BlueXpTableRowType } from "@/types/app.type";

const SmbUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const smbFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );
  return smbFileServer?.userName || "-";
};

export default SmbUserNameCellRenderer;
