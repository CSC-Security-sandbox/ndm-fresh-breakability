import { Box } from "@/components/container/index";
import { BlueXpTableRowType, UserApiType } from "@/types/app.type";

const NameCellRenderer = (
  params: BlueXpTableRowType<UserApiType, UserApiType>
) => {
  const { first_name, last_name, isAppAdmin, user_role } = params?.row || {};

  const getFullName = () => {
    return first_name && last_name
      ? `${first_name} ${last_name}`
      : first_name || last_name || "-";
  };

  const fullName = getFullName();

  return (
    <Box className="flex gap-1 items-center">
      {fullName}
      <Box className="text-gray-400">{user_role ? `(${user_role})` : "(Admin)"}</Box>
      {/* {isAppAdmin && <Box className="text-gray-400">(Admin)</Box>}  */}
    </Box>
  );
};

export default NameCellRenderer;
