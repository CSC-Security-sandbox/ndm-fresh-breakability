import { BlueXpTableRowType } from "@/types/app.type";
import { Heading } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";

const NameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const navigate = useNavigate();

  return (
    <TooltipRenderer tooltipContent={params?.row?.configName}>
      <Heading
        level="16"
        color="text-title"
        className="cursor-pointer font-bold overflow-hidden text-ellipsis whitespace-nowrap"
        onClick={() => navigate(`/file-server/${params?.row?.id}`)}
      >
        {params?.row?.configName}
      </Heading>
    </TooltipRenderer>
  );
};

export default NameCellRenderer;