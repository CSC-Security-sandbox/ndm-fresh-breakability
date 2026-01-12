import { BlueXpTableRowType } from "@/types/app.type";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";
import { Text } from "@netapp/bxp-design-system-react";

const SmbUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  // Dell Isilon parent rows don't have fileServers - show dash
  if (params?.row?._isDellIsilonParent) {
    return <Text>-</Text>;
  }

  // Dell Isilon child rows - the row IS the file server
  if (params?.row?._isDellIsilonChild) {
    const isSmb = params?.row?.protocol === "SMB";
    const userName = isSmb ? params?.row?.userName : null;
    return (
      <TooltipRenderer tooltipContent={userName || "-"} show={!!userName}>
        <Text className="overflow-hidden text-ellipsis whitespace-nowrap">
          {userName || "-"}
        </Text>
      </TooltipRenderer>
    );
  }

  const smbFileServer = params?.row?.fileServers?.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );

  return (
    <TooltipRenderer tooltipContent={smbFileServer?.userName || "-"} show={smbFileServer?.userName ? true : false}>
      <Text className="overflow-hidden text-ellipsis whitespace-nowrap">
        {smbFileServer?.userName || "-"}
      </Text>
    </TooltipRenderer>
  );
};

export default SmbUserNameCellRenderer;
