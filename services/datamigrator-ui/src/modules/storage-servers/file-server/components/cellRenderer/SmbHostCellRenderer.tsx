import { BlueXpTableRowType } from "@/types/app.type";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";

const SmbHostCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const smbFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );

  return (
    <TooltipRenderer tooltipContent={smbFileServer?.host || "-"} show={smbFileServer?.host ? true : false}>
      {smbFileServer?.host || "-"}
    </TooltipRenderer>
  );
};

export default SmbHostCellRenderer;
