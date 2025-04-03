import { BlueXpTableRowType } from "@/types/app.type";
import TooltipRenderer from "@/components/custom-cell-renderer/TooltipRenderer";
import Box from "@/components/container/Box";
import { Text } from "@netapp/bxp-design-system-react";

const SmbHostCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const smbFileServer = params?.row?.fileServers.find(
    (fileServer: any) => fileServer?.protocol === "SMB"
  );
  return (
    <Box className="Table-module_cell-value__ss5_Y">
      <Text className="overflow-hidden text-ellipsis">
        {smbFileServer?.host || "-"}
      </Text>
      {smbFileServer?.host &&
        <TooltipRenderer cellValue={smbFileServer?.host} />
      }
    </Box>
  );
};

export default SmbHostCellRenderer;
