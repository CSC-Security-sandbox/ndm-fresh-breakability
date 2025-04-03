import { BlueXpTableRowType } from "@/types/app.type";
import { Heading } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";
import CellValueWithTooltip from "@/utils/CellValueWithTooltip";

const NameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const navigate = useNavigate();

  const cellComponent = () => {
    return (
        <Heading
          level="16"
          color="text-title"
          className="cursor-pointer font-bold"
          onClick={() => navigate(`/file-server/${params?.row?.id}`)}
        >
          {params?.row?.configName}
        </Heading>
    );
  };

  return (
    <CellValueWithTooltip cellValue={params?.row?.configName} cellComponent={cellComponent()}/>
  );
};

export default NameCellRenderer;
