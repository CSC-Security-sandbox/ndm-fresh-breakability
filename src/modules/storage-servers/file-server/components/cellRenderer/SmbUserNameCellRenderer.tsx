import { BlueXpTableRowType } from "@/types/app.type";
import Box from "@/components/container/Box";
import { Text } from "@netapp/bxp-design-system-react";
import TooltipRenderer from "@/components/custom-cell-renderer/TooltipRenderer";

const SmbUserNameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const smbFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );
  return (
    <Box className="flex flex-col overflow-hidden whitespace-nowrap">
      <Text className="overflow-hidden text-ellipsis">
        {smbFileServer?.userName || "-"}
      </Text>
      {smbFileServer?.userName &&
        <TooltipRenderer cellValue={smbFileServer?.userName} />
      }
    </Box>
  );
};

export default SmbUserNameCellRenderer;
