import { BlueXpTableRowType } from "@/types/app.type";

const NfsHostCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  // Dell Isilon parent rows don't have fileServers - show dash
  if (params?.row?._isDellIsilonParent) {
    return "-";
  }

  // Dell Isilon child rows - the row IS the file server
  if (params?.row?._isDellIsilonChild) {
    const isNfs = params?.row?.protocol === "NFS";
    return isNfs ? (params?.row?.host || "-") : "-";
  }

  const nfsFileServer = params?.row?.fileServers?.find(
    (fileServer: any) => fileServer.protocol === "NFS"
  );
  return nfsFileServer?.host || "-";
};

export default NfsHostCellRenderer;
