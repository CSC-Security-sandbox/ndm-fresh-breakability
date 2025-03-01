import { BlueXpTableRowType } from "@/types/app.type";

const NfsHostCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const nfsFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer.protocol === "NFS"
  );
  return nfsFileServer?.host || "-";
};

export default NfsHostCellRenderer;
