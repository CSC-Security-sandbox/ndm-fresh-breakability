/* eslint-disable */
import { RootStateType } from "@store/store";
import useSelectedProjectId from "@/hooks/useSelectedProjectId";
import { useSelector } from "react-redux";
import {USER_ROLES_ENUM} from '@/types/app.type';

export const hasPermission = (permissionName: string): boolean => {
  const userPermissions = useSelector(
    (state: RootStateType) => state.permissionSlice?.userPermissions
  );
  const { selectedProjectId } = useSelectedProjectId();

  const permissionCurrent = (projectId: string) =>
    userPermissions.roles.find((row) => row.projects.includes(projectId) || (row.role_name === USER_ROLES_ENUM.APP_ADMIN && row.projects.length === 0))
      ?.permissions;

  const projectPermissions = permissionCurrent(selectedProjectId);
  return projectPermissions?.includes(permissionName) ?? false;
};
