import { BlueXpTableRowType } from "@/types/app.type";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";
import { Text } from "@netapp/bxp-design-system-react";

const SmbHostCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  // Dell Isilon parent rows don't have fileServers - show dash
  if (params?.row?._isDellIsilonParent) {
    return <Text>-</Text>;
  }

  // Dell Isilon child rows - the row IS the file server
  if (params?.row?._isDellIsilonChild) {
    const isSmb = params?.row?.protocol === "SMB";
    const host = isSmb ? params?.row?.host : null;
    return (
      <TooltipRenderer tooltipContent={host || "-"} show={!!host}>
        <Text className="overflow-hidden text-ellipsis whitespace-nowrap">
          {host || "-"}
        </Text>
      </TooltipRenderer>
    );
  }

  const smbFileServer = params?.row?.fileServers?.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );

  return (
    <TooltipRenderer tooltipContent={smbFileServer?.host || "-"} show={smbFileServer?.host ? true : false}>
      <Text className="overflow-hidden text-ellipsis whitespace-nowrap">
        {smbFileServer?.host || "-"}
      </Text>
    </TooltipRenderer>
  );
};

export default SmbHostCellRenderer;
