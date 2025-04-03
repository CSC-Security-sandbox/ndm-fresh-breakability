import { BlueXpTableRowType } from "@/types/app.type";
import TooltipRenderer from "@/components/custom-cell-renderer/TooltipRenderer";
import Box from "@/components/container/Box";
import { Text } from "@netapp/bxp-design-system-react";

const NfsUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const nfsFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer.protocol === "NFS"
  );
  return (
  <Box className="flex flex-col overflow-hidden whitespace-nowrap">
    <Text className="overflow-hidden text-ellipsis">
      {nfsFileServer?.userName || "-"}
    </Text>
    {nfsFileServer?.userName &&
      <TooltipRenderer cellValue={nfsFileServer?.userName} />
    }
  </Box>
  );
};

export default NfsUserNameCellRenderer;
