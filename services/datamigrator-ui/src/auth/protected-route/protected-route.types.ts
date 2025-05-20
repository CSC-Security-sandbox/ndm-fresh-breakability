import { ReactNode } from "react";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";

export type ProtectedRoutePropsType = {
  requiredPermission: USER_PERMISSION_TYPE_ENUM;
  redirectTo: string;
  children: ReactNode;
};
