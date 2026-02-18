import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";
import { USER_ROLES_ENUM } from "@/types/app.type";

/**
 * Hook to check if the current user is an App Admin.
 * App Admin has system-level privileges and can manage ASUP settings.
 * 
 * @returns {boolean} true if the user is an App Admin
 */
export const useIsAppAdmin = (): boolean => {
  const userPermissions = useSelector(
    (state: RootStateType) => state.permissionSlice?.userPermissions
  );

  // Check if user has App Admin role (App Admin has no specific project assignment)
  return (
    userPermissions?.roles?.some(
      (role) =>
        role.role_name === USER_ROLES_ENUM.APP_ADMIN &&
        role.projects.length === 0
    ) ?? false
  );
};

export default useIsAppAdmin;
