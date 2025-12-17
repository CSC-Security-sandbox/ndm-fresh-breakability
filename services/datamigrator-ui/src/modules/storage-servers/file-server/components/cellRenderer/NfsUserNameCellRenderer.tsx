import { BlueXpTableRowType } from "@/types/app.type";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";
import { Text } from "@netapp/bxp-design-system-react";

const NfsUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  // Dell Isilon parent rows don't have fileServers - show dash
  if (params?.row?._isDellIsilonParent) {
    return <Text>-</Text>;
  }

  const nfsFileServer = params?.row?.fileServers?.find(
    (fileServer: any) => fileServer.protocol === "NFS"
  );

  return (
    <TooltipRenderer tooltipContent={nfsFileServer?.userName}>
      <Text className="overflow-hidden text-ellipsis whitespace-nowrap">
        {nfsFileServer?.userName || "-"}
      </Text>
    </TooltipRenderer>
  );
};

export default NfsUserNameCellRenderer;
