import { BlueXpTableRowType } from "@/types/app.type";
import { Heading } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";
import TooltipRenderer from "@/components/custom-cell-renderer/TooltipRenderer";
import Box from "@/components/container/Box";

const NameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const navigate = useNavigate();

  return (
    <Box className="flex flex-col overflow-hidden whitespace-nowrap">
      <Heading
        level="16"
        color="text-title"
        className="cursor-pointer font-bold overflow-hidden text-ellipsis"
        onClick={() => navigate(`/file-server/${params?.row?.id}`)}
      >
        {params?.row?.configName}
      </Heading>
      <TooltipRenderer cellValue={params?.row?.configName} />
    </Box>
  );
};

export default NameCellRenderer;
