import { Box } from "@/components/container/index";
import { BlueXpTableRowType, UserApiType } from "@/types/app.type";

const NameCellRenderer = (
  params: BlueXpTableRowType<UserApiType, UserApiType>
) => {
  const { first_name, last_name, isAppAdmin } = params?.row || {};

  const getFullName = () => {
    return first_name && last_name
      ? `${first_name} ${last_name}`
      : first_name || last_name || "-";
  };

  const fullName = getFullName();

  return (
    <Box className="flex gap-1 items-center">
      {fullName}
      {isAppAdmin && <Box className="text-gray-400">(Admin)</Box>}
    </Box>
  );
};

export default NameCellRenderer;
