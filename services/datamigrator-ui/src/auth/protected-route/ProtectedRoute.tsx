import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";
import { ProtectedRoutePropsType } from "@auth/protected-route/protected-route.types";

const ProtectedRoute = ({
  requiredPermission,
  redirectTo,
  children,
}: ProtectedRoutePropsType) => {
  const userPermissions = useSelector(
    (state: RootStateType) => state.permissionSlice.userPermissions
  );

  const hasPermission = userPermissions.roles.some((role) =>
    role.permissions.includes(requiredPermission)
  );

  if (!hasPermission) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
