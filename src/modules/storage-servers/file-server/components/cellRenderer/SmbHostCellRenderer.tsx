import { BlueXpTableRowType } from "@/types/app.type";

const SmbHostCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const smbFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );
  return smbFileServer?.host || "-";
};

export default SmbHostCellRenderer;
