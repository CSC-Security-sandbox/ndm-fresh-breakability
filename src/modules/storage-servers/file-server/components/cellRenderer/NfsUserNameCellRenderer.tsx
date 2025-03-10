import { BlueXpTableRowType } from "@/types/app.type";

const NfsUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const nfsFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer.protocol === "NFS"
  );
  return nfsFileServer?.userName || "-";
};

export default NfsUserNameCellRenderer;
