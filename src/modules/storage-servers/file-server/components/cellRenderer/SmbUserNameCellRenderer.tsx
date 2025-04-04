import { BlueXpTableRowType } from "@/types/app.type";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";

const SmbUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const smbFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );

  return (
    <TooltipRenderer tooltipContent={smbFileServer?.userName || "-"} show={smbFileServer?.userName ? true : false}>
      {smbFileServer?.userName || "-"}
    </TooltipRenderer>
  );
};

export default SmbUserNameCellRenderer;
