import { Box } from "@/components/container/index";
import { BlueXpTableRowType, UserApiType } from "@/types/app.type";

const NameCellRenderer = (
  params: BlueXpTableRowType<UserApiType, UserApiType>
) => {
  const { first_name, last_name } = params?.row || {};

  const getFullName = () => {
    return first_name && last_name
      ? `${first_name} ${last_name}`
      : first_name || last_name || "-";
  };

  return <Box>{getFullName()}</Box>;
};

export default NameCellRenderer;
