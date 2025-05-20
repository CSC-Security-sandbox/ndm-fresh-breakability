/* eslint-disable */
import { RootStateType } from "@store/store";
import useSelectedProjectId from "@/hooks/useSelectedProjectId";
import { useSelector } from "react-redux";

export const hasPermission = (permissionName: string): boolean => {
  const userPermissions = useSelector(
    (state: RootStateType) => state.permissionSlice?.userPermissions
  );
  const { selectedProjectId } = useSelectedProjectId();

  const permissionCurrent = (projectId: string) =>
    userPermissions.roles.find((row) => row.projects.includes(projectId))
      ?.permissions;

  if (
    userPermissions.roles.length > 0 &&
    userPermissions.roles[0].projects.length === 0
  ) {
    return true;
  }

  const projectPermissions = permissionCurrent(selectedProjectId);
  return projectPermissions?.includes(permissionName) ?? false;
};
