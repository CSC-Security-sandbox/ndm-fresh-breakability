/* eslint-disable */
import { RootStateType } from "@store/store";
import useSelectedProjectId from "@/hooks/useSelectedProjectId";
import { useSelector } from "react-redux";
import { getProjectPermissions } from '@/utils/common.utils';

export const hasPermission = (permissionName: string): boolean => {
  const userPermissions = useSelector(
    (state: RootStateType) => state.permissionSlice?.userPermissions
  );
  const { selectedProjectId } = useSelectedProjectId();

  const projectPermissions = getProjectPermissions(selectedProjectId, userPermissions);
  return projectPermissions?.includes(permissionName) ?? false;
};
