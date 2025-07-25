import useSelectedProjectId from "@/hooks/useSelectedProjectId";
import { RootStateType } from "@store/store";
import { ReactNode, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { getProjectPermissions } from '@/utils/common.utils';

interface AuthProps {
  permissionName: string;
  children: ReactNode;
}

const Auth = ({ permissionName, children }: AuthProps) => {
  const [hasPermission, setHasPermission] = useState(false);
  const [loading, setLoading] = useState(true);

  const userPermissions = useSelector(
    (state: RootStateType) => state.permissionSlice?.userPermissions
  );
  const { selectedProjectId } = useSelectedProjectId();

  const permissionCurrent = (projectId: string) => getProjectPermissions(projectId, userPermissions);

  useEffect(() => {
    const fetchUserPermissions = async () => {
      setHasPermission(false);

      const userPermissions = permissionCurrent(selectedProjectId);
      if (userPermissions?.includes(permissionName)) {
        setHasPermission(true);
      }
      setLoading(false);
    };

    fetchUserPermissions();
  }, [permissionCurrent, permissionName, selectedProjectId, userPermissions]);

  if (loading) {
    return <div>Loading...</div>;
  }

  return hasPermission ? <>{children}</> : null;
};

export default Auth;
