export type UserPermissionResponse = {
    user: {
        id: string;
        roles: Role[];
    };
};
   
type Role = {
    role_name: string;
    projects: string[];
    permissions: string[];
};