import { BlueXpTableRowType } from "@/types/app.type";

const NfsHostCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  // Dell Isilon parent rows don't have fileServers - show dash
  if (params?.row?._isDellIsilonParent) {
    return "-";
  }

  const nfsFileServer = params?.row?.fileServers?.find(
    (fileServer: any) => fileServer.protocol === "NFS"
  );
  return nfsFileServer?.host || "-";
};

export default NfsHostCellRenderer;
