import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";
import { USER_ROLES_ENUM } from "@/types/app.type";

export const userIsAppAdmin = (): boolean => {
  const userPermissions = useSelector(
    (state: RootStateType) => state.permissionSlice?.userPermissions
  );

  // Check if user has App Admin role
  return userPermissions?.roles?.some(
    (role) => role.role_name === USER_ROLES_ENUM.APP_ADMIN
  ) ?? false;
};

export default userIsAppAdmin;