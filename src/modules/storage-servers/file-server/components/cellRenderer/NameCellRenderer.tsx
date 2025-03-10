import { BlueXpTableRowType } from "@/types/app.type";
import { Heading } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";

const NameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const navigate = useNavigate();
  return (
    <>
      <Heading
        level="16"
        color="text-title"
        className="cursor-pointer font-bold"
        onClick={() => navigate(`/file-server/${params?.row?.id}`)}
      >
        {params?.row?.configName}
      </Heading>
    </>
  );
};

export default NameCellRenderer;
