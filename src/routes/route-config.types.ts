import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";

export type RouteConfigType = {
  path: string;
  element: React.ReactNode;
  protected?: boolean;
  requiredPermission?: USER_PERMISSION_TYPE_ENUM;
};
