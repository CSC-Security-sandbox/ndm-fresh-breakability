import { BlueXpTableRowType } from "@/types/app.type";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";

const NfsUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const nfsFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer.protocol === "NFS"
  );

  return (
    <TooltipRenderer tooltipContent={nfsFileServer?.userName}>
      {nfsFileServer?.userName || "-"}
    </TooltipRenderer>
  );
};

export default NfsUserNameCellRenderer;
